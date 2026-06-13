import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

// IMPORTANT: set memory DB *before* importing the modules under test
process.env.ANALYTICS_DB_PATH = ":memory:";

import { db, applySchema, resetDbForTests, type Site } from "@/lib/db";
import {
  totals,
  timeseries,
  breakdown,
  goals,
  revenue,
  realtimeVisitors,
  resolvePeriod,
} from "@/lib/queries";

function freshDb() {
  resetDbForTests();
  const d = db(); // will be the :memory: one
  // applySchema is already called by migrate inside db(), but we ensure
  return d;
}

function createDemoSite(name = "Test Site"): Site {
  const d = db();
  const id = "demo" + Math.random().toString(36).slice(2, 8);
  const site = { id, domain: "demo.test", name, created_at: Date.now(), api_key: "nut_sk_test" };
  d.prepare(
    "INSERT INTO sites (id, domain, name, created_at, api_key) VALUES (@id, @domain, @name, @created_at, @api_key)"
  ).run(site);
  return site;
}

function insertEvent(siteId: string, partial: Partial<any> & { type: string; ts: number; visitor_id: string }) {
  const d = db();
  const defaults = {
    name: null,
    path: "/",
    referrer: null,
    referrer_source: "Direct",
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    session_id: "sid_" + Math.random().toString(36).slice(2, 10),
    country: "US",
    region: null,
    city: null,
    browser: "Chrome",
    os: "macOS",
    device: "Desktop",
    screen_w: 1440,
    screen_h: 900,
    duration: null,
    scroll: null,
    is_new: null,
    meta: null,
  };
  const row = { ...defaults, site_id: siteId, ...partial };
  d.prepare(
    `INSERT INTO events (site_id, type, name, path, referrer, referrer_source, utm_source, utm_medium, utm_campaign, utm_term, utm_content, visitor_id, session_id, country, region, city, browser, os, device, screen_w, screen_h, duration, scroll, is_new, meta, ts)
     VALUES (@site_id, @type, @name, @path, @referrer, @referrer_source, @utm_source, @utm_medium, @utm_campaign, @utm_term, @utm_content, @visitor_id, @session_id, @country, @region, @city, @browser, @os, @device, @screen_w, @screen_h, @duration, @scroll, @is_new, @meta, @ts)`
  ).run(row);
}

function insertPayment(siteId: string, partial: Partial<any>) {
  const d = db();
  const row = {
    visitor_id: null,
    stripe_event_id: "evt_" + Math.random().toString(36).slice(2, 12),
    customer_id: null,
    email: null,
    description: "Checkout",
    amount: 1900,
    currency: "usd",
    ts: Date.now(),
    ...partial,
    site_id: siteId,
  };
  d.prepare(
    `INSERT INTO payments (site_id, visitor_id, stripe_event_id, customer_id, email, description, amount, currency, ts)
     VALUES (@site_id, @visitor_id, @stripe_event_id, @customer_id, @email, @description, @amount, @currency, @ts)`
  ).run(row);
}

