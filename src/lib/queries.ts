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

  const sess = db()
    .prepare(
      `SELECT AVG(views = 1) AS bounce_rate, AVG(dur) AS avg_duration
       FROM (
         SELECT session_id,
                SUM(CASE WHEN type = 'pageview' THEN 1 ELSE 0 END) AS views,
                (MAX(ts) - MIN(ts)) / 1000.0 AS dur
         FROM events WHERE ${w.sql}
         GROUP BY session_id
       )`
    )
    .get(...w.params) as { bounce_rate: number | null; avg_duration: number | null };

  return {
    visitors: base.visitors ?? 0,
    pageviews: base.pageviews ?? 0,
    sessions: base.sessions ?? 0,
    bounceRate: sess.bounce_rate ?? 0,
    avgDuration: sess.avg_duration ?? 0,
  };
}

export type BreakdownRow = { value: string; visitors: number; count: number };

export function breakdown(
  siteId: string,
  from: number,
  to: number,
  filters: Filters,
  column: "path" | "referrer_source" | "country" | "device" | "browser" | "os" | "utm_campaign" | "utm_medium",
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
