import { NextRequest, NextResponse } from "next/server";
import { createSite, listSites, regenerateApiKey, getSite, deleteSite, updateSite, logAgentAction } from "@/lib/db";
import { authenticateApiRequest, requireSite } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Sites management API — perfect for your personal AI agent.
 *
 * GET  /api/v1/sites
 *      Returns sites you have access to.
 *      - With site key: returns only that site
 *      - With owner Basic auth: returns ALL your sites
 *
 * POST /api/v1/sites
 *      Body: { "name": "My SaaS", "domain": "mysaas.com" }
 *      Only available with owner credentials (Basic auth using your dashboard password).
 *      Creates a new site and returns it (including the new nut_sk_* key).
 *
 * This lets your AI agent create new tracking properties for you.
 */

export async function GET(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const siteId = req.nextUrl.searchParams.get("id") || req.nextUrl.searchParams.get("site_id");

  if (siteId) {
    // Get specific site details + snippet info (very useful for agents)
    const site = getSite(siteId) || (auth.type === "site" ? auth.site : null);
    if (!site) {
      return NextResponse.json({ error: "site not found" }, { status: 404 });
    }
    // Return data needed to build the tracking snippet
    const base = req.nextUrl.origin; // or construct from headers if behind proxy
    const snippet = `<script defer src="${base}/js/script.js" data-site="${site.id}"></script>`;
    return NextResponse.json({
      site,
      snippet,
      api_key: site.api_key, // only return if owner or matching key
    });
  }

  if (auth.type === "site") {
    return NextResponse.json({ sites: [auth.site] });
  }

  // Owner mode — full list
  return NextResponse.json({ sites: auth.sites });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Create new site (owner only)
  if (body.action === "create" || (!body.action && body.name && body.domain)) {
    if (auth.type !== "owner") {
      return NextResponse.json({ error: "Creating sites requires owner credentials" }, { status: 403 });
    }
    if (!body.name || !body.domain) {
      return NextResponse.json({ error: "name and domain are required" }, { status: 400 });
    }
    const site = createSite(body.name, body.domain);
    logAgentAction({
      authType: "owner_basic",
      siteId: site.id,
      action: "create_site",
      paramsSummary: { name: body.name, domain: body.domain },
      status: "success",
    });
    return NextResponse.json({ site }, { status: 201 });
  }

  // Rotate key
  if (body.action === "regenerate_key" || body.regenerate_key) {
    const siteRes = await requireSite(req, auth);
    if ("error" in siteRes) {
      return NextResponse.json({ error: siteRes.error }, { status: 400 });
    }
    const newKey = regenerateApiKey(siteRes.site.id);
    logAgentAction({
      authType: auth.type === "site" ? "site_key" : "owner_basic",
      siteId: siteRes.site.id,
      action: "regenerate_api_key",
      status: "success",
    });
    return NextResponse.json({ site: siteRes.site.id, api_key: newKey });
  }

  // Update site name/domain (owner recommended)
  if (body.action === "update" || body.name || body.domain) {
    if (auth.type !== "owner") {
      return NextResponse.json({ error: "Updating sites requires owner credentials" }, { status: 403 });
    }
    const siteRes = await requireSite(req, auth);
    if ("error" in siteRes) {
      return NextResponse.json({ error: siteRes.error }, { status: 400 });
    }
    const updated = updateSite(siteRes.site.id, {
      name: body.name,
      domain: body.domain,
    });
    logAgentAction({
      authType: "owner_basic",
      siteId: siteRes.site.id,
      action: "update_site",
      paramsSummary: { name: body.name, domain: body.domain },
      status: "success",
    });
    return NextResponse.json({ site: updated });
  }

  return NextResponse.json({ error: "unknown action. Supported: create, regenerate_key" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Delete requires owner + confirmation (domain) for safety, mirroring the UI
  if (auth.type !== "owner") {
    return NextResponse.json({ error: "Deleting sites requires owner credentials (Basic auth)" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const siteRes = await requireSite(req, auth);
  if ("error" in siteRes) {
    return NextResponse.json({ error: siteRes.error }, { status: 400 });
  }

  const site = siteRes.site;
  const confirm = (body.confirm || "").toLowerCase().trim();
  if (confirm !== site.domain.toLowerCase()) {
    return NextResponse.json({
      error: `Confirmation required. Send { "confirm": "${site.domain}" } to delete.`,
    }, { status: 400 });
  }

  deleteSite(site.id);
  logAgentAction({
    authType: "owner_basic",
    siteId: site.id,
    action: "delete_site",
    status: "success",
  });
  return NextResponse.json({ ok: true, deleted: site.id });
}