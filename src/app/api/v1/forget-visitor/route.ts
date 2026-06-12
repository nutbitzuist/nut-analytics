import { NextRequest, NextResponse } from "next/server";
import { forgetVisitor } from "@/lib/db";
import { authenticateApiRequest, requireSite } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Privacy / "Right to be forgotten" API.
 *
 * POST /api/v1/forget-visitor
 * Authorization: Bearer nut_sk_... or Basic (owner)
 *
 * Body:
 *   { "visitor_id": "the-nut_vid-value", "site": "optional-in-owner-mode" }
 *
 * Deletes all events for that visitor on the site.
 * Payments are unlinked (become "Unattributed") but revenue totals are preserved.
 *
 * Your AI agent can call this on your behalf when you receive deletion requests.
 */

export async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const siteRes = await requireSite(req, auth);
  if ("error" in siteRes) {
    return NextResponse.json({ error: siteRes.error }, { status: 400 });
  }

  let body: { visitor_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const vid = (body.visitor_id || "").trim();
  if (!vid) {
    return NextResponse.json({ error: "visitor_id is required" }, { status: 400 });
  }

  const result = forgetVisitor(siteRes.site.id, vid);

  return NextResponse.json({
    ok: true,
    site: siteRes.site.id,
    visitor_id: vid,
    events_deleted: result.eventsDeleted,
  });
}