import { NextRequest, NextResponse } from "next/server";
import { buildReport } from "@/lib/report";
import { runReport } from "@/lib/scheduler";
import { channelsConfigured } from "@/lib/notify";
import { authenticateApiRequest } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Reports API - trigger daily/weekly summaries and AI growth memos.
 *
 * GET /api/v1/reports?kind=daily|weekly&send=0|1
 *
 * Supports:
 *   - Bearer nut_sk_* (for the site, but reports are cross-site for owner)
 *   - Basic auth with dashboard password (recommended for agents)
 *
 * kind: daily or weekly (default daily)
 * send: 1 to actually deliver via configured channels (Telegram/email), 0 for preview only
 *
 * Your AI agent can use this to periodically analyze performance and get AI insights.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Reports are inherently owner-level (cross-site), so we prefer owner auth but allow site keys too
  // (a site key will still work for preview, as reports are global for the owner).

  const kindParam = req.nextUrl.searchParams.get("kind");
  const kind = kindParam === "weekly" ? "weekly" : "daily";

  const send = req.nextUrl.searchParams.get("send") === "1";

  if (send) {
    const result = await runReport(kind, true);
    return NextResponse.json({
      kind,
      sent: result.sent,
      channels: channelsConfigured(),
      report: result.text,
    });
  }

  const { text } = await buildReport(kind);
  return NextResponse.json({
    kind,
    sent: false,
    preview: true,
    channels: channelsConfigured(),
    report: text,
  });
}