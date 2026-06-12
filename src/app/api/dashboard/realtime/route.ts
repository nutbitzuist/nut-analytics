import { NextRequest, NextResponse } from "next/server";
import { getSite } from "@/lib/db";
import { breakdown, eventCount, recentEvents, realtimeVisitors, resolvePeriod, totals } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const siteId = req.nextUrl.searchParams.get("site") ?? "";
  const site = getSite(siteId);
  if (!site) return NextResponse.json({ error: "unknown site" }, { status: 404 });

  const { from, to } = resolvePeriod("today");

  return NextResponse.json({
    site: { id: site.id, domain: site.domain, name: site.name },
    realtime_visitors: realtimeVisitors(site.id),
    total_events: eventCount(site.id),
    today: totals(site.id, from, to, {}),
    recent_events: recentEvents(site.id, 30),
    top_pages_today: breakdown(site.id, from, to, {}, "path", 10),
    generated_at: Date.now(),
  });
}
