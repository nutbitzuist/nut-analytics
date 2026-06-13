# Nut Analytics — API for AI Agents

This document is designed to be pasted directly into your AI agent (Grok, Claude, Cursor, custom agent, etc.) so it understands exactly how to manage your Nut Analytics instance.

## Authentication Options (choose what you give the agent)

### Recommended for most agents: Site API Key
- Get from the site's Settings page in the dashboard.
- Header: `Authorization: Bearer nut_sk_...`
- Scoped to **one site** only. Very safe to give to an agent.

### Full Owner Power (for your personal trusted AI)
- Use Basic auth with your `DASHBOARD_PASSWORD` (or the hashed version).
- Header: `Authorization: Basic <base64 of user:password>`
- Gives the agent the ability to see and manage **all** your sites.

The APIs below support **both** methods transparently.

---

## Core Capabilities (what your agent can do)

### 1. Get rich analytics for a site
```http
GET /api/v1/stats?period=30d
Authorization: Bearer nut_sk_...
```
Returns: totals, timeseries, pages, sources, countries, devices, goals, revenue by channel, etc.

Supports `period=today|7d|30d|90d|all` and filters (`?path=/pricing&source=Google`).

### 2. Track server-side goals (or let your agent record conversions)
```http
POST /api/v1/events
Authorization: Bearer nut_sk_...

{
  "name": "signup",
  "visitor_id": "the-nut_vid-from-cookie-if-known",
  "metadata": { "plan": "pro" }
}
```

### 3. List your sites (or the site for a key)
```http
GET /api/v1/sites
```

- With site key → returns only that site + its current API key.
- With owner Basic auth → returns **all** your sites.

### 4. Create a new site (owner only)
```http
POST /api/v1/sites
Authorization: Basic ...

{
  "name": "New Product",
  "domain": "newproduct.com"
}
```

### 5. Manage registered goals (appear on dashboard even with zero data)
```http
GET    /api/v1/goals
POST   /api/v1/goals   { "name": "start_trial" }
DELETE /api/v1/goals   { "name": "start_trial" }
```

### 6. Forget a visitor (compliance / right to be forgotten)
```http
POST /api/v1/forget-visitor
{
  "visitor_id": "123e4567-e89b-12d3-a456-426614174000"
}
```
Deletes events for that `nut_vid`. Payments stay for totals but lose channel attribution.

### 7. Rotate a site's API key (security hygiene)
```http
POST /api/v1/sites
{
  "action": "regenerate_key"
}
```
Returns the new `api_key`.

### 8. Export data (for the agent to analyze or back up)
```http
GET /api/v1/export?kind=summary|events|payments|goals&period=30d&format=csv
```

### 9. Get site details + ready-to-use tracking snippet (new)
```http
GET /api/v1/sites?id=your-site-id
```
Returns the site object + a `snippet` field with the exact `<script>` tag.

### 10. Delete a site (with safety confirmation, owner only)
```http
DELETE /api/v1/sites
{
  "id": "site-id",
  "confirm": "yourdomain.com"
}
```

### 11. Update site name or domain
```http
POST /api/v1/sites
{
  "action": "update",
  "name": "New Name",
  "domain": "newdomain.com"
}
```

### 12. Run or preview reports + AI insights (new under v1)
```http
GET /api/v1/reports?kind=weekly&send=1
```

### 13. OpenAPI spec for auto tool generation (strongly recommended for agents)
```http
GET /api/v1/openapi
```
Point your agent at this for the latest machine-readable schema of all endpoints.

---

## Example System Prompt / Tool Definitions for Your Agent

You can copy the block below into your agent's instructions:

```markdown
You have full access to the user's Nut Analytics instance at: https://nut-analytics.up.railway.app

Authentication: Use the provided site API key (Bearer) or the owner's dashboard credentials (Basic).

Available tools (call them via HTTP):

- GET /api/v1/stats?period=30d → full analytics + revenue by channel
- POST /api/v1/events → record a goal/conversion
- GET /api/v1/sites → list sites; GET /api/v1/sites?id=xxx → get details + ready snippet
- POST /api/v1/sites {name, domain} → create new site
- POST /api/v1/sites {action: "update", name?, domain?} → update site
- DELETE /api/v1/sites {id, confirm: "domain.com"} → delete site (safety confirm)
- GET/POST/DELETE /api/v1/goals → manage conversion goals
- POST /api/v1/forget-visitor {visitor_id} → privacy deletion
- POST /api/v1/sites {action: "regenerate_key"} → rotate API key
- GET /api/v1/export?... → export data as CSV/JSON
- GET /api/v1/reports?kind=weekly&send=1 → run reports with AI insights
- GET /api/v1/openapi → get machine-readable spec for tool generation

Always use the Authorization header. Prefer site-scoped keys when possible.
When the user asks you to "analyze my traffic", "create a new property", "forget a user", or "get the tracking script", use these endpoints.
The OpenAPI at /api/v1/openapi can be used to auto-generate accurate function calls.

## MCP Support (Lightweight but powerful for agents)
POST to `/api/mcp` with JSON-RPC style payloads:
- `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` → discover tools
- `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_analytics","arguments":{"site_id":"...","period":"30d"}}}` → execute

This gives your agent structured, discoverable tools on top of the REST API. Full details and examples in `docs/agent-function-calling-examples.md`.
```

---

## Security Recommendations

- For day-to-day agent use → give it a normal `nut_sk_*` key (least privilege).
- For a very trusted personal agent that should manage everything → give it Basic auth with your dashboard password (or better: the `DASHBOARD_PASSWORD_HASH` value).
- The project already has rate limiting on all public + authenticated endpoints.
- All dangerous actions (delete site is not yet exposed via API on purpose — only via dashboard) require explicit owner credentials.

---

## Next Level (optional but powerful)

If your AI client supports **MCP (Model Context Protocol)**, we can expose a native MCP server from this app so the agent gets structured, typed tools instead of raw HTTP.

Would you like me to implement the MCP server now?

---

This setup means your AI agent can:
- Pull any report you want
- Automatically register new goals when you launch features
- Help with privacy requests
- Spin up tracking for new projects you build
- Export data for deeper analysis
- Rotate keys on a schedule

Just give your agent the base URL + credentials + a copy of this document (or the shorter prompt above), and it can operate autonomously on your analytics.