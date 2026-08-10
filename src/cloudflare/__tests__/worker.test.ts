import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import worker, { type Env } from "../worker";

const migrationSql = readFileSync(resolve(__dirname, "../../../migrations/0001_initial.sql"), "utf8");

class SqliteD1 {
  db = new Database(":memory:");
  constructor() {
    this.db.exec(migrationSql);
  }
  prepare(sql: string) {
    const stmt = this.db.prepare(sql);
    let params: unknown[] = [];
    const prepared = {
      bind: (...bound: unknown[]) => {
        params = bound;
        return prepared;
      },
      all: <T = unknown>() => {
        const rows = stmt.all(...params) as T[];
        return Promise.resolve({ results: rows, success: true, meta: {} });
      },
      first: <T = unknown>() => {
        const row = stmt.get(...params) as T | undefined;
        return Promise.resolve(row ?? null);
      },
      run: () => {
        const result = stmt.run(...params);
        return Promise.resolve({ success: true, meta: { changes: result.changes, last_row_id: result.lastInsertRowid } });
      },
    };
    return prepared;
  }
}

function basic(password = "secret") {
  return `Basic ${btoa(`owner:${password}`)}`;
}

function makeEnv(): Env {
  return {
    DB: new SqliteD1() as unknown as Env["DB"],
    DASHBOARD_PASSWORD: "secret",
    CF_MIGRATION_WRITE_MODE: "d1",
    ASSETS: {
      fetch: async () => new Response("console.log('tracker');", { headers: { "content-type": "application/javascript" } }),
    } as Env["ASSETS"],
  };
}

async function fetchJson(env: Env, path: string, init: RequestInit = {}) {
  const res = await worker.fetch(new Request(`https://analytics.example${path}`, init), env);
  return { res, body: await res.json() as any };
}

async function createSite(env: Env, domain = "example.com", name = "Main") {
  const { res, body } = await fetchJson(env, "/api/v1/sites", {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/json" },
    body: JSON.stringify({ name, domain }),
  });
  expect(res.status).toBe(201);
  return body.site as { id: string; api_key: string; domain: string; name: string };
}

describe("Cloudflare Worker/D1 migration candidate", () => {
  let env: Env;
  beforeEach(() => { env = makeEnv(); });

  it("serves the existing tracker asset with CORS/cache headers", async () => {
    const res = await worker.fetch(new Request("https://analytics.example/js/script.js"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    expect(await res.text()).toContain("tracker");
  });

  it("creates sites through owner auth and exposes site-key scoped reads", async () => {
    const site = await createSite(env);
    expect(site.api_key).toMatch(/^nut_sk_/);

    const { res, body } = await fetchJson(env, "/api/v1/sites", { headers: { authorization: `Bearer ${site.api_key}` } });
    expect(res.status).toBe(200);
    expect(body.sites).toHaveLength(1);
    expect(body.sites[0].id).toBe(site.id);
  });

  it("prevents one site key from reading another site's record", async () => {
    const first = await createSite(env, "first.example");
    const second = await createSite(env, "second.example");
    const { res, body } = await fetchJson(env, `/api/v1/sites?id=${second.id}`, {
      headers: { authorization: `Bearer ${first.api_key}` },
    });
    expect(res.status).toBe(403);
    expect(body.error).toContain("another site");
  });

  it("ingests browser events into D1 and returns core stats", async () => {
    const site = await createSite(env);
    const ingest = await fetchJson(env, "/api/track", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Chrome/120", "cf-ipcountry": "US" },
      body: JSON.stringify({ site: site.id, type: "pageview", url: "https://example.com/pricing?utm_source=x", ref: "https://google.com/", vid: "v1", sid: "s1", w: 1440, h: 900, n: 1 }),
    });
    expect(ingest.res.status).toBe(200);
    expect(ingest.body.ok).toBe(true);

    const stats = await fetchJson(env, `/api/v1/stats?site=${site.id}&period=all`, { headers: { authorization: basic() } });
    expect(stats.res.status).toBe(200);
    expect(stats.body.totals.pageviews).toBe(1);
    expect(stats.body.totals.visitors).toBe(1);
    expect(stats.body.pages[0].value).toBe("/pricing?utm_source=x");
  });

  it("supports registered goals and server-side goal events", async () => {
    const site = await createSite(env);
    const headers = { authorization: `Bearer ${site.api_key}`, "content-type": "application/json" };
    expect((await fetchJson(env, `/api/v1/goals?site=${site.id}`, { method: "POST", headers, body: JSON.stringify({ name: "signup" }) })).res.status).toBe(200);
    expect((await fetchJson(env, `/api/v1/events?site=${site.id}`, { method: "POST", headers, body: JSON.stringify({ name: "signup", visitor_id: "v1", metadata: { plan: "pro" } }) })).body.ok).toBe(true);
    const events = await fetchJson(env, `/api/v1/events?site=${site.id}&period=all&type=goal`, { headers });
    expect(events.body.count).toBe(1);
    expect(events.body.events[0].name).toBe("signup");
  });

  it("fails Stripe webhooks closed when the signing secret is absent", async () => {
    const res = await worker.fetch(new Request("https://analytics.example/api/stripe/webhook", { method: "POST", body: JSON.stringify({ id: "evt_1", type: "checkout.session.completed" }) }), env);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ failClosed: true, error: "stripe_webhook_secret_not_configured" });
  });

  it("fails every mutation closed unless the D1 write gate is explicitly enabled", async () => {
    const disabled = makeEnv();
    disabled.CF_MIGRATION_WRITE_MODE = "disabled";
    const { res, body } = await fetchJson(disabled, "/api/track", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
      body: JSON.stringify({ site: "x", type: "pageview", url: "https://example.com", vid: "v", sid: "s" }),
    });
    expect(res.status).toBe(503);
    expect(body).toMatchObject({ error: "cloudflare_migration_writes_disabled", failClosed: true });
  });

  it("does not proxy unresolved dashboard routes to Railway", async () => {
    const res = await worker.fetch(new Request("https://analytics.example/site/abc"), env);
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(html).toContain("intentionally fail-closed");
    expect(html).not.toContain("railway");
  });
});
