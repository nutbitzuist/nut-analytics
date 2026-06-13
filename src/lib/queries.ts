import { db } from "@/lib/db";

export type Filters = {
  path?: string;
  source?: string;
  country?: string;
  device?: string;
  browser?: string;
  os?: string;
};

export type PeriodKey = "today" | "7d" | "30d" | "90d" | "all";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "all", label: "All time" },
];

const DAY = 86_400_000;
const HOUR = 3_600_000;

export function resolvePeriod(key: PeriodKey): { from: number; to: number; bucketMs: number } {
  const now = Date.now();
  switch (key) {
    case "today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { from: start.getTime(), to: now, bucketMs: HOUR };
    }
    case "7d":
      return { from: now - 7 * DAY, to: now, bucketMs: DAY };
    case "30d":
      return { from: now - 30 * DAY, to: now, bucketMs: DAY };
    case "90d":
      return { from: now - 90 * DAY, to: now, bucketMs: DAY };
    case "all":
      return { from: 0, to: now, bucketMs: DAY };
  }
}

const FILTER_COLUMNS: Record<keyof Filters, string> = {
  path: "path",
  source: "referrer_source",
  country: "country",
  device: "device",
  browser: "browser",
  os: "os",
};

function where(siteId: string, from: number, to: number, filters: Filters) {
  const clauses = ["site_id = ?", "ts >= ?", "ts <= ?"];
  const params: (string | number)[] = [siteId, from, to];
  for (const [key, col] of Object.entries(FILTER_COLUMNS) as [keyof Filters, string][]) {
    const v = filters[key];
    if (v) {
      clauses.push(`${col} = ?`);
      params.push(v);
    }
  }
  return { sql: clauses.join(" AND "), params };
}

export function timeseries(siteId: string, from: number, to: number, bucketMs: number, filters: Filters) {
  const w = where(siteId, from, to, filters);
  const rows = db()
    .prepare(
      `SELECT (ts / ${bucketMs}) * ${bucketMs} AS t,
              COUNT(DISTINCT visitor_id) AS visitors,
              SUM(CASE WHEN type = 'pageview' THEN 1 ELSE 0 END) AS pageviews
       FROM events WHERE ${w.sql}
       GROUP BY t ORDER BY t`
    )
    .all(...w.params) as { t: number; visitors: number; pageviews: number }[];

  // Fill empty buckets so the chart doesn't skip quiet hours/days.
  const map = new Map(rows.map((r) => [r.t, r]));
  const start = rows.length && from === 0 ? rows[0].t : Math.floor(from / bucketMs) * bucketMs;
  const out: { t: number; visitors: number; pageviews: number }[] = [];
  for (let t = start; t <= to; t += bucketMs) {
    out.push(map.get(t) ?? { t, visitors: 0, pageviews: 0 });
  }
  return out;
}

export function totals(siteId: string, from: number, to: number, filters: Filters) {
  const w = where(siteId, from, to, filters);
  const base = db()
    .prepare(
      `SELECT COUNT(DISTINCT visitor_id) AS visitors,
              COUNT(DISTINCT session_id) AS sessions,
              SUM(CASE WHEN type = 'pageview' THEN 1 ELSE 0 END) AS pageviews
       FROM events WHERE ${w.sql}`
    )
    .get(...w.params) as { visitors: number; sessions: number; pageviews: number };

  // Real engaged time + bounce: `dur` sums engagement-event seconds per session
  // (DataFast/Plausible style), `views` counts pageviews so a one-page session bounces.
  const sess = db()
    .prepare(
      `SELECT AVG(views = 1) AS bounce_rate, AVG(dur) AS avg_duration, SUM(dur) AS total_dur
       FROM (
         SELECT session_id,
                SUM(CASE WHEN type = 'pageview' THEN 1 ELSE 0 END) AS views,
                COALESCE(SUM(duration), 0) AS dur
         FROM events WHERE ${w.sql}
         GROUP BY session_id
         HAVING views > 0
       )`
    )
    .get(...w.params) as { bounce_rate: number | null; avg_duration: number | null; total_dur: number | null };

  return {
    visitors: base.visitors ?? 0,
    pageviews: base.pageviews ?? 0,
    sessions: base.sessions ?? 0,
    bounceRate: sess.bounce_rate ?? 0,
    avgDuration: sess.avg_duration ?? 0,
    totalDuration: sess.total_dur ?? 0,
  };
}

