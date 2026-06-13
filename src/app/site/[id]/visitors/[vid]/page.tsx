import Link from "next/link";
import { notFound } from "next/navigation";
import { getSite } from "@/lib/db";
import { visitorJourney, type JourneyEvent } from "@/lib/queries";
import { countryLabel } from "@/lib/parse";

export const dynamic = "force-dynamic";

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function dur(sec: number | null) {
  if (!sec) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function destOf(meta: string | null): string | null {
  if (!meta) return null;
  try {
    const o = JSON.parse(meta);
    return typeof o.dest === "string" ? o.dest : null;
  } catch {
    return null;
  }
}

const ICON: Record<string, string> = {
  pageview: "📄",
  goal: "🎯",
  outbound: "↗",
  download: "⬇",
  engagement: "⏱",
};

export default async function Journey({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; vid: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id, vid } = await params;
  const sp = await searchParams;
  const site = getSite(id);
  if (!site) notFound();
  const periodKey = sp.period ?? "30d";

  const j = visitorJourney(site.id, decodeURIComponent(vid));
  if (!j) {
    return (
      <main>
        <Link href={`/site/${site.id}/visitors?period=${periodKey}`} className="text-white/40 hover:text-white/80">
          ← Visitors
        </Link>
        <p className="mt-6 text-white/50">No activity recorded for this visitor.</p>
      </main>
    );
  }

  // We hide raw engagement pings from the timeline but fold their time onto the
  // preceding pageview so the journey reads cleanly.
  const visible: (JourneyEvent & { engaged?: number })[] = [];
  for (const ev of j.timeline) {
    if (ev.type === "engagement") {
      const last = visible[visible.length - 1];
      if (last) last.engaged = (last.engaged ?? 0) + (ev.duration ?? 0);
      continue;
    }
    visible.push({ ...ev });
  }

  // Group the visible events by session for readable session blocks.
  const sessions: { id: string; events: (JourneyEvent & { engaged?: number })[] }[] = [];
  for (const ev of visible) {
    let s = sessions[sessions.length - 1];
    if (!s || s.id !== ev.session_id) {
      s = { id: ev.session_id, events: [] };
      sessions.push(s);
    }
    s.events.push(ev);
  }

  const facts = [
    { label: "First touch", value: j.firstSource || "Direct" },
    { label: "Last touch", value: j.lastSource || "Direct" },
    { label: "Location", value: [j.city, j.region, j.country ? countryLabel(j.country) : null].filter(Boolean).join(", ") || "Unknown" },
    { label: "Device", value: [j.device, j.os, j.browser].filter(Boolean).join(" · ") || "Unknown" },
    { label: "Sessions", value: j.sessions.toLocaleString() },
    { label: "Pageviews", value: j.pageviews.toLocaleString() },
    { label: "Goals", value: j.goals.toLocaleString() },
    { label: "Revenue", value: j.revenue ? money(j.revenue) : "—" },
  ];

  return (
    <main>
      <header className="mb-6 flex items-center gap-3">
        <Link href={`/site/${site.id}/visitors?period=${periodKey}`} className="text-white/40 transition hover:text-white/80">
          ← Visitors
        </Link>
        <h1 className="text-lg font-bold">
          Visitor <span className="font-mono text-emerald-300">{j.visitor_id.slice(0, 16)}</span>
        </h1>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs text-white/45">{f.label}</div>
            <div className="mt-0.5 truncate text-sm font-semibold" title={f.value}>
              {f.value}
            </div>
          </div>
        ))}
      </section>

      <div className="mb-3 text-xs text-white/40">
        First seen {fmtTime(j.first_seen)} · last seen {fmtTime(j.last_seen)}
      </div>

      <section className="space-y-5">
        {sessions.map((s, si) => (
          <div key={s.id + si} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between text-xs text-white/40">
              <span>Session {sessions.length - si}</span>
              <span>{fmtTime(s.events[0].ts)}</span>
            </div>
            <ol className="relative space-y-3 border-l border-white/10 pl-5">
              {s.events.map((ev, i) => {
                const dest = destOf(ev.meta);
                const engaged = dur(ev.engaged ?? null);
                return (
                  <li key={i} className="relative">
                    <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px]">
                      {ICON[ev.type] ?? "•"}
                    </span>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      {ev.type === "pageview" && <span className="text-white/85">{ev.path || "/"}</span>}
                      {ev.type === "goal" && <span className="font-medium text-amber-300">Goal: {ev.name}</span>}
                      {ev.type === "outbound" && (
                        <span className="text-sky-300">
                          Outbound → {dest ? <a href={dest} className="underline" rel="noreferrer noopener" target="_blank">{ev.name}</a> : ev.name}
                        </span>
                      )}
                      {ev.type === "download" && <span className="text-violet-300">Download: {ev.name}</span>}
                      <span className="text-xs text-white/35">{fmtTime(ev.ts)}</span>
                      {engaged && <span className="text-xs text-white/35">· {engaged} engaged</span>}
                      {ev.scroll != null && ev.scroll > 0 && <span className="text-xs text-white/30">· {ev.scroll}% scrolled</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </section>
    </main>
  );
}
