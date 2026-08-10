-- Nut Analytics Cloudflare D1 schema.
-- Mirrors the current better-sqlite3 schema with all additive columns present.

CREATE TABLE IF NOT EXISTS sites (
  id         TEXT PRIMARY KEY,
  domain     TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  api_key    TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_sites_api_key ON sites(api_key);

CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id         TEXT NOT NULL,
  type            TEXT NOT NULL,
  name            TEXT,
  path            TEXT,
  referrer        TEXT,
  referrer_source TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  utm_term        TEXT,
  utm_content     TEXT,
  visitor_id      TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  country         TEXT,
  region          TEXT,
  city            TEXT,
  browser         TEXT,
  os              TEXT,
  device          TEXT,
  screen_w        INTEGER,
  screen_h        INTEGER,
  duration        INTEGER,
  scroll          INTEGER,
  is_new          INTEGER,
  meta            TEXT,
  ts              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_site_ts ON events(site_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(site_id, visitor_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(site_id, session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(site_id, type, ts);

CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id         TEXT NOT NULL,
  visitor_id      TEXT,
  stripe_event_id TEXT UNIQUE,
  customer_id     TEXT,
  email           TEXT,
  description     TEXT,
  amount          INTEGER NOT NULL,
  currency        TEXT NOT NULL,
  ts              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_site_ts ON payments(site_id, ts);

CREATE TABLE IF NOT EXISTS goals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(site_id, name)
);

CREATE TABLE IF NOT EXISTS funnels (
  id         TEXT PRIMARY KEY,
  site_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  steps      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_funnels_site ON funnels(site_id);

CREATE TABLE IF NOT EXISTS report_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  period_key TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  UNIQUE(kind, period_key)
);

CREATE TABLE IF NOT EXISTS agent_activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   INTEGER NOT NULL,
  auth_type   TEXT NOT NULL,
  site_id     TEXT,
  action      TEXT NOT NULL,
  params      TEXT,
  status      TEXT NOT NULL,
  details     TEXT
);
