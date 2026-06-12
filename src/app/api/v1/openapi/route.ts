import { NextResponse } from "next/server";

/**
 * Basic OpenAPI 3.0 spec for the v1 API.
 * This allows AI agents and tools to auto-generate function calling schemas.
 *
 * Access at: /api/v1/openapi
 */
export async function GET() {
  const spec = {
    openapi: "3.0.3",
    info: {
      title: "Nut Analytics API",
      version: "1.0.0",
      description: "Programmatic access for owners and AI agents. Use site Bearer keys for scoped access or Basic auth with your dashboard password for full owner capabilities.",
    },
    servers: [
      { url: "https://nut-analytics-production.up.railway.app" },
    ],
    components: {
      securitySchemes: {
        ApiKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "nut_sk_...",
          description: "Site-specific API key from the settings page.",
        },
        OwnerBasic: {
          type: "http",
          scheme: "basic",
          description: "Use your DASHBOARD_PASSWORD (or REPORTS_BASIC_TOKEN) for full owner/agent access across sites.",
        },
      },
    },
    security: [{ ApiKey: [] }, { OwnerBasic: [] }],
    paths: {
      "/api/v1/stats": {
        get: {
          summary: "Get analytics for a site",
          parameters: [
            { name: "period", in: "query", schema: { type: "string", enum: ["today", "7d", "30d", "90d", "all"] } },
          ],
          responses: { "200": { description: "Analytics data" } },
        },
      },
      "/api/v1/sites": {
        get: {
          summary: "List sites (or details with ?id=)",
          responses: { "200": { description: "Sites" } },
        },
        post: {
          summary: "Create site or perform actions (create, regenerate_key, update)",
          responses: { "201": { description: "Created" } },
        },
        delete: {
          summary: "Delete site (owner only, requires confirm)",
          responses: { "200": { description: "Deleted" } },
        },
      },
      "/api/v1/goals": {
        get: { summary: "List registered goals" },
        post: { summary: "Add goal" },
        delete: { summary: "Remove goal" },
      },
      "/api/v1/events": {
        post: { summary: "Track server-side goal" },
      },
      "/api/v1/forget-visitor": {
        post: { summary: "Forget a visitor for privacy" },
      },
      "/api/v1/export": {
        get: { summary: "Export data as CSV or JSON" },
      },
      "/api/v1/reports": {
        get: { summary: "Run or preview daily/weekly reports with AI insights" },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: { "Content-Type": "application/json" },
  });
}