import Anthropic from "@anthropic-ai/sdk";
import { db, listSites, type Site } from "@/lib/db";
import { breakdown, goals, revenue, totals } from "@/lib/queries";

const DAY = 86_400_000;

export type SiteDigest = {
  site: { id: string; name: string; domain: string };
  period: { from: number; to: number; label: string };
  visitors: number;
  visitorsPrev: number;
  pageviews: number;
  leads: number; // unique visitors who fired any goal
  leadsPrev: number;
  revenue: number; // cents
  revenuePrev: number;
  payments: number;
  topSources: { value: string; visitors: number }[];
  topPages: { value: string; visitors: number }[];
  goals: { name: string; conversions: number; rate: number }[];
  revenueBySource: { value: string; amount: number }[];
  bestCampaign: { name: string; conversions: number } | null;
  risingSource: { name: string; now: number; before: number } | null;
  fallingSource: { name: string; now: number; before: number } | null;
  pageToFix: { path: string; visitors: number; bounceRate: number } | null;
};

function uniqueLeads(siteId: string, from: number, to: number): number {
  const r = db()
    .prepare(
      "SELECT COUNT(DISTINCT visitor_id) AS n FROM events WHERE site_id = ? AND ts >= ? AND ts <= ? AND type = 'goal'"
    )
    .get(siteId, from, to) as { n: number };
  return r.n;
}

function sourceVisitors(siteId: string, from: number, to: number): Map<string, number> {
  const rows = db()
    .prepare(
      `SELECT referrer_source AS s, COUNT(DISTINCT visitor_id) AS n
       FROM events WHERE site_id = ? AND ts >= ? AND ts <= ? AND referrer_source IS NOT NULL
       GROUP BY referrer_source`
    )
    .all(siteId, from, to) as { s: string; n: number }[];
  return new Map(rows.map((r) => [r.s, r.n]));
}

export function siteDigest(site: Site, from: number, to: number, label: string): SiteDigest {
  const len = to - from;
  const prevFrom = from - len;
  const prevTo = from;

  const t = totals(site.id, from, to, {});
  const tPrev = totals(site.id, prevFrom, prevTo, {});
  const rev = revenue(site.id, from, to);
  const revPrev = revenue(site.id, prevFrom, prevTo);

  // Source momentum: compare visitor counts per channel vs the previous period.
  const now = sourceVisitors(site.id, from, to);
  const before = sourceVisitors(site.id, prevFrom, prevTo);
  let rising: SiteDigest["risingSource"] = null;
  let falling: SiteDigest["fallingSource"] = null;
  for (const [name, n] of now) {
    const b = before.get(name) ?? 0;
    if (n >= 5 && n - b > (rising ? rising.now - rising.before : 0)) rising = { name, now: n, before: b };
  }
  for (const [name, b] of before) {
    const n = now.get(name) ?? 0;
    if (b >= 5 && b - n > (falling ? falling.before - falling.now : 0)) falling = { name, now: n, before: b };
  }

  // Page to fix: most-visited page with a high bounce rate.
  const pages = db()
    .prepare(
      `SELECT path, COUNT(DISTINCT visitor_id) AS visitors, AVG(views = 1) AS bounce_rate
       FROM (
         SELECT session_id, MIN(path) AS path, MIN(visitor_id) AS visitor_id,
                SUM(CASE WHEN type = 'pageview' THEN 1 ELSE 0 END) AS views
         FROM events WHERE site_id = ? AND ts >= ? AND ts <= ?
         GROUP BY session_id
       )
       GROUP BY path HAVING visitors >= 10 ORDER BY bounce_rate * visitors DESC LIMIT 1`
    )
    .get(site.id, from, to) as { path: string; visitors: number; bounce_rate: number } | undefined;

  const campaigns = db()
    .prepare(
      `SELECT utm_campaign AS name, COUNT(DISTINCT visitor_id) AS conversions
       FROM events WHERE site_id = ? AND ts >= ? AND ts <= ? AND type = 'goal' AND utm_campaign IS NOT NULL
       GROUP BY utm_campaign ORDER BY conversions DESC LIMIT 1`
    )
    .get(site.id, from, to) as { name: string; conversions: number } | undefined;

  return {
    site: { id: site.id, name: site.name, domain: site.domain },
    period: { from, to, label },
    visitors: t.visitors,
    visitorsPrev: tPrev.visitors,
    pageviews: t.pageviews,
    leads: uniqueLeads(site.id, from, to),
    leadsPrev: uniqueLeads(site.id, prevFrom, prevTo),
    revenue: rev.amount,
    revenuePrev: revPrev.amount,
    payments: rev.payments,
    topSources: breakdown(site.id, from, to, {}, "referrer_source", 5),
    topPages: breakdown(site.id, from, to, {}, "path", 5),
    goals: goals(site.id, from, to, {}).map((g) => ({ name: g.name, conversions: g.conversions, rate: g.rate })),
    revenueBySource: rev.bySource.map((r) => ({ value: r.value, amount: r.amount })),
    bestCampaign: campaigns ?? null,
    risingSource: rising,
    fallingSource: falling,
    pageToFix: pages && pages.bounce_rate > 0.6 ? { path: pages.path, visitors: pages.visitors, bounceRate: pages.bounce_rate } : null,
  };
}

