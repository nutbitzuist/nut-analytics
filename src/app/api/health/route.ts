import { NextResponse } from "next/server";
import { listSites } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Lightweight healthcheck for Docker / load balancers / uptime monitors.
 * Returns 200 + basic info when the DB is reachable.
 */
export async function GET() {
  try {
    const sites = listSites();
    return NextResponse.json({
      ok: true,
      time: new Date().toISOString(),
      sites: sites.length,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}