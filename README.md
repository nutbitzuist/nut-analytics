# 🥜 Nut Analytics

Self-hosted web analytics with conversion goals and Stripe revenue attribution — a DataFast/Plausible-style system you fully own.

- **~2 KB tracking script** — pageviews, SPA route changes, sessions, unique visitors
- **Acquisition** — referrer channel detection (Google, X, Product Hunt, ChatGPT…), full UTM capture
- **Audience** — country/region/city (offline GeoIP), device, browser, OS
- **Goals & conversions** — `window.nut('signup')` or `data-nut-goal` attributes, with per-goal conversion rates
- **Revenue attribution** — Stripe webhook ties payments back to the visitor's first-touch channel
- **Dashboard** — realtime counter, visitors/pageviews chart, breakdowns with click-to-filter, date ranges
- **Privacy-friendly** — first-party only, no third parties; data lives in a local SQLite file
- **REST API** — read stats and push server-side goals with a per-site API key
- **Settings page** — per site: snippet, registered goals, API key management, Stripe setup, delete

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
node scripts/seed.mjs  # optional: demo site with 30 days of fake traffic
```

Open http://localhost:3000, create a site, and drop the snippet it gives you into your site's `<head>`:

```html
<script defer src="https://YOUR-ANALYTICS-HOST/js/script.js" data-site="SITE_ID"></script>
```

That's it — pageviews, sessions, sources, UTM and device data flow in automatically, including client-side route changes in React/Vue/Next apps.

## Tracking goals (conversions)

From code:

```js
window.nut("signup", { plan: "pro" });
```

Or declaratively on any element:

```html
<button data-nut-goal="start_trial">Start free trial</button>
```

Each goal shows up on the dashboard with event count, unique converting visitors, and conversion rate against all visitors in the selected period.

## API

Each site has a secret key (`nut_sk_…`) shown on its settings page.

```bash
# Read stats (totals, timeseries, breakdowns, goals, revenue)
curl "https://YOUR-HOST/api/v1/stats?period=30d" -H "Authorization: Bearer nut_sk_..."

# Track a goal from your backend
curl -X POST https://YOUR-HOST/api/v1/events \
  -H "Authorization: Bearer nut_sk_..." -H "Content-Type: application/json" \
  -d '{"name": "signup", "visitor_id": "<nut_vid cookie>", "metadata": {"plan": "pro"}}'
```

Server-side goals inherit the visitor's channel, country and device from their browsing history when you pass their `nut_vid` cookie.

## Revenue attribution (Stripe)

**Stripe Payment Links:** zero config — the tracking script appends the visitor id to any `buy.stripe.com` link as `client_reference_id` automatically. Just add the webhook below.

**Stripe Checkout sessions:**

1. Create a Stripe webhook pointing to `https://YOUR-ANALYTICS-HOST/api/stripe/webhook` with events `checkout.session.completed` and (for subscriptions) `invoice.paid`.
2. Set `STRIPE_WEBHOOK_SECRET=whsec_...` in your environment (unsigned payloads are accepted only when the secret is unset, for local testing).
3. When creating a Checkout Session on your site, pass the visitor's cookie through metadata:

```js
const visitorId = getCookie("nut_vid"); // set by the tracking script

await stripe.checkout.sessions.create({
  // ...your line items...
  metadata: {
    nut_visitor_id: visitorId,
    nut_site: "yourdomain.com", // or the site id; optional if you track one site
  },
});
```

Payments are then attributed to the visitor's **first-touch channel**, so the dashboard can answer "which traffic source actually makes money" — the DataFast headline feature. Renewal invoices without metadata are matched via the Stripe customer id from earlier payments.

## How identity works

- `nut_vid` — first-party cookie, 1 year: the unique visitor
- `nut_sid` — first-party cookie, rolling 30 minutes: the session (used for bounce rate and session duration)
- Bots are filtered server-side by user-agent; geo is resolved server-side from the IP (never stored)

## Data model

SQLite at `data/analytics.db` (WAL mode), three tables: `sites`, `events` (pageviews + goals, one row each), `payments`. All dashboard numbers are computed live with indexed SQL — no aggregation jobs to babysit. At millions of events you'd move to Postgres/ClickHouse; the schema ports directly.

## Deploying

Any Node host with a persistent disk works (Railway, Fly, a VPS):

```bash
npm run build && npm start
```

Make sure `data/` is on a volume so the database survives deploys. Behind a proxy, visitor IPs are read from `x-forwarded-for` for geo lookup.

> **Note:** the dashboard is protected when you set `DASHBOARD_PASSWORD` (or the recommended `DASHBOARD_PASSWORD_HASH`). See the "Authentication & Security" section below. Tracking, webhooks, and the API key endpoints remain intentionally public.

