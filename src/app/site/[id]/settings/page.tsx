import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addGoal, deleteSite, forgetVisitor, getSite, listGoals, regenerateApiKey, removeGoal } from "@/lib/db";
import { publicOrigin } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function getBase(): Promise<string> {
  const h = await headers();
  return publicOrigin(h as any);
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-black/40 px-1.5 py-0.5 text-emerald-300">{children}</code>;
}

function Block({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-lg bg-black/50 p-3 text-xs leading-relaxed text-emerald-200">
      {children}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function Settings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = getSite(id);
  if (!site) notFound();
  const goals = listGoals(site.id);
  const base = await getBase();
  const settingsPath = `/site/${site.id}/settings`;

  async function addGoalAction(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .slice(0, 64);
    if (name) addGoal(id, name);
    revalidatePath(settingsPath);
  }

  async function removeGoalAction(formData: FormData) {
    "use server";
    removeGoal(id, String(formData.get("name")));
    revalidatePath(settingsPath);
  }

  async function regenKeyAction() {
    "use server";
    regenerateApiKey(id);
    revalidatePath(settingsPath);
  }

  async function deleteSiteAction(formData: FormData) {
    "use server";
    if (String(formData.get("confirm")) === getSite(id)?.domain) {
      deleteSite(id);
      redirect("/");
    }
  }

  async function forgetVisitorAction(formData: FormData) {
    "use server";
    const vid = String(formData.get("visitor_id") || "").trim().slice(0, 64);
    if (vid) {
      forgetVisitor(id, vid);
    }
    revalidatePath(settingsPath);
  }

  return (
    <main className="space-y-4">
      <header className="mb-6 flex items-center gap-3">
        <Link href={`/site/${site.id}`} className="text-white/40 transition hover:text-white/80">
          ← Dashboard
        </Link>
        <h1 className="text-xl font-bold">
          {site.name} <span className="font-normal text-white/40">settings</span>
        </h1>
      </header>

      <Section title="Tracking snippet">
        <p className="text-sm text-white/60">
          Add to the <Code>&lt;head&gt;</Code> of {site.domain}. Pageviews, sessions, sources, UTM and devices are
          tracked automatically, including SPA route changes.
        </p>
        <Block>{`<script defer src="${base}/js/script.js" data-site="${site.id}"></script>`}</Block>
      </Section>

      <Section title="Goals & custom events">
        <p className="text-sm text-white/60">
          Track any conversion — CTA clicks, form submits, lead capture, newsletter signups — from the browser,
          declaratively, or from your backend via the events API below. Registering a goal here pins it to the
          dashboard even before its first conversion.
        </p>
        <Block>{`// From code, anywhere on your site:
window.nut('cta_click');
window.nut('lead_capture', { source: 'pricing-page' });

<!-- Declaratively — clicks: -->
<button data-nut-goal="start_trial">Start free trial</button>

<!-- Declaratively — form submits: -->
<form data-nut-goal="newsletter_signup"> ... </form>`}</Block>
        <ul className="mt-3 space-y-1">
          {goals.length === 0 && <li className="text-sm text-white/30">No registered goals yet.</li>}
          {goals.map((g) => (
            <li
              key={g.name}
              className="flex items-center justify-between rounded-md border border-white/5 px-3 py-1.5 text-sm"
            >
              <span className="font-medium text-emerald-300">{g.name}</span>
              <form action={removeGoalAction}>
                <input type="hidden" name="name" value={g.name} />
                <button className="text-white/40 transition hover:text-red-400">remove</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addGoalAction} className="mt-3 flex gap-2">
          <input
            name="name"
            placeholder="e.g. signup, start_trial, purchase"
            required
            className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-400/60"
          />
          <button className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400">
            Add goal
          </button>
        </form>
      </Section>

      <Section title="API">
        <p className="text-sm text-white/60">Your secret API key (keep it server-side):</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg bg-black/50 p-3 text-xs text-emerald-200">
            {site.api_key}
          </code>
          <form action={regenKeyAction}>
            <button className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/70 transition hover:border-red-400/50 hover:text-red-300">
              Regenerate
            </button>
          </form>
        </div>

        <h3 className="mt-5 text-sm font-semibold text-white/80">Read stats</h3>
        <Block>{`curl ${base}/api/v1/stats?period=7d \\
  -H "Authorization: Bearer ${site.api_key}"`}</Block>
        <p className="mt-1 text-xs text-white/40">
          Returns totals, timeseries, pages, sources, countries, devices, goals and revenue as JSON. Periods:
          today, 7d, 30d, 90d, all.
        </p>

        <h3 className="mt-5 text-sm font-semibold text-white/80">Track server-side goals</h3>
        <Block>{`curl -X POST ${base}/api/v1/events \\
  -H "Authorization: Bearer ${site.api_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "signup", "visitor_id": "<nut_vid cookie>", "metadata": {"plan": "pro"}}'`}</Block>
        <p className="mt-1 text-xs text-white/40">
          Pass the visitor&apos;s <Code>nut_vid</Code> cookie when you have it so the goal inherits their channel,
          country and device.
        </p>
      </Section>

      <Section title="Stripe revenue attribution">
        <ol className="list-decimal space-y-3 pl-5 text-sm text-white/60">
          <li>
            In the Stripe dashboard, add a webhook endpoint pointing to <Code>{base}/api/stripe/webhook</Code> with
            events <Code>checkout.session.completed</Code> and <Code>invoice.paid</Code>, then set the signing
            secret as <Code>STRIPE_WEBHOOK_SECRET</Code> in this app&apos;s environment.
          </li>
          <li>
            <strong className="text-white/80">Stripe Payment Links:</strong> nothing else to do — the tracking
            script automatically appends the visitor id to any <Code>buy.stripe.com</Code> link on your site as{" "}
            <Code>client_reference_id</Code>.
          </li>
          <li>
            <strong className="text-white/80">Stripe Checkout (server-created sessions):</strong> pass the cookie
            through metadata:
            <Block>{`await stripe.checkout.sessions.create({
  // ...line items...
  metadata: {
    nut_visitor_id: req.cookies["nut_vid"],
    nut_site: "${site.domain}",
  },
});`}</Block>
          </li>
        </ol>
        <p className="mt-3 text-sm text-white/60">
          Payments then show under <em>Revenue by channel</em>, attributed to the visitor&apos;s first-touch source.
        </p>
      </Section>

      <Section title="Reports — daily summary & weekly growth memo">
        <p className="text-sm text-white/60">
          The server can send a <strong className="text-white/80">daily summary</strong> (visitors, leads, revenue
          per site) and a <strong className="text-white/80">Monday growth memo</strong> (what works, what fails,
          best campaign, what to fix) to Telegram and/or email, with optional AI insights. Enable by setting
          environment variables on the host:
        </p>
        <Block>{`TELEGRAM_BOT_TOKEN=...   # create a bot with @BotFather
TELEGRAM_CHAT_ID=...     # your chat id (message @userinfobot)

RESEND_API_KEY=...       # for email delivery via resend.com
REPORT_EMAIL_TO=you@example.com

ANTHROPIC_API_KEY=...    # optional: adds an AI growth memo (Claude)
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022   # or any model your key can access
REPORT_HOUR_UTC=1        # send hour, default 1 UTC = 08:00 Bangkok`}</Block>
        <p className="mt-2 text-sm text-white/60">
          Preview anytime: <Code>{base}/api/reports/run?kind=weekly</Code> (add <Code>&amp;send=1</Code> to deliver
          immediately).
        </p>
      </Section>

      <Section title="Login & password">
        <p className="text-sm text-white/60">
          The dashboard uses email + password login at <Code>/login</Code>. Both are environment variables on the
          host (Railway → service → Variables): <Code>AUTH_EMAIL</Code> and <Code>DASHBOARD_PASSWORD</Code> —
          change either there and it applies on the next restart. Sessions last 30 days; use Sign out on the home
          page to end one early. Tracking, webhooks and the API are not affected.
        </p>
      </Section>

      <Section title="Privacy tools — forget a visitor">
        <p className="text-sm text-white/60">
          Remove all events for a specific <Code>nut_vid</Code> (from the cookie). Revenue records are retained
          but unlinked from the visitor (they become "Unattributed"). Use this for "right to be forgotten" requests.
        </p>
        <form action={forgetVisitorAction} className="mt-3 flex gap-2">
          <input
            name="visitor_id"
            placeholder="nut_vid value (e.g. 123e4567-e89b-12d3-a456-426614174000)"
            className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-400/60"
            required
          />
          <button className="rounded-lg border border-amber-400/40 px-4 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-400/10">
            Forget this visitor
          </button>
        </form>
      </Section>

      <Section title="Danger zone">
        <p className="text-sm text-white/60">
          Deleting this site permanently removes all its events, goals and payments. Type{" "}
          <Code>{site.domain}</Code> to confirm.
        </p>
        <form action={deleteSiteAction} className="mt-3 flex gap-2">
          <input
            name="confirm"
            placeholder={site.domain}
            className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-red-400/60"
          />
          <button className="rounded-lg border border-red-400/40 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-400/10">
            Delete site
          </button>
        </form>
      </Section>
    </main>
  );
}
