import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getSite } from "@/lib/db";
import { publicOrigin } from "@/lib/auth";
import {
  breakdown,
  eventCount,
  goals,
  PERIODS,
  realtimeVisitors,
  resolvePeriod,
  revenue,
  timeseries,
  totals,
  type Filters,
  type PeriodKey,
} from "@/lib/queries";
import Chart from "@/components/Chart";
import Breakdown from "@/components/Breakdown";

export const dynamic = "force-dynamic";

const FILTER_KEYS = ["path", "source", "country", "device", "browser", "os"] as const;

function fmtDuration(sec: number) {
  if (!sec || sec < 1) return "0s";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export default async function SiteDashboard({
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

  const periodKey = (PERIODS.some((p) => p.key === sp.period) ? sp.period : "7d") as PeriodKey;
  const { from, to, bucketMs } = resolvePeriod(periodKey);

  const filters: Filters = {};
  for (const k of FILTER_KEYS) if (sp[k]) filters[k] = sp[k];

  const baseParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (v) baseParams[k] = v;
  const basePath = `/site/${site.id}`;

  const hasEvents = eventCount(site.id) > 0;
  const t = totals(site.id, from, to, filters);
  const series = timeseries(site.id, from, to, bucketMs, filters);
  const goalRows = goals(site.id, from, to, filters);
  const rev = revenue(site.id, from, to, filters);
  const live = realtimeVisitors(site.id);

  const cards = [
    { label: "Unique visitors", value: t.visitors.toLocaleString() },
    { label: "Pageviews", value: t.pageviews.toLocaleString() },
    { label: "Sessions", value: t.sessions.toLocaleString() },
    { label: "Bounce rate", value: `${Math.round(t.bounceRate * 100)}%` },
    { label: "Avg. session", value: fmtDuration(t.avgDuration) },
    { label: "Revenue", value: money(rev.amount) },
  ];

  return (
    <main>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/60 transition hover:text-white"
            title="All websites"
          >
            🥜 All sites
          </Link>
          <div>
            <h1 className="text-xl font-bold">{site.name}</h1>
            <div className="flex items-center gap-2 text-sm text-white/50">
              {site.domain}
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {live} online now
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
        <nav className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 text-sm">
          {PERIODS.map((p) => {
            const params = new URLSearchParams(baseParams);
            params.set("period", p.key);
            return (
              <Link
                key={p.key}
                href={`${basePath}?${params}`}
                className={`rounded-md px-3 py-1 transition ${
                  periodKey === p.key ? "bg-emerald-500 font-semibold text-black" : "text-white/60 hover:text-white"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href={`/site/${site.id}/settings`}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/60 transition hover:text-white"
          title="Site settings"
        >
          ⚙ Settings
        </Link>
        <a
          href={`/api/v1/export?kind=summary&period=${periodKey}`}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/60 transition hover:text-emerald-300"
          title="Download current view as CSV (uses your API key if you are logged into the API)"
        >
          ⬇ Export CSV
        </a>
        </div>
      </header>

      {Object.keys(filters).length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-white/40">Filters:</span>
          {(Object.entries(filters) as [string, string][]).map(([k, v]) => {
            const params = new URLSearchParams(baseParams);
            params.delete(k);
            return (
              <Link
                key={k}
                href={`${basePath}?${params}`}
                className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-0.5 text-emerald-300 transition hover:bg-emerald-400/20"
              >
                {k}: {v} ✕
              </Link>
            );
          })}
        </div>
      )}

      {!hasEvents && <SetupSnippet siteId={site.id} base={await getBase()} />}

      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs text-white/50">{c.label}</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{c.value}</div>
          </div>
        ))}
      </section>

      <section className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <Chart data={series} hourly={bucketMs < 86_400_000} />
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Breakdown title="Top pages" rows={breakdown(site.id, from, to, filters, "path")} filterKey="path" activeValue={filters.path} baseParams={baseParams} basePath={basePath} />
        <Breakdown title="Sources" rows={breakdown(site.id, from, to, filters, "referrer_source")} filterKey="source" activeValue={filters.source} baseParams={baseParams} basePath={basePath} />
        <Breakdown title="Countries" rows={breakdown(site.id, from, to, filters, "country")} filterKey="country" activeValue={filters.country} baseParams={baseParams} basePath={basePath} />
        <Breakdown title="Devices" rows={breakdown(site.id, from, to, filters, "device")} filterKey="device" activeValue={filters.device} baseParams={baseParams} basePath={basePath} />
        <Breakdown title="Browsers" rows={breakdown(site.id, from, to, filters, "browser")} filterKey="browser" activeValue={filters.browser} baseParams={baseParams} basePath={basePath} />
        <Breakdown title="Operating systems" rows={breakdown(site.id, from, to, filters, "os")} filterKey="os" activeValue={filters.os} baseParams={baseParams} basePath={basePath} />
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="mb-3 text-sm font-semibold text-white/80">Goals & conversions</h3>
          {goalRows.length === 0 ? (
            <p className="py-4 text-sm text-white/40">
              No goals tracked yet. Fire one from your site with{" "}
              <code className="rounded bg-black/40 px-1.5 py-0.5 text-emerald-300">
                window.nut(&apos;signup&apos;)
              </code>{" "}
              or add <code className="rounded bg-black/40 px-1.5 py-0.5 text-emerald-300">data-nut-goal=&quot;signup&quot;</code> to any button.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-white/40">
                  <th className="pb-2 font-normal">Goal</th>
                  <th className="pb-2 text-right font-normal">Events</th>
                  <th className="pb-2 text-right font-normal">Visitors</th>
                  <th className="pb-2 text-right font-normal">Conv. rate</th>
                </tr>
              </thead>
              <tbody>
                {goalRows.map((g) => (
                  <tr key={g.name} className="border-t border-white/5">
                    <td className="py-2 font-medium text-emerald-300">{g.name}</td>
                    <td className="py-2 text-right tabular-nums">{g.events.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{g.conversions.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{(g.rate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="mb-3 text-sm font-semibold text-white/80">Revenue by channel</h3>
          {rev.payments === 0 ? (
            <p className="py-4 text-sm text-white/40">
              No payments yet. Point a Stripe webhook at <code className="rounded bg-black/40 px-1.5 py-0.5 text-emerald-300">/api/stripe/webhook</code> and pass the{" "}
              <code className="rounded bg-black/40 px-1.5 py-0.5 text-emerald-300">nut_vid</code> cookie as checkout metadata — see the README.
            </p>
          ) : (
            <>
              <div className="mb-3 text-sm text-white/60">
                {money(rev.amount)} from {rev.payments} payment{rev.payments === 1 ? "" : "s"}
              </div>
              <ul className="space-y-1 text-sm">
                {rev.bySource.map((r) => (
                  <li key={r.value} className="flex justify-between border-t border-white/5 py-2">
                    <span>{r.value}</span>
                    <span className="tabular-nums text-emerald-300">{money(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

async function getBase(): Promise<string> {
  const h = await headers();
  return publicOrigin(h as any); // publicOrigin accepts Headers; the cast is harmless
}

function SetupSnippet({ siteId, base }: { siteId: string; base: string }) {
  const snippet = `<script defer src="${base}/js/script.js" data-site="${siteId}"></script>`;
  return (
    <section className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-5">
      <h3 className="font-semibold text-emerald-300">Waiting for your first pageview…</h3>
      <p className="mt-1 text-sm text-white/60">
        Add this snippet to the <code>&lt;head&gt;</code> of your site:
      </p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-black/50 p-3 text-xs text-emerald-200">{snippet}</pre>
    </section>
  );
}
