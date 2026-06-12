import { NextRequest, NextResponse } from "next/server";
import { addGoal, listGoals, removeGoal } from "@/lib/db";
import { authenticateApiRequest, requireSite } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Goals API (registered goals that appear on the dashboard even with 0 conversions).
 *
 * GET    /api/v1/goals?site=xxx
 * POST   /api/v1/goals          { "name": "signup", "site": "..." }
 * DELETE /api/v1/goals          { "name": "signup", "site": "..." }
 *
 * Your AI agent can use this to register important conversion events.
 */

export async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const siteRes = await requireSite(req, auth);
  if ("error" in siteRes) return NextResponse.json({ error: siteRes.error }, { status: 400 });

  const goals = listGoals(siteRes.site.id);
  return NextResponse.json({ site: siteRes.site.id, goals });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const siteRes = await requireSite(req, auth);
  if ("error" in siteRes) return NextResponse.json({ error: siteRes.error }, { status: 400 });

  let body: { name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  addGoal(siteRes.site.id, body.name);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const siteRes = await requireSite(req, auth);
  if ("error" in siteRes) return NextResponse.json({ error: siteRes.error }, { status: 400 });

  let body: { name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  removeGoal(siteRes.site.id, body.name);
  return NextResponse.json({ ok: true });
}