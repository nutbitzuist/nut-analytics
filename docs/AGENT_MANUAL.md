# Nut Analytics - Complete Agent Operating Manual

**Purpose**: This is the definitive, self-contained manual for any AI agent (Grok, Claude, Cursor, custom agents, etc.) to fully control and manage a Nut Analytics instance programmatically.

**Base URL**: https://nut-analytics.up.railway.app (or your self-hosted URL)

**Philosophy**: The agent should be able to do *everything* a human owner can do in the dashboard and more (via APIs). This includes site management, analytics, goals, privacy, reports, exports, and agent-specific features.

**Important for the Agent**:
- Always authenticate properly.
- Prefer scoped site API keys (`nut_sk_*`) for safety when working on one site.
- Use owner-level Basic auth (dashboard password) only when cross-site or admin actions are needed.
- For destructive actions (delete site), always require explicit confirmation matching the domain.
- Ask the human (owner) for fresh credentials when needed. Never assume or store them long-term unless explicitly told.
- Use the OpenAPI and MCP for discovery to stay up-to-date.
- All responses should be clear, include the exact API calls made, and suggest next steps.
- Safety first: Confirm before deletes, key rotations that affect production, etc.

## 1. Authentication

### Site-Scoped (Recommended for most tasks)
- Obtain from the site's **Settings** page in the dashboard.
- Header: `Authorization: Bearer nut_sk_...`
- Scope: Limited to one site. Safe to share with agents for specific work.

### Owner-Level / Full Power (for trusted personal AI)
- Use Basic Auth with the dashboard password.
- Header: `Authorization: Basic <base64("username:password")>` (username can be anything, password is the DASHBOARD_PASSWORD or REPORTS_BASIC_TOKEN).
- Scope: Full access to all sites, global reports, etc.
- This is how the agent gets "global level" management.

**How the human provides credentials**:
- The owner will paste a key or password in the conversation when they want the agent to act.
- Example: "Here is a site key for my main site: nut_sk_abc123... Use it to analyze traffic."

**Global vs Per-Site**:
- Per-site keys: For site-specific work (analytics, goals, events for that domain).
- Owner Basic: For global actions (list all sites, run cross-site reports, create new sites, manage at "project" level across everything).

## 2. Core REST API Endpoints (v1)

All under `/api/v1/`. Use the auth methods above.

### Sites Management (Global + Per-Site)
- `GET /api/v1/sites` — List accessible sites (scoped or all).
- `GET /api/v1/sites?id=<site_id>` — Get full details for a site **including the exact tracking snippet** to paste.
- `POST /api/v1/sites` (owner auth):
  - Create: `{ "name": "My SaaS", "domain": "mysaas.com" }`
  - Update: `{ "action": "update", "site_id": "...", "name": "New Name", "domain": "new.com" }`
  - Regenerate key: `{ "action": "regenerate_key", "site_id": "..." }`
- `DELETE /api/v1/sites` (owner auth, safety required): `{ "id": "...", "confirm": "exact-domain.com" }`

**Returns for details/snippet example**:
```json
{
  "site": { "id": "...", "name": "...", "domain": "..." },
  "snippet": "<script defer src=\"https://.../js/script.js\" data-site=\"...\"></script>",
  "api_key": "nut_sk_..."
}
```

### Analytics & Data
- `GET /api/v1/stats?period=30d&[filters]` — Full stats: totals, timeseries, pages, sources, countries, devices, browsers, os, goals, revenue by channel.
  - Periods: today, 7d, 30d, 90d, all.
  - Filters: path, source, country, device, etc.
- `GET /api/v1/events?period=7d&limit=100&type=goal&visitor_id=...&path=...` — Raw events query for deep analysis (new capability for agents).
- `GET /api/v1/export?kind=summary|events|payments|goals&period=30d&format=csv|json` — Export data.

### Goals
- `GET /api/v1/goals?site_id=...`
- `POST /api/v1/goals` — `{ "site_id": "...", "name": "signup" }`
- `DELETE /api/v1/goals` — `{ "site_id": "...", "name": "signup" }`

### Privacy & Events
- `POST /api/v1/forget-visitor` — `{ "site_id": "...", "visitor_id": "nut_vid_value" }` — Deletes events for that visitor (payments unlinked but revenue preserved).
- `POST /api/v1/events` — Track goals from agent/backend: `{ "site_id": "...", "name": "signup", "visitor_id": "...", "metadata": {...} }`

### Reports & AI Insights (Global capable)
- `GET /api/v1/reports?kind=daily|weekly&send=1` — Preview or send reports with AI growth memo.
  - Requires owner auth for full cross-site power.
  - Returns the full report text.

### OpenAPI for Auto-Discovery
- `GET /api/v1/openapi` — Full machine-readable OpenAPI 3 spec. Agent should fetch this to generate accurate tool calls.

## 3. MCP (Model Context Protocol) Support

For advanced agents that support MCP/tool servers:

- Endpoint: `POST /api/mcp`
- Protocol: JSON-RPC 2.0 style.
- Methods:
  - `tools/list`: Discover all available tools dynamically (no prompt updates needed when features added).
  - `tools/call`: Execute a tool by name with arguments.

**Example MCP Call (tools/list)**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

