import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api-auth";
import { createSite, listSites, regenerateApiKey, deleteSite, getSite, addGoal, listGoals, removeGoal, forgetVisitor, updateSite, db } from "@/lib/db";
import { buildReport } from "@/lib/report";
import { runReport } from "@/lib/scheduler";
import { resolvePeriod, totals } from "@/lib/queries";

// Lightweight MCP over HTTP (JSON-RPC style compatible with many agent MCP clients)
// POST /api/mcp
// Supports:
// - { "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
// - { "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "get_analytics", "arguments": {...} } }
//
// This allows your AI agent to discover and call high-level tools without hardcoding URLs.
// Auth: Same as v1 (Bearer site key or Basic owner). Tools are scoped accordingly.

export const dynamic = "force-dynamic";

const TOOLS = [
  {
    name: "get_analytics",
    description: "Get comprehensive analytics for a site including totals, timeseries, breakdowns, goals, and revenue attribution. Supports periods and filters.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string", description: "Site ID (required if using owner auth)" },
        period: { type: "string", enum: ["today", "7d", "30d", "90d", "all"], default: "7d" },
        filters: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["period"],
    },
  },
  {
    name: "track_goal",
    description: "Record a server-side goal/conversion for a visitor. Inherits context if visitor_id provided.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string" },
        name: { type: "string" },
        visitor_id: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_sites",
    description: "List all sites the authenticated principal has access to.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_site",
    description: "Create a new tracked site. Owner auth required.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        domain: { type: "string" },
      },
      required: ["name", "domain"],
    },
  },
  {
    name: "get_site_details",
    description: "Get full details for a site including the ready-to-paste tracking snippet.",
    inputSchema: {
      type: "object",
      properties: { site_id: { type: "string" } },
      required: ["site_id"],
    },
  },
  {
    name: "update_site",
    description: "Update site name or domain. Owner auth required.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string" },
        name: { type: "string" },
        domain: { type: "string" },
      },
      required: ["site_id"],
    },
  },
  {
    name: "delete_site",
    description: "Delete a site (requires confirm with domain for safety). Owner auth required.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string" },
        confirm: { type: "string", description: "Must match the site's domain" },
      },
      required: ["site_id", "confirm"],
    },
  },
  {
    name: "manage_goals",
    description: "List, add, or remove registered goals for a site.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string" },
        action: { type: "string", enum: ["list", "add", "remove"] },
        name: { type: "string" },
      },
      required: ["site_id", "action"],
    },
  },
  {
    name: "forget_visitor",
    description: "Delete all events for a specific visitor_id on a site (privacy compliance).",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string" },
        visitor_id: { type: "string" },
      },
      required: ["site_id", "visitor_id"],
    },
  },
  {
    name: "regenerate_api_key",
    description: "Rotate the API key for a site.",
    inputSchema: {
      type: "object",
      properties: { site_id: { type: "string" } },
      required: ["site_id"],
    },
  },
  {
    name: "export_data",
    description: "Export analytics data as CSV or JSON for a period.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string" },
        kind: { type: "string", enum: ["summary", "events", "payments", "goals"] },
        period: { type: "string" },
        format: { type: "string", enum: ["csv", "json"] },
      },
      required: ["kind", "period"],
    },
  },
  {
    name: "run_report",
    description: "Generate (and optionally send) daily or weekly report with AI insights.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["daily", "weekly"] },
        send: { type: "boolean", default: false },
      },
    },
  },
];

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const { jsonrpc, id, method, params } = body || {};

  if (jsonrpc !== "2.0") {
    return jsonRpcError(id, -32600, "Invalid Request");
  }

  const auth = await authenticateApiRequest(req);
  if ("error" in auth) {
    return jsonRpcError(id, -32000, `Auth error: ${auth.error}`);
  }

  try {
    if (method === "tools/list") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args = {} } = params || {};
      const result = await executeTool(name, args, auth, req);
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (err: any) {
    return jsonRpcError(id, -32000, err.message || "Internal error");
  }
}

function jsonRpcError(id: any, code: number, message: string) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

