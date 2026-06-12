/**
 * Seeds the database with a demo site and ~30 days of realistic traffic so you
 * can explore the dashboard immediately.
 *
 *   node scripts/seed.mjs
 *
 * Safe to re-run: it wipes and re-creates only the demo site's data.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "analytics.db"));
db.pragma("journal_mode = WAL");

// Mirror of src/lib/db.ts migrate() so seeding works before first server boot.
db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY, domain TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT,
    path TEXT, referrer TEXT, referrer_source TEXT,
    utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
    visitor_id TEXT NOT NULL, session_id TEXT NOT NULL,
    country TEXT, region TEXT, city TEXT, browser TEXT, os TEXT, device TEXT,
    screen_w INTEGER, meta TEXT, ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_site_ts ON events(site_id, ts);
  CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(site_id, visitor_id, ts);
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(site_id, session_id);
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL, visitor_id TEXT,
    stripe_event_id TEXT UNIQUE, customer_id TEXT, email TEXT, description TEXT,
    amount INTEGER NOT NULL, currency TEXT NOT NULL, ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_payments_site_ts ON payments(site_id, ts);
`);

const DOMAIN = "demo.example.com";
const existing = db.prepare("SELECT id FROM sites WHERE domain = ?").get(DOMAIN);
const siteId = existing?.id ?? crypto.randomUUID().replace(/-/g, "").slice(0, 12);
if (existing) {
  db.prepare("DELETE FROM events WHERE site_id = ?").run(siteId);
  db.prepare("DELETE FROM payments WHERE site_id = ?").run(siteId);
} else {
  db.prepare("INSERT INTO sites (id, domain, name, created_at) VALUES (?, ?, ?, ?)").run(
    siteId, DOMAIN, "Demo Site", Date.now()
  );
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[0][0];
};

const PATHS = [["/", 40], ["/pricing", 18], ["/blog/launch", 12], ["/blog/how-it-works", 9], ["/docs", 8], ["/signup", 7], ["/about", 4], ["/changelog", 2]];
const SOURCES = [["Direct", 30], ["Google", 25], ["X (Twitter)", 14], ["Product Hunt", 8], ["Hacker News", 7], ["Reddit", 6], ["LinkedIn", 4], ["ChatGPT", 3], ["GitHub", 3]];
const COUNTRIES = [["US", 35], ["TH", 15], ["GB", 10], ["DE", 8], ["IN", 8], ["FR", 6], ["CA", 5], ["AU", 4], ["JP", 4], ["BR", 3]];
const DEVICES = [["Desktop", 58], ["Mobile", 36], ["Tablet", 6]];
const BROWSERS = [["Chrome", 55], ["Safari", 22], ["Firefox", 9], ["Edge", 8], ["Mobile Safari", 6]];
const OSES = [["macOS", 30], ["Windows", 28], ["iOS", 20], ["Android", 16], ["Linux", 6]];

const DAY = 86_400_000;
const now = Date.now();

const insertEvent = db.prepare(`
  INSERT INTO events (site_id, type, name, path, referrer, referrer_source,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    visitor_id, session_id, country, region, city, browser, os, device, screen_w, meta, ts)
  VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
`);
const insertPayment = db.prepare(`
  INSERT INTO payments (site_id, visitor_id, stripe_event_id, customer_id, email, description, amount, currency, ts)
  VALUES (?, ?, ?, ?, ?, 'Checkout', ?, 'usd', ?)
`);

let events = 0, payments = 0;

const seedAll = db.transaction(() => {
  for (let day = 29; day >= 0; day--) {
    // Traffic grows over time with weekday peaks and a Product Hunt spike.
    let visitorsToday = Math.round(30 + (29 - day) * 2.5 + Math.random() * 20);
    if (day === 9) visitorsToday *= 3; // launch spike

    for (let v = 0; v < visitorsToday; v++) {
      const vid = crypto.randomUUID();
      const sid = crypto.randomUUID();
      const source = day === 9 && Math.random() < 0.5 ? "Product Hunt" : weighted(SOURCES);
      const country = weighted(COUNTRIES);
      const device = weighted(DEVICES);
      const browser = weighted(BROWSERS);
      const os = weighted(OSES);
      const utmCampaign = source === "X (Twitter)" && Math.random() < 0.3 ? "launch-week" : null;
      const utmSource = utmCampaign ? "twitter" : null;
      const screenW = device === "Mobile" ? 390 : device === "Tablet" ? 820 : 1440;

      const dayStart = now - day * DAY;
      let ts = dayStart - Math.floor(Math.random() * DAY * 0.9);
      if (ts > now) ts = now - Math.floor(Math.random() * 3_600_000);

      const views = weighted([[1, 45], [2, 25], [3, 15], [4, 8], [6, 5], [9, 2]]);
      for (let i = 0; i < views; i++) {
        insertEvent.run(siteId, "pageview", null, i === 0 ? weighted(PATHS) : pick(PATHS)[0],
          source, utmSource, utmCampaign, vid, sid, country, browser, os, device, screenW, null, ts);
        events++;
        ts += 10_000 + Math.floor(Math.random() * 110_000);
      }

      // ~12% sign up, ~25% of those pay
      if (Math.random() < 0.12) {
        insertEvent.run(siteId, "goal", "signup", "/signup", source, utmSource, utmCampaign,
          vid, sid, country, browser, os, device, screenW, JSON.stringify({ plan: pick(["free", "pro"]) }), ts);
        events++;
        if (Math.random() < 0.25) {
          insertEvent.run(siteId, "goal", "purchase", "/checkout/success", source, utmSource, utmCampaign,
            vid, sid, country, browser, os, device, screenW, null, ts + 60_000);
          events++;
          insertPayment.run(siteId, vid, `evt_demo_${vid.slice(0, 8)}`, `cus_demo_${vid.slice(0, 8)}`,
            `user${payments}@example.com`, pick([900, 1900, 1900, 4900]), ts + 90_000);
          payments++;
        }
      }
    }
  }
});

seedAll();
console.log(`Seeded demo site "${DOMAIN}" (id: ${siteId})`);
console.log(`  ${events} events, ${payments} payments over 30 days`);
console.log(`  Dashboard: http://localhost:3000/site/${siteId}`);
