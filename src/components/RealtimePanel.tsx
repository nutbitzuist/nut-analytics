"use client";

import { useEffect, useMemo, useState } from "react";

type RecentEvent = {
  id: number;
  type: string;
  name: string | null;
  path: string | null;
  referrer_source: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  visitor_id: string;
  session_id: string;
  ts: number;
};

type RealtimePayload = {
  realtime_visitors: number;
  total_events: number;
  today: { visitors: number; pageviews: number; sessions: number };
  recent_events: RecentEvent[];
  generated_at: number;
};

function ago(ts: number) {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

function shortId(id: string) {
  return id ? id.slice(0, 8) : "unknown";
}

export default function RealtimePanel({ siteId }: { siteId: string }) {
  const [data, setData] = useState<RealtimePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/dashboard/realtime?site=${encodeURIComponent(siteId)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as RealtimePayload;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to refresh");
      }
    }

    load();
    const poll = window.setInterval(load, 3_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [siteId]);

  const recent = data?.recent_events ?? [];
  const last = recent[0];
  const lastLabel = useMemo(() => (last ? ago(last.ts) : "No events yet"), [last, now]);

  return (
    <section className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-emerald-300">Live activity</h2>
          <p className="text-xs text-white/45">Auto-refreshes every 3s, so you should not need to ask if tracking is alive.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-emerald-200">
            {data?.realtime_visitors ?? "—"} online now
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-white/60">
            Last event: {lastLabel}
          </span>
          {error && <span className="rounded-full border border-red-400/30 bg-red-400/10 px-3 py-1 text-red-200">Refresh error: {error}</span>}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          <div className="text-white/40">Today visitors</div>
          <div className="mt-1 text-lg font-bold tabular-nums">{data?.today.visitors ?? "—"}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          <div className="text-white/40">Today pageviews</div>
          <div className="mt-1 text-lg font-bold tabular-nums">{data?.today.pageviews ?? "—"}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          <div className="text-white/40">All events</div>
          <div className="mt-1 text-lg font-bold tabular-nums">{data?.total_events ?? "—"}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10">
        {recent.length === 0 ? (
          <div className="p-4 text-sm text-white/40">No recent events yet. Open the tracked website in a normal browser tab.</div>
        ) : (
          <ul className="divide-y divide-white/5 text-sm">
            {recent.slice(0, 12).map((ev) => (
              <li key={ev.id} className="grid gap-2 px-3 py-2 sm:grid-cols-[95px_1fr_130px]">
                <div className="text-xs text-white/45">{ago(ev.ts)}</div>
                <div className="min-w-0">
                  <span className={ev.type === "goal" ? "text-amber-300" : "text-emerald-300"}>{ev.type === "goal" ? `Goal: ${ev.name}` : "Pageview"}</span>
                  <span className="ml-2 break-all text-white/80">{ev.path || "/"}</span>
                  <div className="mt-0.5 text-xs text-white/40">
                    {ev.referrer_source || "Direct"} · {ev.device || "Unknown device"} · {ev.browser || "Unknown browser"} · visitor {shortId(ev.visitor_id)}
                  </div>
                </div>
                <div className="text-xs text-white/35 sm:text-right">{ev.country || "Unknown location"}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