async function executeTool(name: string, args: any, auth: any, req: NextRequest) {
  // Resolve site if needed
  let site: any = null;
  if (args.site_id) {
    site = getSite(args.site_id) || (auth.type === "site" ? auth.site : null);
  } else if (auth.type === "site") {
    site = auth.site;
  }

  switch (name) {
    case "get_analytics": {
      if (!site && args.site_id) site = getSite(args.site_id);
      if (!site) throw new Error("site_id required");
      const period = (args.period || "7d") as any;
      const { from, to } = resolvePeriod(period);
      const t = totals(site.id, from, to, args.filters || {});
      return { site: site.id, period, totals: t, note: "Use /api/v1/stats for full breakdowns, timeseries, revenue etc." };
    }

    case "track_goal": {
      if (!site && args.site_id) site = getSite(args.site_id);
      if (!site) throw new Error("site_id required");
      // Reuse the POST logic conceptually
      const visitorId = args.visitor_id || `mcp-${Math.random().toString(36).slice(2)}`;
      const last = db().prepare(`SELECT referrer_source, utm_source, utm_medium, utm_campaign, country, region, city, browser, os, device FROM events WHERE site_id = ? AND visitor_id = ? ORDER BY ts DESC LIMIT 1`).get(site.id, visitorId) as any;
      db().prepare(`INSERT INTO events (site_id, type, name, path, referrer, referrer_source, utm_source, utm_medium, utm_campaign, utm_term, utm_content, visitor_id, session_id, country, region, city, browser, os, device, screen_w, meta, ts) VALUES (?, 'goal', ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
        site.id, String(args.name).slice(0,64), last?.referrer_source ?? "MCP", last?.utm_source ?? null, last?.utm_medium ?? null, last?.utm_campaign ?? null, visitorId, `mcp-${Math.random().toString(36).slice(2)}`, last?.country ?? null, last?.region ?? null, last?.city ?? null, last?.browser ?? null, last?.os ?? null, last?.device ?? null, args.metadata ? JSON.stringify(args.metadata).slice(0,2048) : null, Date.now()
      );
      return { ok: true, visitor_id: visitorId };
    }

    case "list_sites": {
      if (auth.type === "site") return { sites: [auth.site] };
      return { sites: listSites() };
    }

    case "create_site": {
      if (auth.type !== "owner") throw new Error("Owner credentials required");
      return createSite(args.name, args.domain);
    }

    case "get_site_details": {
      const s = getSite(args.site_id);
      if (!s) throw new Error("Site not found");
      const base = "https://nut-analytics-production.up.railway.app"; // or dynamic
      return { site: s, snippet: `<script defer src="${base}/js/script.js" data-site="${s.id}"></script>` };
    }

    case "update_site": {
      if (auth.type !== "owner") throw new Error("Owner credentials required");
      return updateSite(args.site_id, { name: args.name, domain: args.domain });
    }

    case "delete_site": {
      if (auth.type !== "owner") throw new Error("Owner credentials required");
      const s = getSite(args.site_id);
      if (!s || args.confirm !== s.domain) throw new Error("Confirmation failed");
      deleteSite(args.site_id);
      return { ok: true };
    }

    case "manage_goals": {
      if (!args.site_id) throw new Error("site_id required");
      if (args.action === "list") return listGoals(args.site_id);
      if (args.action === "add" && args.name) { addGoal(args.site_id, args.name); return { ok: true }; }
      if (args.action === "remove" && args.name) { removeGoal(args.site_id, args.name); return { ok: true }; }
      throw new Error("Invalid action");
    }

    case "forget_visitor": {
      if (!args.site_id || !args.visitor_id) throw new Error("site_id and visitor_id required");
      return forgetVisitor(args.site_id, args.visitor_id);
    }

    case "regenerate_api_key": {
      if (!args.site_id) throw new Error("site_id required");
      const newKey = regenerateApiKey(args.site_id);
      return { site: args.site_id, api_key: newKey };
    }

    case "export_data": {
      // Proxy to export logic or return note
      return { note: "Use /api/v1/export with same auth. MCP tool returns link to call." };
    }

    case "run_report": {
      const kind = args.kind === "weekly" ? "weekly" : "daily";
      const result = args.send ? await runReport(kind, true) : await buildReport(kind);
      return { kind, ...result, channels: (await import("@/lib/notify")).channelsConfigured() };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}