describe("queries + revenue attribution (core business logic)", () => {
  let site: Site;
  const now = Date.now();
  const DAY = 86_400_000;

  beforeEach(() => {
    freshDb();
    site = createDemoSite();
  });

  it("computes basic totals, timeseries, and breakdowns", () => {
    // Two visitors, one with 2 pageviews, one with 1
    insertEvent(site.id, { type: "pageview", visitor_id: "v1", ts: now - 1000, referrer_source: "Google" });
    insertEvent(site.id, { type: "pageview", visitor_id: "v1", ts: now - 500, referrer_source: "Google", path: "/pricing" });
    insertEvent(site.id, { type: "pageview", visitor_id: "v2", ts: now - 200, referrer_source: "Direct" });

    const { from, to } = resolvePeriod("all");
    const t = totals(site.id, from, to, {});
    expect(t.visitors).toBe(2);
    expect(t.pageviews).toBe(3);

    const br = breakdown(site.id, from, to, {}, "referrer_source", 10);
    expect(br.length).toBeGreaterThanOrEqual(1);
    const google = br.find((r) => r.value === "Google");
    expect(google?.visitors).toBe(1);
  });

  it("calculates bounce rate and engaged duration from engagement events", () => {
    const t0 = now - 10 * 60_000;
    // v1: single page view, no engagement -> bounce, 0 engaged seconds
    insertEvent(site.id, { type: "pageview", visitor_id: "v1", session_id: "s1", ts: t0 });
    // v2: two pageviews + engagement events totalling 30s -> not bounce
    insertEvent(site.id, { type: "pageview", visitor_id: "v2", session_id: "s2", ts: t0 + 1000 });
    insertEvent(site.id, { type: "engagement", visitor_id: "v2", session_id: "s2", ts: t0 + 5000, duration: 10 });
    insertEvent(site.id, { type: "pageview", visitor_id: "v2", session_id: "s2", ts: t0 + 31000, path: "/pricing" });
    insertEvent(site.id, { type: "engagement", visitor_id: "v2", session_id: "s2", ts: t0 + 41000, duration: 20, path: "/pricing" });

    const { from, to } = resolvePeriod("all");
    const t = totals(site.id, from, to, {});
    expect(t.visitors).toBe(2);
    // bounce rate = avg of (pageviews==1) over sessions = 0.5
    expect(t.bounceRate).toBeCloseTo(0.5, 1);
    // s1 = 0s engaged, s2 = 30s engaged -> avg 15s
    expect(t.avgDuration).toBeCloseTo(15, 0);
    expect(t.totalDuration).toBe(30);
  });

  it("computes new vs returning visitors and funnel conversion", async () => {
    const { funnel, newVsReturning } = await import("@/lib/queries");
    // returning visitor: first seen long before the window's "new" cutoff
    insertEvent(site.id, { type: "pageview", visitor_id: "ret", session_id: "r1", ts: now - 40 * DAY, path: "/" });
    insertEvent(site.id, { type: "pageview", visitor_id: "ret", session_id: "r2", ts: now - 1000, path: "/" });
    insertEvent(site.id, { type: "pageview", visitor_id: "ret", session_id: "r2", ts: now - 900, path: "/pricing" });
    insertEvent(site.id, { type: "goal", visitor_id: "ret", session_id: "r2", ts: now - 800, name: "start_trial" });
    // brand new visitor in the last 7 days
    insertEvent(site.id, { type: "pageview", visitor_id: "fresh", session_id: "f1", ts: now - 2000, path: "/" });

    const { from, to } = resolvePeriod("7d");
    const nr = newVsReturning(site.id, from, to, {});
    expect(nr.new).toBe(1); // "fresh"
    expect(nr.returning).toBe(1); // "ret" (first seen 40d ago)

    const f = funnel(site.id, from, to, [
      { kind: "page", match: "/" },
      { kind: "page", match: "/pricing" },
      { kind: "goal", match: "start_trial" },
    ]);
    expect(f[0].visitors).toBe(2); // both hit "/"
    expect(f[1].visitors).toBe(1); // only "ret" reached /pricing
    expect(f[2].visitors).toBe(1); // only "ret" fired start_trial
    expect(f[2].rate).toBeCloseTo(0.5, 1);
  });

  it("attributes revenue to first-touch source (the killer feature)", () => {
    const v1 = "vid_first_google";
    const v2 = "vid_first_direct_then_paid";

    // v1: first touch Google, later pays
    insertEvent(site.id, { type: "pageview", visitor_id: v1, ts: now - 5 * DAY, referrer_source: "Google" });
    insertEvent(site.id, { type: "pageview", visitor_id: v1, ts: now - 4 * DAY, referrer_source: "Direct" });
    insertPayment(site.id, { visitor_id: v1, amount: 2900, ts: now - 1 * DAY });

    // v2: first touch Direct, later pays (should be Direct even if later sources differ)
    insertEvent(site.id, { type: "pageview", visitor_id: v2, ts: now - 3 * DAY, referrer_source: "Direct" });
    insertPayment(site.id, { visitor_id: v2, amount: 1900, ts: now - 1000 });

    const { from, to } = resolvePeriod("all");
    const rev = revenue(site.id, from, to, {});

    expect(rev.payments).toBe(2);
    expect(rev.amount).toBe(4800);

    const bySource = rev.bySource;
    const googleRow = bySource.find((r) => r.value === "Google");
    const directRow = bySource.find((r) => r.value === "Direct");

    expect(googleRow?.amount).toBe(2900);
    expect(directRow?.amount).toBe(1900);
  });

  it("respects active filters when computing revenue by channel", () => {
    const v1 = "v-filtered";
    insertEvent(site.id, { type: "pageview", visitor_id: v1, ts: now - DAY, referrer_source: "Google", path: "/pricing" });
    insertPayment(site.id, { visitor_id: v1, amount: 9900, ts: now - 1000 });

    const { from, to } = resolvePeriod("all");

    // Without filter -> sees the payment attributed to Google
    const allRev = revenue(site.id, from, to, {});
    expect(allRev.bySource.some((r) => r.value === "Google")).toBe(true);

    // With path filter that matches -> still attributed
    const filtered = revenue(site.id, from, to, { path: "/pricing" });
    expect(filtered.payments).toBe(1);
    expect(filtered.amount).toBe(9900);
  });

  it("registered goals appear even with zero conversions", () => {
    // Manually register a goal
    db().prepare("INSERT INTO goals (site_id, name, created_at) VALUES (?, ?, ?)").run(site.id, "signup", now);

    const { from, to } = resolvePeriod("all");
    const g = goals(site.id, from, to, {});
    const signup = g.find((x) => x.name === "signup");
    expect(signup).toBeTruthy();
    expect(signup?.events).toBe(0);
    expect(signup?.conversions).toBe(0);
    expect(signup?.rate).toBe(0);
  });

  it("realtimeVisitors only counts recent activity", () => {
    insertEvent(site.id, { type: "pageview", visitor_id: "recent", ts: Date.now() - 60_000 });
    insertEvent(site.id, { type: "pageview", visitor_id: "old", ts: Date.now() - 10 * 60_000 });

    expect(realtimeVisitors(site.id)).toBe(1);
  });
});