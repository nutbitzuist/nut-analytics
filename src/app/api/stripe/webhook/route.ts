import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { db, getSiteByDomain, listSites } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Revenue attribution webhook.
 *
 * Point a Stripe webhook at  POST /api/stripe/webhook  with the event
 * `checkout.session.completed` (and optionally `invoice.paid`).
 *
 * To attribute revenue to a visitor, pass the `nut_vid` cookie value when
 * creating the Checkout Session:
 *
 *   stripe.checkout.sessions.create({
 *     ...,
 *     metadata: { nut_visitor_id: req.cookies.nut_vid, nut_site: "yourdomain.com" },
 *   })
 *
 * `nut_site` may be the site domain or site id; if omitted and you track a
 * single site, payments fall back to that site.
 */
export async function POST(req: NextRequest) {
  const payload = await req.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;
  if (secret) {
    const sig = req.headers.get("stripe-signature");
    if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });
    try {
      event = await Stripe.webhooks.constructEventAsync(payload, sig, secret);
    } catch {
      return NextResponse.json({ error: "invalid signature" }, { status: 400 });
    }
  } else {
    // Dev mode: accept unsigned payloads (e.g. `stripe trigger` against localhost).
    try {
      event = JSON.parse(payload) as Stripe.Event;
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    record(event.id, {
      visitorId: s.metadata?.nut_visitor_id ?? s.client_reference_id ?? null,
      siteRef: s.metadata?.nut_site ?? null,
      customerId: typeof s.customer === "string" ? s.customer : null,
      email: s.customer_details?.email ?? null,
      amount: s.amount_total ?? 0,
      currency: s.currency ?? "usd",
      description: "Checkout",
    });
  } else if (event.type === "invoice.paid") {
    const inv = event.data.object as Stripe.Invoice;
    record(event.id, {
      visitorId: inv.metadata?.nut_visitor_id ?? null,
      siteRef: inv.metadata?.nut_site ?? null,
      customerId: typeof inv.customer === "string" ? inv.customer : null,
      email: inv.customer_email ?? null,
      amount: inv.amount_paid ?? 0,
      currency: inv.currency ?? "usd",
      description: "Invoice",
    });
  }

  return NextResponse.json({ received: true });
}

function record(
  stripeEventId: string,
  p: {
    visitorId: string | null;
    siteRef: string | null;
    customerId: string | null;
    email: string | null;
    amount: number;
    currency: string;
    description: string;
  }
) {
  if (p.amount <= 0) return;

  let siteId: string | null = null;
  if (p.siteRef) {
    const byDomain = getSiteByDomain(p.siteRef);
    siteId = byDomain?.id ?? p.siteRef;
  } else {
    const sites = listSites();
    if (sites.length === 1) siteId = sites[0].id;
  }
  if (!siteId) return;

  // If the visitor id wasn't passed through Stripe metadata, try matching a
  // previous payment from the same customer.
  let visitorId = p.visitorId;
  if (!visitorId && p.customerId) {
    const prev = db()
      .prepare("SELECT visitor_id FROM payments WHERE customer_id = ? AND visitor_id IS NOT NULL LIMIT 1")
      .get(p.customerId) as { visitor_id: string } | undefined;
    visitorId = prev?.visitor_id ?? null;
  }

  db()
    .prepare(
      `INSERT OR IGNORE INTO payments
        (site_id, visitor_id, stripe_event_id, customer_id, email, description, amount, currency, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(siteId, visitorId, stripeEventId, p.customerId, p.email, p.description, p.amount, p.currency, Date.now());
}
