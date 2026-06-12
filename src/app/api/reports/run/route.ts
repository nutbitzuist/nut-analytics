import { NextRequest, NextResponse } from "next/server";
import { buildReport } from "@/lib/report";
import { runReport } from "@/lib/scheduler";
import { channelsConfigured } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Manually trigger (or preview) a report.
 *
 *   GET /api/reports/run?kind=daily            preview without sending
 *   GET /api/reports/run?kind=weekly&send=1    build and send now
 *
 * Auth: Basic auth with the dashboard password (same as the dashboard).
 */
export async function GET(req: NextRequest) {
  // Support dedicated token for reports (safer when using DASHBOARD_PASSWORD_HASH for the UI login)
  const reportsToken = process.env.REPORTS_BASIC_TOKEN || process.env.DASHBOARD_PASSWORD;
  if (reportsToken) {
    const auth = req.headers.get("authorization") ?? "";
    let ok = false;
    if (auth.startsWith("Basic ")) {
      try {
        ok = atob(auth.slice(6)).split(":")[1] === reportsToken;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      return new NextResponse("Authentication required", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Nut Analytics"' },
      });
    }
  }

  const kind = req.nextUrl.searchParams.get("kind") === "weekly" ? "weekly" : "daily";
  const send = req.nextUrl.searchParams.get("send") === "1";

  if (send) {
    const result = await runReport(kind, true);
    return NextResponse.json({ kind, sent: result.sent, channels: channelsConfigured(), report: result.text });
  }
  const { text } = await buildReport(kind);
  return NextResponse.json({ kind, sent: false, preview: true, channels: channelsConfigured(), report: text });
}
