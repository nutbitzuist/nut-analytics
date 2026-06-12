import Link from "next/link";
import type { BreakdownRow } from "@/lib/queries";

/**
 * A breakdown card (top pages, sources, countries...). Rows are links that
 * toggle the corresponding filter in the URL, DataFast/Plausible style.
 */
export default function Breakdown({
  title,
  rows,
  filterKey,
  activeValue,
  baseParams,
  basePath,
}: {
  title: string;
  rows: BreakdownRow[];
  filterKey: string;
  activeValue?: string;
  baseParams: Record<string, string>;
  basePath: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.visitors));

  const hrefFor = (value: string) => {
    const params = new URLSearchParams(baseParams);
    if (activeValue === value) params.delete(filterKey);
    else params.set(filterKey, value);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80">{title}</h3>
        <span className="text-xs text-white/40">Visitors</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/30">No data yet</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.value}>
              <Link
                href={hrefFor(r.value)}
                className={`relative flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition hover:bg-white/5 ${
                  activeValue === r.value ? "ring-1 ring-emerald-400/50" : ""
                }`}
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-md bg-emerald-400/10"
                  style={{ width: `${(r.visitors / max) * 100}%` }}
                />
                <span className="relative z-10 truncate">{r.value}</span>
                <span className="relative z-10 tabular-nums text-white/60">{r.visitors.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
