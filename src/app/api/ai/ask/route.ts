import { NextRequest, NextResponse } from "next/server";
import { askAnalyst } from "@/lib/ai";
import { PERIODS, type PeriodKey } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AI analyst — ask a natural-language question about a site's analytics.
 * Dashboard-gated (not a public path); the dashboard sends the session cookie.
 *
 * POST { site: string, question: string, period?: PeriodKey }
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const siteId = String(body?.site ?? "");
  const question = String(body?.question ?? "");
  const period = (PERIODS.some((p) => p.key === body?.period) ? body.period : "30d") as PeriodKey;
  if (!siteId) return NextResponse.json({ error: "site is required" }, { status: 400 });

  const result = await askAnalyst(siteId, question, period);
  if ("error" in result) {
    const status = result.error === "unknown site" ? 404 : result.error.includes("not configured") ? 503 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
