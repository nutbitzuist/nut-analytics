import { NextRequest, NextResponse } from "next/server";
import { getSiteByApiKey } from "@/lib/db";
import {
  breakdown,
  goals,
  PERIODS,
  realtimeVisitors,
  resolvePeriod,
  revenue,
  timeseries,
  totals,
  type PeriodKey,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Stats API.
 *
 *   GET /api/v1/stats?period=7d
 *   Authorization: Bearer nut_sk_...
 *
 * period: today | 7d | 30d | 90d | all   (default 7d)
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  const site = key ? getSiteByApiKey(key) : undefined;
  if (!site) {
    return NextResponse.json({ error: "invalid or missing API key" }, { status: 401 });
  }

  const p = req.nextUrl.searchParams.get("period") ?? "7d";
  const periodKey = (PERIODS.some((x) => x.key === p) ? p : "7d") as PeriodKey;
  const { from, to, bucketMs } = resolvePeriod(periodKey);

  return NextResponse.json({
    site: { id: site.id, domain: site.domain, name: site.name },
    period: periodKey,
    range: { from, to },
    realtime_visitors: realtimeVisitors(site.id),
    totals: totals(site.id, from, to, {}),
    timeseries: timeseries(site.id, from, to, bucketMs, {}),
    pages: breakdown(site.id, from, to, {}, "path"),
    sources: breakdown(site.id, from, to, {}, "referrer_source"),
    countries: breakdown(site.id, from, to, {}, "country"),
    devices: breakdown(site.id, from, to, {}, "device"),
    browsers: breakdown(site.id, from, to, {}, "browser"),
    os: breakdown(site.id, from, to, {}, "os"),
    goals: goals(site.id, from, to, {}),
    revenue: revenue(site.id, from, to),
  });
}
