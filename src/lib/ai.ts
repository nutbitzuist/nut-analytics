import Anthropic from "@anthropic-ai/sdk";
import { getSite } from "./db";
import {
  breakdown,
  entryExitPages,
  eventBreakdown,
  goals,
  newVsReturning,
  previousRange,
  resolvePeriod,
  revenue,
  topCustomers,
  totals,
  type PeriodKey,
} from "./queries";

/**
 * Build a compact analytics snapshot for one site + period. Kept small on purpose
 * so it fits comfortably in a prompt while still covering the headline questions
 * a founder asks: traffic, trend, channels, conversions, revenue and customers.
 */
export function buildSiteContext(siteId: string, periodKey: PeriodKey) {
  const { from, to } = resolvePeriod(periodKey);
  const prev = previousRange(from, to);
  return {
    period: periodKey,
    totals: totals(siteId, from, to, {}),
    previous_period_totals: totals(siteId, prev.from, prev.to, {}),
    new_vs_returning: newVsReturning(siteId, from, to, {}),
    top_pages: breakdown(siteId, from, to, {}, "path", 8),
    entry_pages: entryExitPages(siteId, from, to, {}, "entry", 6),
    exit_pages: entryExitPages(siteId, from, to, {}, "exit", 6),
    sources: breakdown(siteId, from, to, {}, "referrer_source", 8),
    utm_campaigns: breakdown(siteId, from, to, {}, "utm_campaign", 6),
    countries: breakdown(siteId, from, to, {}, "country", 6),
    devices: breakdown(siteId, from, to, {}, "device", 4),
    outbound: eventBreakdown(siteId, from, to, {}, "outbound", 6),
    downloads: eventBreakdown(siteId, from, to, {}, "download", 6),
    goals: goals(siteId, from, to, {}),
    revenue: revenue(siteId, from, to),
    top_customers: topCustomers(siteId, from, to, 5),
  };
}

export type AskResult = { answer: string } | { error: string };

const SYSTEM = `You are the analytics co-pilot inside Nut Analytics, a self-hosted web analytics tool for indie founders.
You are given a JSON snapshot of one website's metrics for a period, plus a question.
Answer ONLY from the data provided — never invent numbers. If the data can't answer the question, say what's missing.
Be concise and concrete: lead with the number, then the takeaway. Use the previous_period_totals to describe trends (up/down and rough %).
Money values are in cents. bounceRate and goal rate are 0-1 fractions. revenue.bySource is first-touch attribution; revenue.bySourceLast is last-touch.
Prefer 2-5 short sentences or a tight bullet list. Plain text, no preamble.`;

/** Ask the AI analyst a natural-language question about a site's data. */
export async function askAnalyst(siteId: string, question: string, periodKey: PeriodKey): Promise<AskResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "AI analyst is not configured. Set ANTHROPIC_API_KEY in this app's environment to enable it." };
  }
  const site = getSite(siteId);
  if (!site) return { error: "unknown site" };
  const q = String(question || "").trim().slice(0, 1000);
  if (!q) return { error: "ask a question" };

  try {
    const client = new Anthropic();
    const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
    const context = buildSiteContext(siteId, periodKey);
    const response = await client.messages.create({
      model,
      max_tokens: 1200,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Website: ${site.name} (${site.domain})\nData snapshot:\n${JSON.stringify(context)}\n\nQuestion: ${q}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return { error: "The model declined to answer that." };
    const text = response.content.find((b) => b.type === "text");
    return { answer: text && "text" in text ? text.text.trim() : "(no answer)" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "AI request failed" };
  }
}