/** New vs returning visitors active in the period, judged by each visitor's all-time first event. */
export function newVsReturning(siteId: string, from: number, to: number, filters: Filters) {
  const w = where(siteId, from, to, filters);
  const r = db()
    .prepare(
      `WITH active AS (
         SELECT DISTINCT visitor_id FROM events WHERE ${w.sql}
       ),
       firsts AS (
         SELECT visitor_id, MIN(ts) AS first_ts FROM events WHERE site_id = ? GROUP BY visitor_id
       )
       SELECT
         SUM(CASE WHEN f.first_ts >= ? THEN 1 ELSE 0 END) AS new_visitors,
         SUM(CASE WHEN f.first_ts <  ? THEN 1 ELSE 0 END) AS returning_visitors
       FROM active a JOIN firsts f ON f.visitor_id = a.visitor_id`
    )
    .get(...w.params, siteId, from, from) as { new_visitors: number | null; returning_visitors: number | null };
  return { new: r.new_visitors ?? 0, returning: r.returning_visitors ?? 0 };
}

export type BreakdownRow = { value: string; visitors: number; count: number };

export type RecentEventRow = {
  id: number;
  type: string;
  name: string | null;
  path: string | null;
  referrer_source: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  visitor_id: string;
  session_id: string;
  ts: number;
};

export function breakdown(
  siteId: string,
  from: number,
  to: number,
  filters: Filters,
  column: "path" | "referrer_source" | "country" | "device" | "browser" | "os" | "utm_source" | "utm_campaign" | "utm_medium",
  limit = 10
): BreakdownRow[] {
  const w = where(siteId, from, to, filters);
  return db()
    .prepare(
      `SELECT ${column} AS value,
              COUNT(DISTINCT visitor_id) AS visitors,
              COUNT(*) AS count
       FROM events
       WHERE ${w.sql} AND ${column} IS NOT NULL AND type = 'pageview'
       GROUP BY ${column} ORDER BY visitors DESC LIMIT ${limit}`
    )
    .all(...w.params) as BreakdownRow[];
}

/** Entry (first) or exit (last) pageview path per session, ranked. */
export function entryExitPages(
  siteId: string,
  from: number,
  to: number,
  filters: Filters,
  which: "entry" | "exit",
  limit = 10
): BreakdownRow[] {
  const w = where(siteId, from, to, filters);
  const order = which === "entry" ? "ASC" : "DESC";
  return db()
    .prepare(
      `SELECT path AS value,
              COUNT(DISTINCT visitor_id) AS visitors,
              COUNT(*) AS count
       FROM (
         SELECT path, visitor_id, session_id,
                ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ts ${order}, id ${order}) AS rn
         FROM events WHERE ${w.sql} AND type = 'pageview' AND path IS NOT NULL
       )
       WHERE rn = 1
       GROUP BY path ORDER BY visitors DESC LIMIT ${limit}`
    )
    .all(...w.params) as BreakdownRow[];
}

/** Breakdown of a non-pageview event type (outbound | download | goal) by its label. */
export function eventBreakdown(
  siteId: string,
  from: number,
  to: number,
  filters: Filters,
  eventType: "outbound" | "download" | "goal",
  limit = 10
): BreakdownRow[] {
  const w = where(siteId, from, to, filters);
  return db()
    .prepare(
      `SELECT name AS value,
              COUNT(DISTINCT visitor_id) AS visitors,
              COUNT(*) AS count
       FROM events
       WHERE ${w.sql} AND type = '${eventType}' AND name IS NOT NULL
       GROUP BY name ORDER BY count DESC LIMIT ${limit}`
    )
    .all(...w.params) as BreakdownRow[];
}

export type FunnelStepResult = { label: string; kind: "page" | "goal"; visitors: number; rate: number; dropoff: number };

/**
 * Sequential funnel: counts visitors who completed each step *in order* within the period.
 * A page step matches by pathname (exact, or prefix when it ends with '*'); a goal step
 * matches by goal name. Computed in JS by walking each visitor's events in time order.
 */
export function funnel(
  siteId: string,
  from: number,
  to: number,
  steps: { kind: "page" | "goal"; match: string }[]
): FunnelStepResult[] {
  if (steps.length === 0) return [];
  const rows = db()
    .prepare(
      `SELECT visitor_id, type, name, path, ts, id FROM events
       WHERE site_id = ? AND ts >= ? AND ts <= ? AND (type = 'pageview' OR type = 'goal')
       ORDER BY visitor_id, ts ASC, id ASC`
    )
    .all(siteId, from, to) as { visitor_id: string; type: string; name: string | null; path: string | null }[];

  const matches = (step: { kind: "page" | "goal"; match: string }, ev: { type: string; name: string | null; path: string | null }) => {
    if (step.kind === "goal") return ev.type === "goal" && ev.name === step.match;
    if (ev.type !== "pageview" || !ev.path) return false;
    const p = ev.path.split("?")[0];
    if (step.match.endsWith("*")) return p.startsWith(step.match.slice(0, -1));
    return p === step.match || ev.path === step.match;
  };

  const reached = new Array(steps.length).fill(0);
  let currentVisitor: string | null = null;
  let idx = 0;
  const finalize = () => {
    for (let i = 0; i < idx; i++) reached[i]++;
  };
  for (const ev of rows) {
    if (ev.visitor_id !== currentVisitor) {
      if (currentVisitor !== null) finalize();
      currentVisitor = ev.visitor_id;
      idx = 0;
    }
    if (idx < steps.length && matches(steps[idx], ev)) idx++;
  }
  if (currentVisitor !== null) finalize();

  const top = reached[0] || 0;
  return steps.map((s, i) => ({
    label: s.match,
    kind: s.kind,
    visitors: reached[i],
    rate: top ? reached[i] / top : 0,
    dropoff: i === 0 ? 0 : (reached[i - 1] ? 1 - reached[i] / reached[i - 1] : 0),
  }));
}

