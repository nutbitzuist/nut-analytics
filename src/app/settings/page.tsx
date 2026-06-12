import Link from "next/link";
import { headers } from "next/headers";
import { listSites } from "@/lib/db";
import { realtimeVisitors, eventCount } from "@/lib/queries";
import { publicOrigin } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function getBase(): Promise<string> {
  const h = await headers();
  return publicOrigin(h as any);
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-black/40 px-1.5 py-0.5 text-emerald-300">{children}</code>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function GlobalSettings() {
  const sites = listSites();
  const base = await getBase();

  return (
    <main className="space-y-6">
      <header className="mb-6 flex items-center gap-3">
        <Link href="/" className="text-white/40 transition hover:text-white/80">
          ← Dashboard
        </Link>
        <h1 className="text-xl font-bold">Global Settings &amp; Management</h1>
      </header>

      <p className="text-sm text-white/60">
        Central control for all your sites/projects. This is the <strong>global level</strong> view for managing many things at once (as opposed to per-site settings).
      </p>

      {/* All Sites Overview */}
      <Section title="All Sites Overview">
        <p className="mb-4 text-sm text-white/60">
          Quick view of every tracked project. Click a site for its dashboard or its individual settings.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {sites.length === 0 && <p className="text-white/40">No sites yet. Create one from the main dashboard.</p>}
          {sites.map((site) => {
            const live = realtimeVisitors(site.id);
            const events = eventCount(site.id);
            return (
              <div key={site.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold">{site.name}</div>
                    <div className="text-sm text-white/50">{site.domain}</div>
                  </div>
                  <div className="text-right text-xs text-white/60">
                    <div className="flex items-center gap-1 justify-end">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                      </span>
                      {live} online
                    </div>
                    <div>{events.toLocaleString()} events</div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2 text-xs">
                  <Link href={`/site/${site.id}`} className="rounded bg-white/5 px-2 py-1 hover:bg-white/10">Dashboard</Link>
                  <Link href={`/site/${site.id}/settings`} className="rounded bg-white/5 px-2 py-1 hover:bg-white/10">Per-site Settings</Link>
                </div>
                <div className="mt-2 text-[10px] text-white/40">Site ID: <code>{site.id}</code></div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-white/40">Tip for your AI agent: Use <code>GET /api/v1/sites</code> (owner Basic auth) to get this list programmatically, then act globally or switch to per-site keys.</p>
      </Section>

      {/* Global Reports & AI Insights */}
      <Section title="Global Reports &amp; AI Insights">
        <p className="mb-3 text-sm text-white/60">
          Run daily or weekly reports across <strong>all sites</strong> with AI-generated growth memos (requires ANTHROPIC_API_KEY and delivery channels configured).
        </p>
        <div className="space-y-3 text-sm">
          <div>
            <strong>Preview (no send):</strong>
            <div className="mt-1 flex gap-2">
              <a href="/api/v1/reports?kind=daily" className="rounded bg-emerald-500/20 px-3 py-1 text-emerald-300 hover:bg-emerald-500/30" target="_blank">Daily Report Preview</a>
              <a href="/api/v1/reports?kind=weekly" className="rounded bg-emerald-500/20 px-3 py-1 text-emerald-300 hover:bg-emerald-500/30" target="_blank">Weekly Report Preview</a>
            </div>
          </div>
          <div>
            <strong>Send now (delivers via your configured channels):</strong>
            <div className="mt-1 flex gap-2">
              <a href="/api/v1/reports?kind=daily&amp;send=1" className="rounded bg-emerald-500 px-3 py-1 text-black hover:bg-emerald-400" target="_blank">Send Daily Report</a>
              <a href="/api/v1/reports?kind=weekly&amp;send=1" className="rounded bg-emerald-500 px-3 py-1 text-black hover:bg-emerald-400" target="_blank">Send Weekly Report</a>
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs text-white/40">
          Your AI agent can call these same endpoints (with owner Basic auth) to run reports autonomously and summarize the AI insights for you.
        </p>
        <div className="mt-4 rounded bg-black/30 p-3 text-xs">
          <strong>Configuration (server env vars – set in Railway):</strong><br />
          TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID<br />
          RESEND_API_KEY + REPORT_EMAIL_TO<br />
          ANTHROPIC_API_KEY (for AI memos)<br />
          REPORT_HOUR_UTC (default 1)
        </div>
      </Section>

      {/* Agent Integration Hub */}
      <Section title="Agent Integration Hub (Global)">
        <p className="mb-3 text-sm text-white/60">
          Everything your personal AI agent needs to manage this instance at both <strong>global</strong> and per-site levels without you doing manual work.
        </p>
        <ul className="space-y-2 text-sm">
          <li><a href="/api/v1/openapi" target="_blank" className="text-emerald-400 hover:underline">Live OpenAPI Spec</a> — For auto-generating tool/function schemas.</li>
          <li><a href="/api/mcp" target="_blank" className="text-emerald-400 hover:underline">MCP Endpoint (POST)</a> — Structured tool server for modern agents (tools/list + tools/call).</li>
          <li><Link href="/docs/AGENT_MANUAL.md" className="text-emerald-400 hover:underline">Full AGENT_MANUAL.md</Link> — The complete self-contained manual to paste into any agent.</li>
          <li><Link href="/docs/agent-function-calling-examples.md" className="text-emerald-400 hover:underline">Ready-made Function Calling Schemas</Link></li>
          <li><Link href="/docs/AGENT_SETUP_FOR_HUMAN.md" className="text-emerald-400 hover:underline">Setup Guide</Link> (for you, the owner).</li>
        </ul>
        <p className="mt-4 text-xs text-white/40">
          Give your agent the URL + a credential + the AGENT_MANUAL.md. It can now create sites, run reports, analyze data, handle privacy, manage goals globally, etc.
        </p>
      </Section>

      {/* Quick Global Actions */}
      <Section title="Quick Global Actions">
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/" className="rounded bg-white/10 px-4 py-2 hover:bg-white/20">Create New Site</Link>
          <a href="/api/v1/sites" target="_blank" className="rounded bg-white/10 px-4 py-2 hover:bg-white/20">List All Sites (API)</a>
          <a href="/api/v1/reports?kind=weekly" target="_blank" className="rounded bg-white/10 px-4 py-2 hover:bg-white/20">Latest Weekly Report Preview</a>
        </div>
        <p className="mt-3 text-xs text-white/40">Your AI agent has full access to these (and more) via the documented APIs and MCP.</p>
      </Section>

      <p className="text-center text-xs text-white/30">
        Global settings page. Per-site detailed settings are still available at each site&apos;s own Settings page for isolation.
      </p>
    </main>
  );
}
