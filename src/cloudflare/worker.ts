type D1Result<T = unknown> = { results?: T[]; success?: boolean; meta?: unknown };
type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
};
type D1Database = { prepare(sql: string): D1PreparedStatement };
type AssetFetcher = { fetch(input: Request): Promise<Response> };

export interface Env {
  DB: D1Database;
  ASSETS?: AssetFetcher;
  DASHBOARD_PASSWORD?: string;
  REPORTS_BASIC_TOKEN?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  CF_MIGRATION_WRITE_MODE?: string;
}

type Site = { id: string; domain: string; name: string; created_at: number; api_key: string };
type Auth = { type: "owner"; sites: Site[] } | { type: "site"; site: Site } | { error: string; status: number };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Stripe-Signature",
};

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const BOT_PATTERN = /bot|crawl|spider|slurp|bingpreview|pingdom|lighthouse|headless|phantomjs|scrapy|httpclient|python-requests|curl|wget|facebookexternalhit|monitoring|uptime/i;
const SOURCES: [RegExp, string][] = [
  [/google\./i, "Google"], [/bing\./i, "Bing"], [/duckduckgo\./i, "DuckDuckGo"], [/search\.brave\./i, "Brave Search"],
  [/yandex\./i, "Yandex"], [/baidu\./i, "Baidu"], [/ecosia\./i, "Ecosia"], [/(twitter\.com|^t\.co$|\bx\.com)/i, "X (Twitter)"],
  [/facebook\.|fb\.com|l\.facebook/i, "Facebook"], [/instagram\./i, "Instagram"], [/linkedin\.|lnkd\.in/i, "LinkedIn"],
  [/reddit\.|redd\.it/i, "Reddit"], [/news\.ycombinator|hckrnews/i, "Hacker News"], [/producthunt\./i, "Product Hunt"],
  [/youtube\.|youtu\.be/i, "YouTube"], [/tiktok\./i, "TikTok"], [/pinterest\./i, "Pinterest"], [/github\./i, "GitHub"],
  [/substack\./i, "Substack"], [/medium\./i, "Medium"], [/(^|\.)t\.me$|telegram\./i, "Telegram"], [/whatsapp\./i, "WhatsApp"],
  [/chatgpt\.com|chat\.openai/i, "ChatGPT"], [/perplexity\./i, "Perplexity"], [/claude\.ai/i, "Claude"], [/gemini\.google/i, "Gemini"],
];

const rateBuckets = new Map<string, { count: number; reset: number }>();

function writeModeEnabled(env: Env): boolean {
  return env.CF_MIGRATION_WRITE_MODE === "d1";
}

function writeModeBlocked(): Response {
  return json(
    { error: "cloudflare_migration_writes_disabled", failClosed: true },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), { ...init, headers: { ...JSON_HEADERS, ...(init.headers || {}) } });
}

function text(data: string, init: ResponseInit = {}): Response {
  return new Response(data, init);
}

function clampInt(v: unknown, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null;
}

