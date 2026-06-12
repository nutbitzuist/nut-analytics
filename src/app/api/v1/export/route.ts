import { NextRequest, NextResponse } from "next/server";
import { getSiteByApiKey } from "@/lib/db";
import {
  breakdown,
  goals,
  PERIODS,
  resolvePeriod,
  revenue,
  totals,
  type PeriodKey,
  type Filters,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Export current analytics data as CSV (or JSON).
 *
 * GET /api/v1/export?kind=events|payments|goals|summary&period=30d
 * Authorization: Bearer nut_sk_...
 *
 * kind=events returns pageviews + goals in the period (limited).
 * kind=payments returns the revenue rows.
 * kind=summary returns the same payload as /stats but as CSV-friendly rows.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  const site = key ? getSiteByApiKey(key) : undefined;
  if (!site) {
    return NextResponse.json({ error: "invalid or missing API key" }, { status: 401 });
  }

  const p = req.nextUrl.searchParams.get("period") ?? "30d";
  const periodKey = (PERIODS.some((x) => x.key === p) ? p : "30d") as PeriodKey;
  const { from, to } = resolvePeriod(periodKey);

  const kind = (req.nextUrl.searchParams.get("kind") || "summary").toLowerCase();
  const format = (req.nextUrl.searchParams.get("format") || "csv").toLowerCase();

  // Reuse the same filters shape the dashboard uses (path, source, etc.)
  const filters: Filters = {};
  const allowed = ["path", "source", "country", "device", "browser", "os"] as const;
  for (const k of allowed) {
    const v = req.nextUrl.searchParams.get(k);
    if (v) (filters as any)[k] = v;
  }

  if (kind === "events") {
    // Simple export of recent events (pageviews + goals) — limited for safety
    const rows = dbExportEvents(site.id, from, to, filters, 5000);
    return toResponse(rows, `events_${site.domain}`, format);
  }

  if (kind === "payments") {
    const rev = revenue(site.id, from, to, filters);
    const rows = rev.bySource.map((r) => ({ source: r.value, amount_cents: r.amount, payments: r.payments }));
    return toResponse(rows, `payments_${site.domain}`, format);
  }

  if (kind === "goals") {
    const g = goals(site.id, from, to, filters);
    return toResponse(g, `goals_${site.domain}`, format);
  }

  // default: summary (key metrics + top sources)
  const t = totals(site.id, from, to, filters);
  const rev = revenue(site.id, from, to, filters);
  const topSources = breakdown(site.id, from, to, filters, "referrer_source", 10);

  const summary = [
    { metric: "visitors", value: t.visitors },
    { metric: "pageviews", value: t.pageviews },
    { metric: "sessions", value: t.sessions },
    { metric: "bounce_rate", value: Number((t.bounceRate * 100).toFixed(1)) },
    { metric: "avg_duration_sec", value: Math.round(t.avgDuration) },
    { metric: "revenue_cents", value: rev.amount },
    { metric: "payments", value: rev.payments },
  ];

  return toResponse({ summary, top_sources: topSources }, `summary_${site.domain}`, format);
}

function dbExportEvents(siteId: string, from: number, to: number, filters: Filters, limit: number) {
  // Lightweight direct query for export (avoids pulling the entire wide events table in most cases)
  const { sql, params } = buildWhere(siteId, from, to, filters);
  const d = require("@/lib/db").db(); // avoid circular if any
  return d
    .prepare(
      `SELECT ts, type, name, path, referrer_source, country, device, browser, os, visitor_id
       FROM events WHERE ${sql} ORDER BY ts DESC LIMIT ${limit}`
    )
    .all(...params);
}

function buildWhere(siteId: string, from: number, to: number, filters: Filters) {
  const clauses = ["site_id = ?", "ts >= ?", "ts <= ?"];
  const params: any[] = [siteId, from, to];
  const map: Record<string, string> = {
    path: "path",
    source: "referrer_source",
    country: "country",
    device: "device",
    browser: "browser",
    os: "os",
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (filters as any)[k];
    if (v) {
      clauses.push(`${col} = ?`);
      params.push(v);
    }
  }
  return { sql: clauses.join(" AND "), params };
}

function toCsv(rows: any[]): string {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const head = headers.join(",");
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\n");
  return head + "\n" + body;
}

function toResponse(data: any, filenameBase: string, format: string) {
  if (format === "json") {
    return NextResponse.json(data, {
      headers: {
        "Content-Disposition": `attachment; filename="${filenameBase}.json"`,
      },
    });
  }
  const csv = Array.isArray(data) ? toCsv(data) : toCsv(flattenForCsv(data));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
    },
  });
}

function flattenForCsv(obj: any): any[] {
  // Turn { summary: [...], top_sources: [...] } into a single table-ish export
  const out: any[] = [];
  if (obj.summary) out.push(...obj.summary.map((s: any) => ({ section: "summary", ...s })));
  if (obj.top_sources) out.push(...obj.top_sources.map((s: any) => ({ section: "top_sources", ...s })));
  return out.length ? out : [obj];
}