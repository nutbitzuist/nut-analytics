import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

let _db: Database.Database | null = null;

function getDbFilePath(): string {
  const override = process.env.ANALYTICS_DB_PATH;
  if (override) return override;
  return path.join(DATA_DIR, "analytics.db");
}

export function db(): Database.Database {
  if (_db) return _db;
  const dbPath = getDbFilePath();
  const isMemory = dbPath === ":memory:";

  if (!isMemory) {
    fs.mkdirSync(path.dirname(dbPath) || DATA_DIR, { recursive: true });
  }

  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  migrate(_db);
  return _db;
}

/**
 * For tests: force a fresh DB (especially useful with ANALYTICS_DB_PATH=":memory:").
 * Call before importing modules that use db() in a new test file, or in beforeEach.
 */
export function resetDbForTests() {
  if (_db) {
    try {
      _db.close();
    } catch {
      // ignore
    }
  }
  _db = null;
}

/** Apply the full schema + migrations to a *given* database handle (used by tests and seed). */
export function applySchema(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id         TEXT PRIMARY KEY,
      domain     TEXT UNIQUE NOT NULL,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id         TEXT NOT NULL,
      type            TEXT NOT NULL,           -- 'pageview' | 'goal'
      name            TEXT,                    -- goal name when type='goal'
      path            TEXT,
      referrer        TEXT,
      referrer_source TEXT,                    -- normalized: Google, X, Direct, ...
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
      device          TEXT,                    -- desktop | mobile | tablet
      screen_w        INTEGER,
      meta            TEXT,                    -- JSON metadata for goals
      ts              INTEGER NOT NULL         -- unix ms
    );
    CREATE INDEX IF NOT EXISTS idx_events_site_ts   ON events(site_id, ts);
    CREATE INDEX IF NOT EXISTS idx_events_visitor   ON events(site_id, visitor_id, ts);
    CREATE INDEX IF NOT EXISTS idx_events_session   ON events(site_id, session_id);

    CREATE TABLE IF NOT EXISTS payments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id         TEXT NOT NULL,
      visitor_id      TEXT,
      stripe_event_id TEXT UNIQUE,
      customer_id     TEXT,
      email           TEXT,
      description     TEXT,
      amount          INTEGER NOT NULL,        -- in cents
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

    CREATE TABLE IF NOT EXISTS report_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL,
      period_key TEXT NOT NULL,
      sent_at    INTEGER NOT NULL,
      UNIQUE(kind, period_key)
    );
  `);

  // Back-compat migration for api_key (from original migrate)
  const siteCols = d.prepare("PRAGMA table_info(sites)").all() as { name: string }[];
  if (!siteCols.some((c) => c.name === "api_key")) {
    d.exec("ALTER TABLE sites ADD COLUMN api_key TEXT");
  }
  for (const row of d.prepare("SELECT id FROM sites WHERE api_key IS NULL").all() as { id: string }[]) {
    d.prepare("UPDATE sites SET api_key = ? WHERE id = ?").run(newApiKey(), row.id);
  }
}

// Kept for any external callers that might reference migrate directly.
// Delegates to the shared applySchema implementation.
function migrate(d: Database.Database) {
  applySchema(d);
}

function newApiKey(): string {
  return "nut_sk_" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export type Site = { id: string; domain: string; name: string; created_at: number; api_key: string };

export function listSites(): Site[] {
  return db().prepare("SELECT * FROM sites ORDER BY created_at ASC").all() as Site[];
}

export function getSite(id: string): Site | undefined {
  return db().prepare("SELECT * FROM sites WHERE id = ?").get(id) as Site | undefined;
}

export function getSiteByDomain(domain: string): Site | undefined {
  return db().prepare("SELECT * FROM sites WHERE domain = ?").get(domain) as Site | undefined;
}

export function getSiteByApiKey(apiKey: string): Site | undefined {
  return db().prepare("SELECT * FROM sites WHERE api_key = ?").get(apiKey) as Site | undefined;
}

export function createSite(name: string, domain: string): Site {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const site: Site = { id, domain: domain.toLowerCase(), name, created_at: Date.now(), api_key: newApiKey() };
  db()
    .prepare(
      "INSERT INTO sites (id, domain, name, created_at, api_key) VALUES (@id, @domain, @name, @created_at, @api_key)"
    )
    .run(site);
  return site;
}

export function regenerateApiKey(siteId: string): string {
  const key = newApiKey();
  db().prepare("UPDATE sites SET api_key = ? WHERE id = ?").run(key, siteId);
  return key;
}

export function deleteSite(id: string) {
  const d = db();
  d.prepare("DELETE FROM events WHERE site_id = ?").run(id);
  d.prepare("DELETE FROM payments WHERE site_id = ?").run(id);
  d.prepare("DELETE FROM goals WHERE site_id = ?").run(id);
  d.prepare("DELETE FROM sites WHERE id = ?").run(id);
}

export type Goal = { id: number; site_id: string; name: string; created_at: number };

export function listGoals(siteId: string): Goal[] {
  return db().prepare("SELECT * FROM goals WHERE site_id = ? ORDER BY created_at ASC").all(siteId) as Goal[];
}

export function addGoal(siteId: string, name: string) {
  db()
    .prepare("INSERT OR IGNORE INTO goals (site_id, name, created_at) VALUES (?, ?, ?)")
    .run(siteId, name, Date.now());
}

export function removeGoal(siteId: string, name: string) {
  db().prepare("DELETE FROM goals WHERE site_id = ? AND name = ?").run(siteId, name);
}

/**
 * Privacy tool: remove a specific visitor's events from a site.
 * Payments are kept for revenue totals but have their visitor_id nulled so they become "Unattributed".
 * This is intentionally scoped and auditable.
 */
export function forgetVisitor(siteId: string, visitorId: string): { eventsDeleted: number } {
  const d = db();
  const res = d.prepare("DELETE FROM events WHERE site_id = ? AND visitor_id = ?").run(siteId, visitorId);
  // Keep the money but break the link for attribution
  d.prepare("UPDATE payments SET visitor_id = NULL WHERE site_id = ? AND visitor_id = ?").run(siteId, visitorId);
  return { eventsDeleted: res.changes };
}