## AI Agent Automation (Full Control via API + MCP)

This project is designed so your personal AI agent can manage **everything** programmatically:

- Full site CRUD (create, list, update, delete with safety)
- Goal management
- Privacy (forget visitor)
- Analytics, exports, reports with AI insights
- Key rotation
- Server-side event tracking
- And more

**For your agent:**
1. Live instance: https://nut-analytics-production.up.railway.app
2. Paste the contents of `docs/AGENT-API.md` (and `docs/agent-function-calling-examples.md`) into your agent's context.
3. Provide a site API key (`nut_sk_*` from Settings) or your dashboard password (Basic auth) when you want the agent to act.
4. The agent can use the REST API at `/api/v1/*` or the MCP endpoint at `/api/mcp` for structured tool use.
5. OpenAPI spec: `/api/v1/openapi` (for auto-generating tool schemas).

See the docs/ folder for complete manuals, examples, and MCP usage. The agent can now replicate any dashboard action (per-site or globally). Rotate credentials after giving temporary access.

**New: Global Settings Page**
- Accessible from the main dashboard header ("Global Settings").
- Central hub to manage *all* sites at the global level: overview of every project, cross-site reports + AI insights runner, agent integration instructions, and quick global actions.
- This complements the per-site settings pages so you (and your AI agent) can manage many things without switching contexts constantly.

## Authentication & Security (new in this release)
- Set `DASHBOARD_PASSWORD=...` to enable login at `/login`. Sessions are 30-day HMAC-signed httpOnly cookies (Web Crypto, Edge-compatible).
- **Strongly recommended**: generate a hash with `node scripts/generate-password-hash.mjs "your-strong-password"` and set `DASHBOARD_PASSWORD_HASH=...` instead of (or in addition to) the plain password.
- The login form, rate-limited (8 attempts / 5 min per IP).
- `/api/track` and server-side goal ingestion are rate-limited per IP (generous defaults, tunable).
- Security headers + basic CSP are applied to the dashboard UI.
- Tracking script, Stripe webhook, and the `nut_sk_*` API remain public by design (they must be reachable from browsers and Stripe).

## Performance & Limits
All numbers (including revenue attribution) are computed live with indexed SQL on every request. This keeps the system simple and correct with no background jobs.

- Excellent for small-to-medium sites (tens to low hundreds of thousands of events).
- At higher volume the dashboard can slow down (GROUP BY + DISTINCT + correlated subqueries). The schema ports directly to Postgres/ClickHouse if you ever outgrow SQLite.
- Realtime "X online" looks at the last 5 minutes.
- Breakdowns are limited to the top N (default ~10–15) for speed and readability.

See also the health endpoint `/api/health`.

## Docker (first-class support)
```bash
docker compose up --build
# Visit http://localhost:3000
```
- Persistent volume `./data:/app/data` is mounted automatically.
- The image uses `output: "standalone"` for a small footprint.
- Healthcheck hits `/api/health`.

See `Dockerfile`, `docker-compose.yml`, and `.env.example`.

## Data export & privacy
- **API**: `GET /api/v1/export?kind=summary|events|payments|goals&period=30d` (same Bearer key as stats). Supports `format=json` or CSV (default) + the usual filter params.
- **UI**: "Export CSV" link on the site dashboard + full privacy tooling in Settings.
- **Forget visitor**: In site Settings → Privacy tools, enter a `nut_vid` to delete all their events. Payments stay for totals but lose the visitor link ("Unattributed").

This gives you real ownership of the data you collect.

## Development & tests
```bash
npm install
npm run dev
node scripts/seed.mjs          # demo data
npm test                       # Vitest (29+ tests covering attribution, bounce, parse, auth, rate limits, etc.)
npm run lint                   # type check
```

Tests use an in-memory SQLite DB (`ANALYTICS_DB_PATH=:memory:`) for isolation and speed. The most important tests exercise the revenue first-touch logic and session math with realistic multi-touch visitor journeys.

## Environment variables (full list)
See `.env.example`. Key ones:
- `DASHBOARD_PASSWORD` / `DASHBOARD_PASSWORD_HASH`
- `SESSION_SECRET`
- `STRIPE_WEBHOOK_SECRET`
- Reporting: `TELEGRAM_*`, `RESEND_*`, `ANTHROPIC_*`, `REPORT_HOUR_UTC`
- `ANALYTICS_DB_PATH` (advanced / tests)

## Upgrading from earlier versions
- Existing data is untouched.
- To harden auth: run the hash generator script and set `DASHBOARD_PASSWORD_HASH`.
- Old plaintext still works (with a warning in non-dev environments).

Enjoy owning your analytics and revenue numbers. 🥜

Contributions, issues, and real-world usage reports are very welcome.