function randomId(len = 12): string {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

function newApiKey(): string {
  return `nut_sk_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function clientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf;
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "127.0.0.1";
}

function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.reset <= now) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return { allowed: true };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, retryAfter: Math.ceil((bucket.reset - now) / 1000) };
}

function referrerSource(referrer: string | null | undefined, utmSource: string | null | undefined, siteDomain: string): string {
  if (utmSource) return utmSource;
  if (!referrer) return "Direct";
  let host = "";
  try { host = new URL(referrer).hostname.replace(/^www\./, ""); } catch { return "Direct"; }
  const self = siteDomain.replace(/^www\./, "");
  if (!host || host === self || host.endsWith(`.${self}`) || self.endsWith(`.${host}`)) return "Direct";
  for (const [re, name] of SOURCES) if (re.test(host)) return name;
  return host;
}

function parseUA(ua: string | null) {
  const s = ua || "";
  const browser = /Firefox\//.test(s) ? "Firefox" : /Edg\//.test(s) ? "Edge" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Unknown";
  const os = /Windows/i.test(s) ? "Windows" : /Android/i.test(s) ? "Android" : /(iPhone|iPad|iOS)/i.test(s) ? "iOS" : /Mac OS X|Macintosh/i.test(s) ? "macOS" : /Linux/i.test(s) ? "Linux" : "Unknown";
  const device = /iPad|Tablet/i.test(s) ? "Tablet" : /Mobile|Android|iPhone/i.test(s) ? "Mobile" : "Desktop";
  return { browser, os, device };
}

function geoResolve(headers: Headers) {
  const h = (k: string) => {
    const v = headers.get(k);
    return v && v.trim() ? v.trim() : null;
  };
  const country = h("cf-ipcountry") || h("x-vercel-ip-country") || h("x-geo-country") || h("x-country-code");
  let city = h("x-vercel-ip-city") || h("cf-ipcity") || h("x-geo-city");
  try { if (city) city = decodeURIComponent(city); } catch {}
  return { country: country && country !== "XX" && country !== "T1" ? country.toUpperCase() : null, region: h("x-vercel-ip-country-region") || h("cf-region-code") || h("x-geo-region"), city };
}

async function listSites(db: D1Database): Promise<Site[]> {
  const { results } = await db.prepare("SELECT * FROM sites ORDER BY created_at ASC").all<Site>();
  return results || [];
}

async function getSite(db: D1Database, id: string): Promise<Site | null> {
  return (await db.prepare("SELECT * FROM sites WHERE id = ?").bind(id).first<Site>()) || null;
}

async function getSiteByApiKey(db: D1Database, key: string): Promise<Site | null> {
  return (await db.prepare("SELECT * FROM sites WHERE api_key = ?").bind(key).first<Site>()) || null;
}

async function getSiteByDomain(db: D1Database, domain: string): Promise<Site | null> {
  return (await db.prepare("SELECT * FROM sites WHERE domain = ?").bind(domain.toLowerCase()).first<Site>()) || null;
}

async function authenticate(req: Request, env: Env): Promise<Auth> {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const site = await getSiteByApiKey(env.DB, auth.replace(/^Bearer\s+/i, "").trim());
    if (!site) return { error: "invalid site key", status: 401 };
    return { type: "site", site };
  }
  if (auth.toLowerCase().startsWith("basic ")) {
    let password = "";
    try { password = atob(auth.slice(6)).split(":")[1] || ""; } catch { return { error: "invalid basic auth", status: 401 }; }
    const expected = env.REPORTS_BASIC_TOKEN || env.DASHBOARD_PASSWORD;
    if (expected && password === expected) return { type: "owner", sites: await listSites(env.DB) };
  }
  return { error: "missing or invalid Authorization. Use Bearer site api_key or Basic owner password.", status: 401 };
}

async function requireSite(req: Request, auth: Exclude<Auth, { error: string }>, env: Env): Promise<{ site: Site } | { error: string; status: number }> {
  if (auth.type === "site") return { site: auth.site };
  const url = new URL(req.url);
  const ref = url.searchParams.get("site") || url.searchParams.get("site_id") || url.searchParams.get("id");
  if (!ref) {
    if (auth.sites.length === 1) return { site: auth.sites[0] };
    return { error: "site is required in owner mode", status: 400 };
  }
  const site = (await getSite(env.DB, ref)) || (await getSiteByDomain(env.DB, ref));
  if (!site) return { error: "site not found", status: 404 };
  return { site };
}

async function handleTrack(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, { status: 405, headers: CORS });
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad request" }, { status: 400, headers: CORS }); }
  const { site: siteId, type, name, url, ref, vid, sid, w, h, d, sd, n, dest, meta } = body ?? {};
  const known = ["pageview", "goal", "engagement", "outbound", "download"];
  if (!siteId || !vid || !sid || !known.includes(type)) return json({ error: "bad request" }, { status: 400, headers: CORS });
  const ip = clientIp(req.headers);
  const limited = checkRateLimit(`track:${ip}`, 120, 60_000);
  if (!limited.allowed) return json({ error: "rate limited" }, { status: 429, headers: { ...CORS, "Retry-After": String(limited.retryAfter || 60) } });
  const site = await getSite(env.DB, String(siteId));
  if (!site) return json({ error: "unknown site" }, { status: 404, headers: CORS });
  const ua = req.headers.get("user-agent");
  if (!ua || BOT_PATTERN.test(ua)) return json({ ok: true, skipped: "bot" }, { headers: CORS });
  let pathname = "/";
  const utm: Record<string, string | null> = { utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null };
  try {
    const u = new URL(String(url));
    pathname = (u.pathname || "/") + u.search;
    for (const k of Object.keys(utm)) utm[k] = u.searchParams.get(k);
  } catch {}
  const parsed = parseUA(ua);
  const geo = geoResolve(req.headers);
  const referrer = ref ? String(ref).slice(0, 512) : null;
  const eventName = type === "goal" || type === "outbound" || type === "download" ? String(name ?? "").slice(0, 128) || null : null;
  let metaJson: string | null = null;
  if (meta) metaJson = JSON.stringify(meta).slice(0, 2048);
  else if (dest) metaJson = JSON.stringify({ dest: String(dest).slice(0, 1024) });
  await env.DB.prepare(`INSERT INTO events
    (site_id, type, name, path, referrer, referrer_source, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
     visitor_id, session_id, country, region, city, browser, os, device, screen_w, screen_h, duration, scroll, is_new, meta, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(site.id, type, eventName, pathname.slice(0, 512), referrer, referrerSource(referrer, utm.utm_source, site.domain), utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_term, utm.utm_content, String(vid).slice(0, 64), String(sid).slice(0, 64), geo.country, geo.region, geo.city, parsed.browser, parsed.os, parsed.device, clampInt(w, 100000), clampInt(h, 100000), type === "engagement" ? clampInt(d, 86400) : null, type === "engagement" ? clampInt(sd, 100) : null, type === "pageview" ? (n === 1 || n === "1" ? 1 : 0) : null, metaJson, Date.now())
    .run();
  return json({ ok: true }, { headers: CORS });
}

async function handleSites(req: Request, env: Env): Promise<Response> {
  const auth = await authenticate(req, env);
  if ("error" in auth) return json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  if (req.method === "GET") {
    const siteId = url.searchParams.get("id") || url.searchParams.get("site_id");
    if (siteId) {
      if (auth.type === "site" && siteId !== auth.site.id && siteId !== auth.site.domain) {
        return json({ error: "site key cannot access another site" }, { status: 403 });
      }
      const site = auth.type === "site" ? auth.site : await getSite(env.DB, siteId);
      if (!site) return json({ error: "site not found" }, { status: 404 });
      return json({ site, snippet: `<script defer src="${url.origin}/js/script.js" data-site="${site.id}"></script>`, api_key: site.api_key });
    }
    return auth.type === "site" ? json({ sites: [auth.site] }) : json({ sites: auth.sites });
  }
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "invalid json" }, { status: 400 }); }
    if (body.action === "create" || (!body.action && body.name && body.domain)) {
      if (auth.type !== "owner") return json({ error: "Creating sites requires owner credentials" }, { status: 403 });
      if (!body.name || !body.domain) return json({ error: "name and domain are required" }, { status: 400 });
      const site: Site = { id: randomId(12), domain: String(body.domain).toLowerCase(), name: String(body.name), created_at: Date.now(), api_key: newApiKey() };
      await env.DB.prepare("INSERT INTO sites (id, domain, name, created_at, api_key) VALUES (?, ?, ?, ?, ?)").bind(site.id, site.domain, site.name, site.created_at, site.api_key).run();
      await logAgent(env, "owner_basic", site.id, "create_site", { name: site.name, domain: site.domain }, "success");
      return json({ site }, { status: 201 });
    }
    if (body.action === "regenerate_key" || body.regenerate_key) {
      const siteRes = await requireSite(req, auth, env);
      if ("error" in siteRes) return json({ error: siteRes.error }, { status: siteRes.status });
      const key = newApiKey();
      await env.DB.prepare("UPDATE sites SET api_key = ? WHERE id = ?").bind(key, siteRes.site.id).run();
      await logAgent(env, auth.type === "site" ? "site_key" : "owner_basic", siteRes.site.id, "regenerate_api_key", null, "success");
      return json({ site: siteRes.site.id, api_key: key });
    }
    if (body.action === "update" || body.name || body.domain) {
      if (auth.type !== "owner") return json({ error: "Updating sites requires owner credentials" }, { status: 403 });
      const siteRes = await requireSite(req, auth, env);
      if ("error" in siteRes) return json({ error: siteRes.error }, { status: siteRes.status });
      if (body.name) await env.DB.prepare("UPDATE sites SET name = ? WHERE id = ?").bind(String(body.name), siteRes.site.id).run();
      if (body.domain) await env.DB.prepare("UPDATE sites SET domain = ? WHERE id = ?").bind(String(body.domain).toLowerCase(), siteRes.site.id).run();
      const updated = await getSite(env.DB, siteRes.site.id);
      await logAgent(env, "owner_basic", siteRes.site.id, "update_site", { name: body.name, domain: body.domain }, "success");
      return json({ site: updated });
    }
    return json({ error: "unknown action. Supported: create, regenerate_key, update" }, { status: 400 });
  }
  if (req.method === "DELETE") {
    if (auth.type !== "owner") return json({ error: "Deleting sites requires owner credentials (Basic auth)" }, { status: 403 });
    let body: any = {};
    try { body = await req.json(); } catch {}
    const siteRes = await requireSite(req, auth, env);
    if ("error" in siteRes) return json({ error: siteRes.error }, { status: siteRes.status });
    if (String(body.confirm || "").toLowerCase().trim() !== siteRes.site.domain.toLowerCase()) return json({ error: `Confirmation required. Send { "confirm": "${siteRes.site.domain}" } to delete.` }, { status: 400 });
    for (const table of ["events", "payments", "goals", "funnels"]) await env.DB.prepare(`DELETE FROM ${table} WHERE site_id = ?`).bind(siteRes.site.id).run();
    await env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(siteRes.site.id).run();
    await logAgent(env, "owner_basic", siteRes.site.id, "delete_site", null, "success");
    return json({ ok: true, deleted: siteRes.site.id });
  }
  return json({ error: "method not allowed" }, { status: 405 });
}

