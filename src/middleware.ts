import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";

// Session-cookie auth for the dashboard (login at /login) when
// DASHBOARD_PASSWORD is set. Tracking, webhooks and the key-authenticated
// API stay public — they must be reachable from visitors' browsers and Stripe.
// /api/reports/run keeps its own basic-auth check for cron/scripting use.
const PUBLIC_PATHS = [
  /^\/api\/track/,
  /^\/api\/stripe\//,
  /^\/api\/v1\//,
  /^\/api\/mcp/,
  /^\/api\/auth\//,
  /^\/api\/reports\//,
  /^\/api\/health/,
  /^\/login/,
  /^\/js\//,
  /^\/_next\//,
  /^\/favicon/,
];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Light rate limit on the login form endpoint (brute force protection)
  if (path === "/api/auth/login" || path === "/login") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { allowed, retryAfter } = checkRateLimit(`login:${ip}`, 8, 5 * 60_000); // 8 attempts / 5 min
    if (!allowed) {
      return new NextResponse("Too many login attempts. Please try again later.", {
        status: 429,
        headers: retryAfter ? { "Retry-After": String(retryAfter) } : {},
      });
    }
  }

  const hasPassword = !!process.env.DASHBOARD_PASSWORD || !!process.env.DASHBOARD_PASSWORD_HASH;
  if (!hasPassword) return NextResponse.next();

  if (PUBLIC_PATHS.some((re) => re.test(path))) return NextResponse.next();

  const email = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (email) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}
