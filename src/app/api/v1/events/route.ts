import { NextRequest, NextResponse } from "next/server";
import { db, getSiteByApiKey } from "@/lib/db";
import { clientIp } from "@/lib/parse";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Server-side event API — track goals from your backend (signups, upgrades,
 * webhook-driven conversions) where no browser is involved.
 *
 *   POST /api/v1/events
 *   Authorization: Bearer nut_sk_...
 *   { "name": "signup", "visitor_id": "<nut_vid cookie, if known>", "metadata": {...} }
 *
 * Pass the visitor's `nut_vid` cookie when you have it (e.g. from the signup
 * request) so the goal joins the visitor's browsing history and channel.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  const site = key ? getSiteByApiKey(key) : undefined;
  if (!site) {
    return NextResponse.json({ error: "invalid or missing API key" }, { status: 401 });
  }

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
