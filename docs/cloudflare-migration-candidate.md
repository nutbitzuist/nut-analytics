# Nut Analytics Cloudflare migration candidate

Stage: **prepared locally → package measured → isolated workers.dev preview deployed**. No canonical DNS/domain, Railway service, Vercel project, or production client has been changed or deleted.

Live isolated candidate: `https://nut-analytics-cf-candidate.email-nutty.workers.dev`

- D1 database `nut-analytics-candidate` was created in APAC and migration `0001_initial.sql` applied.
- The known personal-site ID `82501baf840a` was seeded for `nut.leverage100x.com`; historical Railway SQLite data remains unavailable and was not fabricated.
- Worker startup measured 4 ms; upload measured 28.08 KiB / 7.90 KiB gzip.
- `/api/health` returned `200` from Workers+D1 with one site.
- A synthetic pageview returned `200`, was verified in remote D1, then deleted and verified absent.
- The live isolated version has D1 writes enabled after that gate; the checked-in configuration remains fail-closed (`disabled`) so an ordinary redeploy cannot silently reopen writes.

## Verdict

A full OpenNext + Cloudflare lift of the current Next 15 app is **not yet feasible as a safe one-step candidate** because the runtime imports `better-sqlite3`, `fs`, `path`, `geoip-lite`, and an in-process scheduler. Those are Node/server-process assumptions, not D1/Workers assumptions.

The safe bounded candidate in this branch is a **Cloudflare Workers + D1 data-authority slice** that preserves the most important active contracts:

- `GET /js/script.js` — serves the existing tracker asset with the same CORS/cache intent.
- `POST/OPTIONS /api/track` — D1-backed browser ingestion.
- `GET/POST/DELETE /api/v1/sites` — owner/site-key API contract.
- `GET/POST/DELETE /api/v1/goals` — registered goal contract.
- `GET/POST /api/v1/events` — server-side events and raw-event reads.
- `GET /api/v1/stats` — core dashboard/agent stats subset over D1.
- `POST /api/stripe/webhook` — raw-body Stripe signature verification and idempotent payment insert. It fails closed with `503 stripe_webhook_secret_not_configured` when the secret is absent.
- `GET /api/health` — D1 health probe.

All unresolved dashboard HTML routes fail closed in the Worker with an explanatory 503 rather than silently proxying to the dead Railway origin or pretending parity. All mutating methods also fail closed unless `CF_MIGRATION_WRITE_MODE=d1` is explicitly enabled after D1 migration and reconciliation; the checked-in Wrangler default is `disabled`.

## Cost target

The candidate is designed for Cloudflare Workers Free + D1 Free while usage remains small. No paid product is enabled by this repo. Before cutover, measure production request volume, D1 rows read/written, Worker CPU, and script size against current Cloudflare limits. If those are unknown, the cost claim remains **not yet provable**, not guaranteed.

## Data migration needs

Production data currently lives in SQLite (`data/analytics.db` or `ANALYTICS_DB_PATH`) on the legacy host. Cutover needs an explicit export/import:

1. Stop or freeze legacy writes.
2. Export SQLite tables: `sites`, `events`, `payments`, `goals`, `funnels`, `report_log`, `agent_activity_log`.
3. Apply `migrations/0001_initial.sql` to D1.
4. Import rows preserving IDs, timestamps, `api_key`, and `stripe_event_id` uniqueness.
5. Reconcile source SQLite vs D1 counts/hashes per table before routing traffic.
6. Configure Worker secrets: `DASHBOARD_PASSWORD` or `REPORTS_BASIC_TOKEN`, `STRIPE_WEBHOOK_SECRET`.
7. Enable `CF_MIGRATION_WRITE_MODE=d1` only after the D1 import and reconciliation pass.
8. Update client sites to use the new Cloudflare host only after D1 reconciliation passes.

## Provider-exit manifest

```json
{
  "candidate": "cloudflare-workers-d1",
  "stage": "isolated_workers_dev_preview_deployed",
  "canonicalProductionMutation": false,
  "isolatedCloudflarePreviewMutation": true,
  "routesOwned": [
    "/js/script.js",
    "/api/health",
    "/api/track",
    "/api/v1/sites",
    "/api/v1/goals",
    "/api/v1/events",
    "/api/v1/stats",
    "/api/stripe/webhook"
  ],
  "failClosedRoutes": ["dashboard HTML pages", "AI ask", "MCP", "reports scheduler/run", "exports", "forget visitor", "full dashboard charts not in stats subset"],
  "legacyOriginFallback": false,
  "defaultWriteMode": "disabled_fail_closed",
  "railwayDeletionApproved": false,
  "dnsCutoverApproved": false,
  "cloudflarePaidProductsApproved": false
}
```

## Remaining blockers

- Rebuild the full dashboard UI to consume D1 APIs or prove an OpenNext package without Node-native imports.
- Port report scheduler to Cloudflare Cron, with exactly-one scheduler authority and report provider secrets.
- Port `/api/v1/export`, `/api/v1/forget-visitor`, `/api/v1/openapi`, `/api/mcp`, `/api/ai/ask`, and realtime dashboard endpoints if they are still required.
- Replace in-memory rate limiting with a durable Cloudflare-safe limiter if abuse protection must be strong across isolates.
- Refresh Cloudflare pricing/limits and run a live isolated preview only after approval.
