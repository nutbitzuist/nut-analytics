import { db } from "@/lib/db";
import { buildReport } from "@/lib/report";
import { channelsConfigured, deliver } from "@/lib/notify";

/**
 * In-process report scheduler. Railway runs the app as a long-lived server,
 * so a minute tick is enough — no external cron required.
 *
 *   REPORT_HOUR_UTC  hour (0-23) to send reports; default 1 (= 08:00 Asia/Bangkok)
 *   Weekly memo goes out on Mondays at the same hour.
 *
 * report_log guards against duplicate sends across restarts.
 */

function ensureLog() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS report_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL,
      period_key TEXT NOT NULL,
      sent_at    INTEGER NOT NULL,
      UNIQUE(kind, period_key)
    );
  `);
}

function alreadySent(kind: string, periodKey: string): boolean {
  ensureLog();
  return Boolean(db().prepare("SELECT 1 FROM report_log WHERE kind = ? AND period_key = ?").get(kind, periodKey));
}

function markSent(kind: string, periodKey: string) {
  ensureLog();
  db()
    .prepare("INSERT OR IGNORE INTO report_log (kind, period_key, sent_at) VALUES (?, ?, ?)")
    .run(kind, periodKey, Date.now());
}

export async function runReport(kind: "daily" | "weekly", force = false): Promise<{ sent: boolean; text: string }> {
  const now = new Date();
  const periodKey =
    kind === "daily"
      ? now.toISOString().slice(0, 10)
      : `${now.getUTCFullYear()}-W${Math.ceil((now.getUTCDate() + 6 - now.getUTCDay()) / 7)}-${now.getUTCMonth()}`;

  if (!force && alreadySent(kind, periodKey)) return { sent: false, text: "" };

  const { text } = await buildReport(kind);
  const channels = channelsConfigured();
  if (!channels.telegram && !channels.email) {
    return { sent: false, text };
  }
  const result = await deliver(
    kind === "daily" ? "🥜 Daily analytics summary" : "🥜 Weekly growth memo",
    text
  );
  if (result.telegram || result.email) {
    markSent(kind, periodKey);
    console.log(`[reports] sent ${kind} report (telegram=${result.telegram}, email=${result.email})`);
    return { sent: true, text };
  }
  return { sent: false, text };
}

export function startScheduler() {
  const g = globalThis as { __nutScheduler?: boolean };
  if (g.__nutScheduler) return;
  g.__nutScheduler = true;

  const hour = Number(process.env.REPORT_HOUR_UTC ?? 1);
  console.log(`[reports] scheduler started — daily at ${hour}:00 UTC, weekly on Mondays`);

  setInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() !== hour) return;
    try {
      await runReport("daily");
      if (now.getUTCDay() === 1) await runReport("weekly");
    } catch (err) {
      console.error("[reports] scheduler error:", err);
    }
  }, 60_000);
}
