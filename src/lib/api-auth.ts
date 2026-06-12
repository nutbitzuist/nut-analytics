import { NextRequest } from "next/server";
import { getSiteByApiKey, listSites } from "@/lib/db";

/**
 * Authentication helper for the v1 / programmatic APIs.
 *
 * Supports two modes (for owner + agent flexibility):
 * 1. Site-scoped: Bearer nut_sk_...   → returns the specific site
 * 2. Owner-level: Basic auth using DASHBOARD_PASSWORD (or REPORTS_BASIC_TOKEN)
 *    → allows cross-site actions or when you want full owner power for your AI agent.
 *
 * This design lets your personal AI agent do "everything" while keeping
 * normal tracking keys safely scoped to one site.
 */

export type AuthResult =
  | { type: "site"; site: Awaited<ReturnType<typeof getSiteByApiKey>>; key: string }
  | { type: "owner"; sites: ReturnType<typeof listSites> }
  | { error: string; status: number };

export async function authenticateApiRequest(req: NextRequest): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization") ?? "";

  // Mode 1: Site API key (Bearer nut_sk_...)
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const key = authHeader.replace(/^Bearer\s+/i, "").trim();
    const site = key ? getSiteByApiKey(key) : undefined;

    if (!site) {
      return { error: "invalid or missing API key", status: 401 };
    }
    return { type: "site", site, key };
  }

  // Mode 2: Owner / Agent full access via Basic auth (dashboard password)
  if (authHeader.toLowerCase().startsWith("basic ")) {
    const reportsToken = process.env.REPORTS_BASIC_TOKEN || process.env.DASHBOARD_PASSWORD;
    const hash = process.env.DASHBOARD_PASSWORD_HASH;

    let ok = false;

    try {
      const decoded = atob(authHeader.slice(6));
      const password = decoded.includes(":") ? decoded.split(":")[1] : decoded;

      if (reportsToken && password === reportsToken) {
        ok = true;
      } else if (hash && password) {
        // Support verifying against hash too (for agents using the strong credential)
        const { verifyDashboardPassword } = await import("@/lib/password");
        ok = await verifyDashboardPassword(password, hash);
      }
    } catch {
      ok = false;
    }

    if (!ok) {
      return { error: "invalid owner credentials", status: 401 };
    }

    // Owner mode — agent can see/act on all sites
    const sites = listSites();
    return { type: "owner", sites };
  }

  return { error: "missing Authorization header (use Bearer nut_sk_... or Basic for owner/agent)", status: 401 };
}

/**
 * Convenience: require a specific site (works for both site-key and owner mode).
 * In owner mode you must also pass ?site=xxx or site_id in body.
 */
export async function requireSite(req: NextRequest, auth: AuthResult): Promise<{ site: any; error?: never } | { error: string; status: number }> {
  const a = auth as any;
  if (a.type === "site") {
    if (!a.site) return { error: "site not found", status: 404 } as any;
    return { site: a.site } as any;
  }

  // Owner mode — need to specify which site
  const urlSite = req.nextUrl.searchParams.get("site") || req.nextUrl.searchParams.get("site_id");
  let siteId = urlSite;

  if (!siteId) {
    try {
      const body = await req.clone().json();
      siteId = body.site || body.site_id;
    } catch {}
  }

  if (!siteId) {
    return { error: "site or site_id is required when using owner credentials", status: 400 } as any;
  }

  const site = getSiteByApiKey(siteId) || a.sites?.find((s: any) => s.id === siteId || s.domain === siteId);
  const directSite = !site ? require("@/lib/db").getSite(siteId) : null;
  const finalSite = site || directSite;

  if (!finalSite) {
    return { error: "site not found", status: 404 } as any;
  }

  return { site: finalSite } as any;
}