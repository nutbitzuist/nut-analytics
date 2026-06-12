import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/parse";
import { checkRateLimit } from "@/lib/rateLimit";
import { authenticateApiRequest, requireSite } from "@/lib/api-auth";
import { resolvePeriod } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Server-side event API — track goals from your backend or AI agent.
 *
 *   POST /api/v1/events
 *   Authorization: Bearer nut_sk_...   OR   Basic (owner)
 *
 *   { "name": "signup", "visitor_id": "<nut_vid>", "site": "xxx", "metadata": {...} }
 *
 * Your AI agent can use this (and other v1 endpoints) to record events on your behalf.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const siteResult = await requireSite(req, auth);
  if ("error" in siteResult) {
    return NextResponse.json({ error: siteResult.error }, { status: 400 });
  }
  const site = siteResult.site;

  // Light per-IP protection even for authenticated server-side events
  const ip = clientIp(req.headers);
  const { allowed, retryAfter } = checkRateLimit(`events:${ip}`, 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(retryAfter || 60) } });
  }

  let body: { name?: string; visitor_id?: string; metadata?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const visitorId = body.visitor_id ? String(body.visitor_id).slice(0, 64) : `api-${crypto.randomUUID()}`;

  // Inherit the visitor's last known context so server-side goals still
  // break down by channel/country/device on the dashboard.
  const last = db()
    .prepare(
      `SELECT referrer_source, utm_source, utm_medium, utm_campaign, country, region, city, browser, os, device
       FROM events WHERE site_id = ? AND visitor_id = ? ORDER BY ts DESC LIMIT 1`
    )
    .get(site.id, visitorId) as Record<string, string | null> | undefined;

  db()
    .prepare(
      `INSERT INTO events
        (site_id, type, name, path, referrer, referrer_source,
         utm_source, utm_medium, utm_campaign, utm_term, utm_content,
         visitor_id, session_id, country, region, city,
         browser, os, device, screen_w, meta, ts)
       VALUES (?, 'goal', ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    )
    .run(
      site.id,
      String(body.name).slice(0, 64),
      last?.referrer_source ?? "API",
      last?.utm_source ?? null,
      last?.utm_medium ?? null,
      last?.utm_campaign ?? null,
      visitorId,
      `api-${crypto.randomUUID()}`,
      last?.country ?? null,
      last?.region ?? null,
      last?.city ?? null,
      last?.browser ?? null,
      last?.os ?? null,
      last?.device ?? null,
      body.metadata ? JSON.stringify(body.metadata).slice(0, 2048) : null,
      Date.now()
    );

  return NextResponse.json({ ok: true, visitor_id: visitorId });
}

/**
 * Query raw events (for agent analysis, debugging, exports beyond the limited /export).
 * Supports owner Basic or site key.
 *
 * GET /api/v1/events?period=7d&limit=100&type=pageview|goal&visitor_id=...&path=...
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const siteRes = await requireSite(req, auth);
  if ("error" in siteRes) {
    return NextResponse.json({ error: siteRes.error }, { status: 400 });
  }
  const site = siteRes.site;

  const { from, to } = resolvePeriod((req.nextUrl.searchParams.get("period") as any) || "7d");

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "100", 10), 1000);
  const type = req.nextUrl.searchParams.get("type");
  const visitorId = req.nextUrl.searchParams.get("visitor_id");
  const path = req.nextUrl.searchParams.get("path");

  let sql = `SELECT * FROM events WHERE site_id = ? AND ts >= ? AND ts <= ?`;
  const params: any[] = [site.id, from, to];

  if (type) {
    sql += ` AND type = ?`;
    params.push(type);
  }
  if (visitorId) {
    sql += ` AND visitor_id = ?`;
    params.push(visitorId);
  }
  if (path) {
    sql += ` AND path = ?`;
    params.push(path);
  }

  sql += ` ORDER BY ts DESC LIMIT ?`;
  params.push(limit);

  const events = db().prepare(sql).all(...params);

  return NextResponse.json({
    site: site.id,
    count: events.length,
    events,
  });
}