/** The period immediately before [from,to], same length — for trend comparison. */
export function previousRange(from: number, to: number): { from: number; to: number } {
  const len = to - from;
  return { from: from - len, to: from };
}

export type GoalRow = { name: string; events: number; conversions: number; rate: number };

export function goals(siteId: string, from: number, to: number, filters: Filters): GoalRow[] {
  const w = where(siteId, from, to, filters);
  const totalVisitors = (
    db()
      .prepare(`SELECT COUNT(DISTINCT visitor_id) AS n FROM events WHERE ${w.sql}`)
      .get(...w.params) as { n: number }
  ).n;

  const rows = db()
    .prepare(
      `SELECT name, COUNT(*) AS events, COUNT(DISTINCT visitor_id) AS conversions
       FROM events
       WHERE ${w.sql} AND type = 'goal' AND name IS NOT NULL
       GROUP BY name ORDER BY conversions DESC`
    )
    .all(...w.params) as { name: string; events: number; conversions: number }[];

  // Registered goals show up even before their first conversion.
  const registered = db().prepare("SELECT name FROM goals WHERE site_id = ?").all(siteId) as { name: string }[];
  for (const g of registered) {
    if (!rows.some((r) => r.name === g.name)) rows.push({ name: g.name, events: 0, conversions: 0 });
  }

  return rows.map((r) => ({
    ...r,
    rate: totalVisitors ? r.conversions / totalVisitors : 0,
  }));
}

export function revenue(siteId: string, from: number, to: number, filters: Filters = {}) {
  const activeFilters = Object.keys(filters).length > 0;
  const fw = where(siteId, from, to, filters);
  const filterSql = activeFilters
    ? `AND p.visitor_id IN (SELECT DISTINCT visitor_id FROM events WHERE ${fw.sql})`
    : "";
  const filterParams = activeFilters ? fw.params : [];

  const total = db()
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS amount, COUNT(*) AS payments, COUNT(DISTINCT COALESCE(p.customer_id, p.id)) AS customers
       FROM payments p WHERE p.site_id = ? AND p.ts >= ? AND p.ts <= ? ${filterSql}`
    )
    .get(siteId, from, to, ...filterParams) as { amount: number; payments: number; customers: number };

  // Attribute each payment to the visitor's first-touch channel.
  const bySource = db()
    .prepare(
      `SELECT COALESCE(
                (SELECT e.referrer_source FROM events e
                 WHERE e.site_id = p.site_id AND e.visitor_id = p.visitor_id
                 ORDER BY e.ts ASC LIMIT 1),
                'Unattributed'
              ) AS value,
              SUM(p.amount) AS amount,
              COUNT(*) AS payments
       FROM payments p
       WHERE p.site_id = ? AND p.ts >= ? AND p.ts <= ? ${filterSql}
       GROUP BY value ORDER BY amount DESC LIMIT 10`
    )
    .all(siteId, from, to, ...filterParams) as { value: string; amount: number; payments: number }[];

  return { ...total, bySource };
}

export function realtimeVisitors(siteId: string): number {
  const r = db()
    .prepare("SELECT COUNT(DISTINCT visitor_id) AS n FROM events WHERE site_id = ? AND ts >= ?")
    .get(siteId, Date.now() - 5 * 60_000) as { n: number };
  return r.n;
}

export function eventCount(siteId: string): number {
  const r = db().prepare("SELECT COUNT(*) AS n FROM events WHERE site_id = ?").get(siteId) as { n: number };
  return r.n;
}

export function recentEvents(siteId: string, limit = 25): RecentEventRow[] {
  return db()
    .prepare(
      `SELECT id, type, name, path, referrer_source, country, browser, os, device, visitor_id, session_id, ts
       FROM events
       WHERE site_id = ?
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(siteId, Math.max(1, Math.min(limit, 100))) as RecentEventRow[];
}