export function buildDigests(kind: "daily" | "weekly"): SiteDigest[] {
  const to = Date.now();
  const from = kind === "daily" ? to - DAY : to - 7 * DAY;
  const label = kind === "daily" ? "last 24 hours" : "last 7 days";
  return listSites().map((s) => siteDigest(s, from, to, label));
}

/* ---------- formatting ---------- */

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const delta = (now: number, prev: number) => {
  if (prev === 0) return now > 0 ? "(new)" : "";
  const pct = Math.round(((now - prev) / prev) * 100);
  return pct === 0 ? "(±0%)" : pct > 0 ? `(+${pct}%)` : `(${pct}%)`;
};

export function formatDigest(d: SiteDigest, kind: "daily" | "weekly"): string {
  const lines: string[] = [];
  lines.push(`📊 ${d.site.name} (${d.site.domain}) — ${d.period.label}`);
  lines.push(`• Visitors: ${d.visitors.toLocaleString()} ${delta(d.visitors, d.visitorsPrev)}`);
  lines.push(`• Pageviews: ${d.pageviews.toLocaleString()}`);
  lines.push(`• Leads: ${d.leads.toLocaleString()} ${delta(d.leads, d.leadsPrev)}`);
  lines.push(`• Revenue: ${money(d.revenue)} ${delta(d.revenue, d.revenuePrev)} from ${d.payments} payment${d.payments === 1 ? "" : "s"}`);
  if (d.topSources.length) {
    lines.push(`• Top sources: ${d.topSources.slice(0, 3).map((s) => `${s.value} (${s.visitors})`).join(", ")}`);
  }
  if (kind === "weekly") {
    if (d.risingSource) lines.push(`✅ Working: ${d.risingSource.name} ${d.risingSource.before} → ${d.risingSource.now} visitors`);
    if (d.fallingSource) lines.push(`⚠️ Fading: ${d.fallingSource.name} ${d.fallingSource.before} → ${d.fallingSource.now} visitors`);
    if (d.bestCampaign) lines.push(`🏆 Best campaign: ${d.bestCampaign.name} (${d.bestCampaign.conversions} conversions)`);
    if (d.pageToFix) lines.push(`🔧 Page to fix: ${d.pageToFix.path} — ${Math.round(d.pageToFix.bounceRate * 100)}% bounce on ${d.pageToFix.visitors} visitors`);
    if (d.revenueBySource[0]) lines.push(`💰 Top earning channel: ${d.revenueBySource[0].value} (${money(d.revenueBySource[0].amount)})`);
  }
  return lines.join("\n");
}

/* ---------- AI growth memo (optional — needs ANTHROPIC_API_KEY) ---------- */

export async function aiMemo(digests: SiteDigest[], kind: "daily" | "weekly"): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY || digests.length === 0) return null;
  try {
    const client = new Anthropic();
    const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      system:
        "You are a growth advisor for indie founders, writing inside a self-hosted analytics tool. " +
        "You receive raw analytics digests (visitors, leads, revenue, channels, campaigns, weak pages) for the user's websites. " +
        (kind === "weekly"
          ? "Write a weekly growth memo: what's working, what's failing, the best campaign, what to create next, and which page to fix. End with 2-3 concrete next actions (e.g. 'double down on X', 'write a landing page for Y'). "
          : "Write 2-4 sentences of sharp daily insight: call out anything unusual and the single most useful action for today. ") +
        "Be specific, use the numbers, no fluff, no generic advice. Plain text only, short lines, emoji section markers are fine."
      ,
      messages: [{ role: "user", content: JSON.stringify(digests) }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content.find((b) => b.type === "text");
    return text && "text" in text ? text.text.trim() : null;
  } catch (err) {
    console.error("[reports] AI memo failed:", err);
    return null;
  }
}

export async function buildReport(kind: "daily" | "weekly"): Promise<{ text: string; digests: SiteDigest[] }> {
  const digests = buildDigests(kind);
  const header = kind === "daily" ? `🥜 Nut Analytics — Daily summary` : `🥜 Nut Analytics — Weekly growth memo`;
  const parts = [header, ...digests.map((d) => formatDigest(d, kind))];
  const memo = await aiMemo(digests, kind);
  if (memo) parts.push(`🤖 AI insights\n${memo}`);
  return { text: parts.join("\n\n"), digests };
}