**Example MCP Call (tools/call)**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_analytics",
    "arguments": {
      "site_id": "...",
      "period": "30d"
    }
  }
}
```

**Available High-Value MCP Tools** (agent should list them via the endpoint for latest):
- get_analytics (comprehensive stats + revenue)
- track_goal
- list_sites / get_site_details (with snippet)
- create_site / update_site / delete_site (with confirm)
- manage_goals
- forget_visitor
- regenerate_api_key
- export_data
- run_report (with AI insights)

MCP provides better structure, discovery, and error handling than raw HTTP for long-term agent use.

**How to use MCP with agents**:
- Many frameworks (Claude Desktop, custom setups) can connect to HTTP MCP endpoints.
- The agent connects once and gets live tools + schemas.
- Auth headers are passed with each call.

## 4. Global vs Per-Site (Project) Level Management

**Current Architecture**:
- "Sites" = individual projects/domains (e.g., one for your SaaS, one for blog).
- Most settings and data are per-site (goals, API keys, analytics, snippet).
- This is by design for isolation and multi-project support.

**Global Level Management** (added for "manage a lot of things"):
- Global settings page: `/settings` (accessible from main dashboard).
- Features:
  - Overview of **all sites** with quick stats, links to per-site settings, and bulk-friendly actions.
  - Central **Reports & AI Insights** runner (trigger daily/weekly reports across all sites, view AI memos).
  - **Agent Integration Hub**: Instructions, links to this manual, OpenAPI, MCP, and guidance on generating keys for AI agents.
  - Global reports configuration help (env var setup for Telegram, Resend, Anthropic – since these are server-level).
  - Quick access to create new sites, trigger privacy actions at scale (via per-site but centralized view).
- This gives the agent (and human) a "control center" to manage many projects without jumping between per-site pages.

**How the agent uses global level**:
- Use owner Basic auth.
- Call global endpoints like `/api/v1/sites` (no id = all), `/api/v1/reports`, and the global `/settings` UI for overview.
- For per-project: Switch to site-specific keys or pass site_id.

**To access global settings in UI**: From the main dashboard (list of sites), there is now a "Global Settings" link in the header.

## 5. Safety, Best Practices & Limitations

- **Confirmations**: Delete site requires domain match. Agent must always include it and explain to human.
- **Rate Limits**: Built-in (generous for agents, but respect them).
- **Auth Rotation**: Agent should suggest rotating keys periodically. Use the regenerate endpoint.
- **Data Privacy**: Use forget_visitor for compliance requests.
- **Scope**: Prefer site keys. Only use full owner auth when necessary.
- **Limitations**:
  - Some config (e.g., Stripe webhook secret, exact env vars) is server-side only. Agent can give instructions but not change env directly (use Railway dashboard for deploys).
  - No multi-user yet (single owner via password).
  - Exports limited for very large data (use direct DB access for huge exports).
- **Error Handling**: Agent should catch 401 (bad auth – ask human for new key), 429 (rate limit – wait), 400 (bad params – validate), etc.
- **Logging**: Agent should log every API call made (method, endpoint, params summary, result) for the human to review.

## 6. Ready-to-Use Prompts & Schemas for the Agent

**Master System Prompt (paste this + the rest of this manual)**:

"You are an expert operator for the user's Nut Analytics instance at [BASE_URL]. Your goal is to help the user manage their analytics, revenue attribution, goals, privacy, reports, and sites completely via the provided APIs and MCP.

Full operating manual is below. Use it to decide on exact calls.

Authentication: The user will provide site keys or the dashboard password in this conversation. Use them in headers. Never hardcode.

Always:
- Use the most appropriate scoped auth.
- For destructive actions, confirm with user first using the exact required payload.
- After every action, summarize what you did (exact calls), results, and suggest next steps or insights from the data.
- Fetch /api/v1/openapi or use MCP tools/list when you need the absolute latest capabilities.
- Be proactive: Analyze data, suggest experiments, manage goals based on trends, run reports on schedule if asked.

Full manual: [paste entire AGENT_MANUAL.md content here]

Current task: [user's request]"

See `docs/agent-function-calling-examples.md` for exact JSON schemas to register as tools/functions in your framework.

## 7. Getting Started for the Human (Owner)

1. Log into the dashboard.
2. For a specific project/site: Go to its Settings and copy the `nut_sk_*` key.
3. For global/agent power: Note your DASHBOARD_PASSWORD (set via Railway vars).
4. Start a chat with your AI agent and paste:
   - This manual (or key parts).
   - The live URL.
   - A credential.
5. Say: "Here is the full Nut Analytics Agent Manual. Base URL is [URL]. Here is a site key: [key]. Analyze my last 30 days and suggest improvements."

## 8. Additional Resources in the Repo

- `docs/AGENT-API.md` — Detailed endpoint reference.
- `docs/agent-function-calling-examples.md` — Ready schemas.
- `/api/v1/openapi` — Live spec.
- `/api/mcp` — Live MCP endpoint.
- Main README and per-site Settings pages for UI context.

This manual is designed so the agent needs **minimal** additional input from the human after initial credential provision. The agent can handle site creation, data analysis, privacy, reports, and multi-site management at both per-project and global levels.

If the agent needs to "do something", it should use the exact endpoints and formats documented here.

---

**End of Manual**. The agent should treat this as its primary knowledge source for Nut Analytics operations. Re-fetch openapi or MCP list for updates.