import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createSite, listSites } from "@/lib/db";
import { eventCount, realtimeVisitors } from "@/lib/queries";

export const dynamic = "force-dynamic";

async function addSite(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  const domain = String(formData.get("domain") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!name || !domain) return;
  createSite(name, domain);
  revalidatePath("/");
}

export default function Home() {
  const sites = listSites();

  return (
    <main>
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🥜</span>
          <h1 className="text-2xl font-bold tracking-tight">Nut Analytics</h1>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/50 transition hover:text-white">
            Sign out
          </button>
        </form>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {sites.map((site) => {
          const live = realtimeVisitors(site.id);
          return (
            <Link
              key={site.id}
              href={`/site/${site.id}`}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-emerald-400/40 hover:bg-white/[0.06]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{site.name}</div>
                  <div className="text-sm text-white/50">{site.domain}</div>
                </div>
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  {live} online
                </div>
              </div>
              <div className="mt-3 text-xs text-white/40">
                {eventCount(site.id).toLocaleString()} events · site id <code>{site.id}</code>
              </div>
            </Link>
          );
        })}
      </div>

      <section className="mt-10 max-w-md rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="mb-3 font-semibold">{sites.length ? "Add another site" : "Add your first site"}</h2>
        <form action={addSite} className="flex flex-col gap-3">
          <input
            name="name"
            placeholder="Site name (e.g. My SaaS)"
            required
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-400/60"
          />
          <input
            name="domain"
            placeholder="Domain (e.g. mysaas.com)"
            required
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-400/60"
          />
          <button
            type="submit"
            className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Create site
          </button>
        </form>
      </section>
    </main>
  );
}
