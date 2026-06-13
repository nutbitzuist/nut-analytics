import Link from "next/link";
import { notFound } from "next/navigation";
import { getSite } from "@/lib/db";
import { PERIODS, resolvePeriod, visitorList, type PeriodKey } from "@/lib/queries";
import { countryLabel } from "@/lib/parse";

export const dynamic = "force-dynamic";

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function when(ts: number) {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

const PAGE_SIZE = 50;

export default async function Visitors({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const site = getSite(id);
  if (!site) notFound();

  const periodKey = (PERIODS.some((p) => p.key === sp.period) ? sp.period : "30d") as PeriodKey;
  const { from, to } = resolvePeriod(periodKey);
  const page = Math.max(0, parseInt(sp.page ?? "0", 10) || 0);
  const rows = visitorList(site.id, from, to, PAGE_SIZE, page * PAGE_SIZE);

  const qs = (overrides: Record<string, string>) => {
    const p = new URLSearchParams();
    p.set("period", periodKey);
    for (const [k, v] of Object.entries(overrides)) p.set(k, v);
    return p.toString();
  };

  return (
    <main>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/site/${site.id}?period=${periodKey}`} className="text-white/40 transition hover:text-white/80">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold">
            {site.name} <span className="font-normal text-white/40">visitors</span>
          </h1>
        </div>
        <nav className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/site/${site.id}/visitors?period=${p.key}`}
              className={`rounded-md px-3 py-1 transition ${
                periodKey === p.key ? "bg-emerald-500 font-semibold text-black" : "text-white/60 hover:text-white"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-white/40">
              <th className="px-4 py-3 font-normal">Visitor</th>
              <th className="px-4 py-3 font-normal">Source</th>
              <th className="px-4 py-3 font-normal">Location</th>
              <th className="px-4 py-3 font-normal">Device</th>
              <th className="px-4 py-3 text-right font-normal">Pageviews</th>
              <th className="px-4 py-3 text-right font-normal">Sessions</th>
              <th className="px-4 py-3 text-right font-normal">Goals</th>
              <th className="px-4 py-3 text-right font-normal">Revenue</th>
              <th className="px-4 py-3 text-right font-normal">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-white/30">
                  No visitors in this period yet.
                </td>
              </tr>
            )}
            {rows.map((v) => (
              <tr key={v.visitor_id} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                <td className="px-4 py-3">
                  <Link
                    href={`/site/${site.id}/visitors/${encodeURIComponent(v.visitor_id)}?period=${periodKey}`}
                    className="font-mono text-emerald-300 hover:underline"
                  >
                    {v.visitor_id.slice(0, 12)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-white/70">{v.source || "Direct"}</td>
                <td className="px-4 py-3 text-white/60">{v.country ? countryLabel(v.country) : "—"}</td>
                <td className="px-4 py-3 text-white/60">{v.device || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{v.pageviews.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{v.sessions.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{v.goals ? v.goals.toLocaleString() : "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{v.revenue ? <span className="text-emerald-300">{money(v.revenue)}</span> : "—"}</td>
                <td className="px-4 py-3 text-right text-white/40">{when(v.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-white/40">
          Showing {rows.length ? page * PAGE_SIZE + 1 : 0}–{page * PAGE_SIZE + rows.length}
        </span>
        <div className="flex gap-2">
          {page > 0 && (
            <Link
              href={`/site/${site.id}/visitors?${qs({ page: String(page - 1) })}`}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-white/70 transition hover:text-white"
            >
              ← Prev
            </Link>
          )}
          {rows.length === PAGE_SIZE && (
            <Link
              href={`/site/${site.id}/visitors?${qs({ page: String(page + 1) })}`}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-white/70 transition hover:text-white"
            >
              Next →
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
