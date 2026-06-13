import Link from "next/link";
import { notFound } from "next/navigation";
import { getSite } from "@/lib/db";
import { PERIODS, type PeriodKey } from "@/lib/queries";
import AskPanel from "@/components/AskPanel";

export const dynamic = "force-dynamic";

export default async function Ask({
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
  const configured = !!process.env.ANTHROPIC_API_KEY;

  return (
    <main>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/site/${site.id}?period=${periodKey}`} className="text-white/40 transition hover:text-white/80">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold">
            {site.name} <span className="font-normal text-white/40">— Ask AI</span>
          </h1>
        </div>
        <nav className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/site/${site.id}/ask?period=${p.key}`}
              className={`rounded-md px-3 py-1 transition ${
                periodKey === p.key ? "bg-emerald-500 font-semibold text-black" : "text-white/60 hover:text-white"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>

      {!configured && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200/90">
          The AI analyst needs an Anthropic API key. Set <code className="rounded bg-black/40 px-1.5 py-0.5">ANTHROPIC_API_KEY</code>{" "}
          (and optionally <code className="rounded bg-black/40 px-1.5 py-0.5">ANTHROPIC_MODEL</code>) in this app&apos;s
          environment on Railway, then restart. You can still type below — it will tell you it&apos;s not configured.
        </div>
      )}

      <p className="mb-3 text-sm text-white/50">
        Answers are grounded in this site&apos;s data for the selected period ({PERIODS.find((p) => p.key === periodKey)?.label}).
      </p>
      <AskPanel siteId={site.id} period={periodKey} />
    </main>
  );
}
