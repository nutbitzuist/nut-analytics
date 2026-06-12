# Changelog

All notable changes to Nut Analytics.

## [Unreleased] - 2026-06-12

### Security & Reliability
- Added proper password hashing using Node `crypto.scrypt` (`DASHBOARD_PASSWORD_HASH`). Plaintext `DASHBOARD_PASSWORD` remains as a legacy/transition option with warnings.
- Added in-memory rate limiting on `/api/track`, `/api/v1/events`, and the login endpoint (configurable, per-IP).
- Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, basic CSP) now applied to dashboard routes.
- 29+ unit + integration tests covering parse logic, revenue attribution (first-touch), bounce/duration math, goals, sessions, auth (including new hash roundtrips), and rate limiting.

### Features & Completeness
- New `/api/v1/export` (Bearer key) for CSV/JSON dumps of events, payments, goals, or summary for a period + filters.
- Privacy tool: "Forget visitor" (by `nut_vid`) in site settings — deletes events for that visitor and unlinks payments (keeps aggregate revenue as Unattributed).
- Lightweight `/api/health` endpoint (used by Docker HEALTHCHECK).
- `output: "standalone"` enabled for smaller Docker images.

### Ops & Deploy
- Full multi-stage `Dockerfile` (handles better-sqlite3 native compilation) + `docker-compose.yml` with correct persistent volume for `data/`.
- `.env.example` with all documented variables.
- `.dockerignore`.
- `scripts/generate-password-hash.mjs` helper.
- GitHub Actions CI skeleton (build + test) added in `.github/workflows/ci.yml`.

### Polish & Fixes
- AI reports now use configurable `ANTHROPIC_MODEL` (sane default `claude-3-5-sonnet-20241022`).
- Removed duplicate `origin()` helpers (now use the existing `publicOrigin` from auth).
- Test infrastructure with Vitest + in-memory SQLite support via `ANALYTICS_DB_PATH`.
- Many internal cleanups while preserving the original minimalist spirit and ~2 KB tracker.

### Breaking / Migration
- None for existing data or basic usage. If you were relying on the old "no auth" behavior, set `DASHBOARD_PASSWORD` (or the hash) to re-enable protection.
- For maximum security, generate a hash and prefer `DASHBOARD_PASSWORD_HASH`.

See the updated README for full details on Docker, exports, privacy, tests, and production notes.

## [0.1.0] - Initial public version
- Self-hosted analytics with pageviews, SPA support, goals, UTM, geo, device, Stripe first-touch revenue attribution, API, reports + optional AI memos, seed script, beautiful settings-as-docs UI.
- SQLite WAL, live SQL queries, ~2 KB tracker.
