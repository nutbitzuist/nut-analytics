import { NextRequest, NextResponse } from "next/server";
import { db, getSite } from "@/lib/db";
import { clientIp, geoResolve, isBot, parseUA, referrerSource } from "@/lib/parse";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { site: siteId, type, name, url, ref, vid, sid, w, h, d, sd, n, dest, meta } = body ?? {};

    const KNOWN_TYPES = ["pageview", "goal", "engagement", "outbound", "download"];
    if (!siteId || !vid || !sid || !KNOWN_TYPES.includes(type)) {
      return NextResponse.json({ error: "bad request" }, { status: 400, headers: CORS });
    }

    // Basic per-IP rate limit for public ingest (protects the DB from abuse)
    const ip = clientIp(req.headers);
    const { allowed, retryAfter } = checkRateLimit(`track:${ip}`, 120, 60_000); // 120/min per IP
    if (!allowed) {
      return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { ...CORS, "Retry-After": String(retryAfter || 60) } });
    }

    const site = getSite(String(siteId));
    if (!site) {
      return NextResponse.json({ error: "unknown site" }, { status: 404, headers: CORS });
    }

    const ua = req.headers.get("user-agent");
    if (isBot(ua)) {
      return NextResponse.json({ ok: true, skipped: "bot" }, { headers: CORS });
    }

    let path = "/";
    let utm: Record<string, string | null> = {
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
    };
    try {
      const u = new URL(String(url));
      path = (u.pathname || "/") + u.search;
      for (const k of Object.keys(utm)) utm[k] = u.searchParams.get(k);
    } catch {
      /* keep defaults */
    }

    const { browser, os, device } = parseUA(ua!);
    const geo = geoResolve(req.headers, clientIp(req.headers));
    const referrer = ref ? String(ref).slice(0, 512) : null;

    // name carries the goal name, the outbound host, or the download filename.
    const eventName =
      type === "goal" || type === "outbound" || type === "download"
        ? String(name ?? "").slice(0, 128) || null
        : null;
    // meta carries goal metadata or the destination url for outbound/download clicks.
    let metaJson: string | null = null;
    if (meta) metaJson = JSON.stringify(meta).slice(0, 2048);
    else if (dest) metaJson = JSON.stringify({ dest: String(dest).slice(0, 1024) });

    const clampInt = (v: unknown, max: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null;

    db()
      .prepare(
        `INSERT INTO events
          (site_id, type, name, path, referrer, referrer_source,
           utm_source, utm_medium, utm_campaign, utm_term, utm_content,
           visitor_id, session_id, country, region, city,
           browser, os, device, screen_w, screen_h, duration, scroll, is_new, meta, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        site.id,
        type,
        eventName,
        path.slice(0, 512),
        referrer,
        referrerSource(referrer, utm.utm_source, site.domain),
        utm.utm_source,
        utm.utm_medium,
        utm.utm_campaign,
        utm.utm_term,
        utm.utm_content,
        String(vid).slice(0, 64),
        String(sid).slice(0, 64),
        geo.country,
        geo.region,
        geo.city,
        browser,
        os,
        device,
        clampInt(w, 100000),
        clampInt(h, 100000),
        type === "engagement" ? clampInt(d, 86400) : null,
        type === "engagement" ? clampInt(sd, 100) : null,
        type === "pageview" ? (n === 1 || n === "1" ? 1 : 0) : null,
        metaJson,
        Date.now()
      );

    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch {
    return NextResponse.json({ error: "server error" }, { status: 500, headers: CORS });
  }
}