async function handleGoals(req: Request, env: Env): Promise<Response> {
  const auth = await authenticate(req, env);
  if ("error" in auth) return json({ error: auth.error }, { status: auth.status });
  const siteRes = await requireSite(req, auth, env);
  if ("error" in siteRes) return json({ error: siteRes.error }, { status: siteRes.status });
  if (req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM goals WHERE site_id = ? ORDER BY created_at ASC").bind(siteRes.site.id).all();
    return json({ site: siteRes.site.id, goals: results || [] });
  }
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, { status: 400 }); }
  if (!body.name) return json({ error: "name is required" }, { status: 400 });
  if (req.method === "POST") {
    await env.DB.prepare("INSERT OR IGNORE INTO goals (site_id, name, created_at) VALUES (?, ?, ?)").bind(siteRes.site.id, String(body.name), Date.now()).run();
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM goals WHERE site_id = ? AND name = ?").bind(siteRes.site.id, String(body.name)).run();
    return json({ ok: true });
  }
  return json({ error: "method not allowed" }, { status: 405 });
}

async function handleEvents(req: Request, env: Env): Promise<Response> {
  const auth = await authenticate(req, env);
  if ("error" in auth) return json({ error: auth.error }, { status: auth.status });
  const siteRes = await requireSite(req, auth, env);
  if ("error" in siteRes) return json({ error: siteRes.error }, { status: siteRes.status });
  const url = new URL(req.url);
  if (req.method === "GET") {
    const period = resolvePeriod((url.searchParams.get("period") as any) || "7d");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 1000);
    let sql = "SELECT * FROM events WHERE site_id = ? AND ts >= ? AND ts <= ?";
    const params: (string | number)[] = [siteRes.site.id, period.from, period.to];
    for (const [qp, col] of [["type", "type"], ["visitor_id", "visitor_id"], ["path", "path"]]) {
      const v = url.searchParams.get(qp);
      if (v) { sql += ` AND ${col} = ?`; params.push(v); }
    }
    sql += " ORDER BY ts DESC LIMIT ?"; params.push(limit);
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    return json({ site: siteRes.site.id, count: (results || []).length, events: results || [] });
  }
  if (req.method === "POST") {
    const ip = clientIp(req.headers);
    const limited = checkRateLimit(`events:${ip}`, 60, 60_000);
    if (!limited.allowed) return json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(limited.retryAfter || 60) } });
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "invalid json" }, { status: 400 }); }
    if (!body.name) return json({ error: "name is required" }, { status: 400 });
    const visitorId = body.visitor_id ? String(body.visitor_id).slice(0, 64) : `api-${crypto.randomUUID()}`;
    const last = await env.DB.prepare(`SELECT referrer_source, utm_source, utm_medium, utm_campaign, country, region, city, browser, os, device
      FROM events WHERE site_id = ? AND visitor_id = ? ORDER BY ts DESC LIMIT 1`).bind(siteRes.site.id, visitorId).first<any>();
    await env.DB.prepare(`INSERT INTO events
      (site_id, type, name, path, referrer, referrer_source, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
       visitor_id, session_id, country, region, city, browser, os, device, screen_w, meta, ts)
      VALUES (?, 'goal', ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .bind(siteRes.site.id, String(body.name).slice(0, 64), last?.referrer_source ?? "API", last?.utm_source ?? null, last?.utm_medium ?? null, last?.utm_campaign ?? null, visitorId, `api-${crypto.randomUUID()}`, last?.country ?? null, last?.region ?? null, last?.city ?? null, last?.browser ?? null, last?.os ?? null, last?.device ?? null, body.metadata ? JSON.stringify(body.metadata).slice(0, 2048) : null, Date.now())
      .run();
    return json({ ok: true, visitor_id: visitorId });
  }
  return json({ error: "method not allowed" }, { status: 405 });
}

function resolvePeriod(key: "today" | "7d" | "30d" | "90d" | "all") {
  const now = Date.now(); const day = 86_400_000; const hour = 3_600_000;
  if (key === "today") { const start = new Date(); start.setHours(0, 0, 0, 0); return { from: start.getTime(), to: now, bucketMs: hour, key }; }
  if (key === "30d") return { from: now - 30 * day, to: now, bucketMs: day, key };
  if (key === "90d") return { from: now - 90 * day, to: now, bucketMs: day, key };
  if (key === "all") return { from: 0, to: now, bucketMs: day, key };
  return { from: now - 7 * day, to: now, bucketMs: day, key: "7d" as const };
}

async function handleStats(req: Request, env: Env): Promise<Response> {
  const auth = await authenticate(req, env);
  if ("error" in auth) return json({ error: auth.error }, { status: auth.status });
  const siteRes = await requireSite(req, auth, env);
  if ("error" in siteRes) return json({ error: siteRes.error }, { status: siteRes.status });
  const url = new URL(req.url);
  const period = resolvePeriod((url.searchParams.get("period") as any) || "7d");
  const baseParams = [siteRes.site.id, period.from, period.to];
  const totals = await env.DB.prepare(`SELECT COUNT(DISTINCT visitor_id) AS visitors, COUNT(DISTINCT session_id) AS sessions,
    SUM(CASE WHEN type = 'pageview' THEN 1 ELSE 0 END) AS pageviews FROM events WHERE site_id = ? AND ts >= ? AND ts <= ?`).bind(...baseParams).first<any>();
  const realtime = await env.DB.prepare("SELECT COUNT(DISTINCT visitor_id) AS n FROM events WHERE site_id = ? AND ts >= ?").bind(siteRes.site.id, Date.now() - 5 * 60_000).first<any>();
  const pages = await breakdown(env.DB, siteRes.site.id, period.from, period.to, "path");
  const sources = await breakdown(env.DB, siteRes.site.id, period.from, period.to, "referrer_source");
  const revenue = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS payments, COUNT(DISTINCT COALESCE(customer_id, id)) AS customers FROM payments WHERE site_id = ? AND ts >= ? AND ts <= ?").bind(...baseParams).first<any>();
  return json({
    site: { id: siteRes.site.id, domain: siteRes.site.domain, name: siteRes.site.name }, period: period.key, range: { from: period.from, to: period.to },
    realtime_visitors: realtime?.n ?? 0,
    totals: { visitors: totals?.visitors ?? 0, sessions: totals?.sessions ?? 0, pageviews: totals?.pageviews ?? 0, bounceRate: 0, avgDuration: 0, totalDuration: 0 },
    pages, sources, revenue: revenue || { amount: 0, payments: 0, customers: 0 },
    migration_note: "Cloudflare Worker/D1 candidate preserves tracker ingest and core API contracts; full Next dashboard UI remains intentionally fail-closed in this bounded candidate.",
  });
}

async function breakdown(db: D1Database, siteId: string, from: number, to: number, column: string) {
  const { results } = await db.prepare(`SELECT ${column} AS value, COUNT(DISTINCT visitor_id) AS visitors, COUNT(*) AS count
    FROM events WHERE site_id = ? AND ts >= ? AND ts <= ? AND ${column} IS NOT NULL AND type = 'pageview'
    GROUP BY ${column} ORDER BY visitors DESC LIMIT 10`).bind(siteId, from, to).all();
  return results || [];
}

async function handleStripe(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, { status: 405 });
  const payload = await req.text();
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "stripe_webhook_secret_not_configured", failClosed: true }, { status: 503 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return json({ error: "missing signature" }, { status: 400 });
  const timestamp = /(?:^|,)t=([^,]+)/.exec(sig)?.[1];
  const v1 = /(?:^|,)v1=([^,]+)/.exec(sig)?.[1];
  if (!timestamp || !v1) return json({ error: "invalid signature" }, { status: 400 });
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    return json({ error: "signature timestamp outside tolerance" }, { status: 400 });
  }
  const signedPayload = `${timestamp}.${payload}`;
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, signedPayload);
  if (!timingSafeEqualHex(expected, v1)) return json({ error: "invalid signature" }, { status: 400 });
  let event: any;
  try { event = JSON.parse(payload); } catch { return json({ error: "invalid json" }, { status: 400 }); }
  if (event.type === "checkout.session.completed") await recordPayment(env, event.id, event.data?.object, "Checkout");
  else if (event.type === "invoice.paid") await recordPayment(env, event.id, event.data?.object, "Invoice");
  return json({ received: true });
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function recordPayment(env: Env, stripeEventId: string, obj: any, description: string) {
  const amount = Number(obj?.amount_total ?? obj?.amount_paid ?? 0);
  if (!amount || amount <= 0) return;
  const visitorId = obj?.metadata?.nut_visitor_id ?? obj?.client_reference_id ?? null;
  const siteRef = obj?.metadata?.nut_site ?? null;
  const customerId = typeof obj?.customer === "string" ? obj.customer : null;
  const email = obj?.customer_details?.email ?? obj?.customer_email ?? null;
  let siteId: string | null = null;
  if (siteRef) siteId = (await getSiteByDomain(env.DB, siteRef))?.id ?? siteRef;
  else {
    const sites = await listSites(env.DB);
    if (sites.length === 1) siteId = sites[0].id;
  }
  if (!siteId) return;
  let attributedVisitor = visitorId;
  if (!attributedVisitor && customerId) {
    const prev = await env.DB.prepare("SELECT visitor_id FROM payments WHERE customer_id = ? AND visitor_id IS NOT NULL LIMIT 1").bind(customerId).first<any>();
    attributedVisitor = prev?.visitor_id ?? null;
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO payments (site_id, visitor_id, stripe_event_id, customer_id, email, description, amount, currency, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(siteId, attributedVisitor, stripeEventId, customerId, email, description, amount, obj?.currency ?? "usd", Date.now()).run();
}

async function logAgent(env: Env, authType: string, siteId: string | null, action: string, paramsSummary: unknown, status: string) {
  await env.DB.prepare("INSERT INTO agent_activity_log (timestamp, auth_type, site_id, action, params, status, details) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(Date.now(), authType, siteId, action, paramsSummary ? JSON.stringify(paramsSummary).slice(0, 2000) : null, status, null).run();
}

async function handleHealth(env: Env): Promise<Response> {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sites").first<any>();
    return json({ ok: true, runtime: "cloudflare-workers-d1", time: new Date().toISOString(), sites: row?.n ?? 0 });
  } catch {
    return json({ ok: false, error: "d1_unavailable" }, { status: 503 });
  }
}

async function serveScript(req: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS?.fetch(req);
  if (!asset || asset.status === 404) return json({ error: "tracker_asset_missing", failClosed: true }, { status: 503, headers: CORS });
  const headers = new Headers(asset.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "public, max-age=300, must-revalidate");
  headers.set("Content-Type", "application/javascript; charset=utf-8");
  return new Response(asset.body, { status: asset.status, headers });
}

function failClosedHtml(pathname: string): Response {
  return text(`<!doctype html><meta charset="utf-8"><title>Nut Analytics Cloudflare candidate</title><h1>Nut Analytics Cloudflare candidate</h1><p>This Worker owns tracker ingest and D1 API routes. The full Next dashboard route <code>${pathname}</code> is intentionally fail-closed until the UI is rebuilt for D1 or deployed with a verified OpenNext package.</p>`, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/js/script.js") return serveScript(req, env);
    const mutation = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
    if (mutation && !writeModeEnabled(env)) return writeModeBlocked();
    if (url.pathname === "/api/track") return handleTrack(req, env);
    if (url.pathname === "/api/health") return handleHealth(env);
    if (url.pathname === "/api/v1/sites") return handleSites(req, env);
    if (url.pathname === "/api/v1/goals") return handleGoals(req, env);
    if (url.pathname === "/api/v1/events") return handleEvents(req, env);
    if (url.pathname === "/api/v1/stats") return handleStats(req, env);
    if (url.pathname === "/api/stripe/webhook") return handleStripe(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    return failClosedHtml(url.pathname);
  },
};
