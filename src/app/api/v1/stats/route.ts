import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, requireSite } from "@/lib/api-auth";
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
 * Stats API — full analytics read access.
 *
 * Works with:
 *   - Bearer nut_sk_...          (recommended for agents, scoped to one site)
 *   - Basic auth (owner)         (your AI agent can use your dashboard password for full power)
 *
 * Query params:
 *   period: today | 7d | 30d | 90d | all   (default 7d)
 *   site: (only needed in owner mode) site id or domain
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const siteResult = await requireSite(req, auth);
  if ("error" in siteResult) {
    return NextResponse.json({ error: siteResult.error }, { status: 400 });
  }
  const site = siteResult.site;

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
