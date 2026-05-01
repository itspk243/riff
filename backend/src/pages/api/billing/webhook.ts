// POST /api/billing/webhook
// Stripe webhook: subscription created, updated, canceled, invoice paid/failed.
// Updates user plan in Supabase.

import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { stripe } from '../../../lib/stripe';
import { serviceClient } from '../../../lib/supabase';

/**
 * Map a Stripe price ID to our internal plan label.
 *
 * Tier mapping (April 2026):
 *   STRIPE_PRICE_PLUS_MONTHLY ($25) → 'plus'  (agentic features, 600 drafts/mo)
 *   STRIPE_PRICE_PRO_MONTHLY  ($15) → 'pro'   (drafting features, 200 drafts/mo)
 *   STRIPE_PRICE_TEST_MONTHLY ($5)     → 'pro'   (devmode smoke-test, full Pro features)
 *   STRIPE_PRICE_TEAM_MONTHLY ($99)    → 'team'  (legacy, grandfathered)
 *   anything unknown                   → 'pro'   (defensive default + warning log)
 */
// Plan-mapping helper. Throws if STRIPE_PRICE_PLUS_MONTHLY is unset/empty,
// because silently mapping a Plus-priced subscription to 'pro' (the previous
// behavior when the env was blank) would downgrade paying customers without
// any visible signal beyond a console.log. Better to fail the webhook hard
// so Stripe retries and we get a real error in the dashboard.
function planFromPriceId(priceId: string): 'pro' | 'plus' | 'team' {
  const plusPrice = process.env.STRIPE_PRICE_PLUS_MONTHLY;
  const proPrice = process.env.STRIPE_PRICE_PRO_MONTHLY;
  if (!plusPrice || !proPrice) {
    throw new Error(
      `Stripe price env vars missing (PLUS=${!!plusPrice}, PRO=${!!proPrice}). ` +
      `Refusing to map priceId ${priceId} to avoid silently downgrading Plus customers to Pro.`
    );
  }
  if (priceId === plusPrice) return 'plus';
  if (priceId === process.env.STRIPE_PRICE_TEAM_MONTHLY) return 'team';
  if (priceId === proPrice) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_TEST_MONTHLY) return 'pro';
  // Truly unknown priceId — log loudly. Defaults to 'pro' as a safety floor
  // (we'd rather give Pro than break the user), but since we now throw on
  // missing-env above, this only runs for legacy priceIds we forgot to map.
  console.error(`webhook: unknown priceId ${priceId} — defaulting to 'pro'. Add it to env or planFromPriceId.`);
  return 'pro';
}

export const config = { api: { bodyParser: false } };

async function rawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : (c as Buffer));
  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'] as string;
  const buf = await rawBody(req);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (e: any) {
    console.error('webhook signature failed', e.message);
    return res.status(400).send(`Webhook signature error: ${e.message}`);
  }

  const supabase = serviceClient();

  // Idempotency: Stripe retries webhooks aggressively. Without a dedup
  // record we'd re-process the same event.id N times — re-running plan
  // updates, re-firing notification emails, etc. Insert into
  // webhook_events with ON CONFLICT DO NOTHING; if the row already
  // exists we return 200 immediately. The webhook_events table is in
  // schema-webhook-events.sql.
  {
    const { error: dedupeErr } = await supabase
      .from('webhook_events')
      .insert({ id: event.id, type: event.type });
    if (dedupeErr) {
      // Unique-constraint violation == we've seen this event before.
      // Postgres error code 23505. Anything else is a real DB problem
      // and we surface it so Stripe retries.
      if ((dedupeErr as any).code === '23505') {
        console.log(`webhook: skipping already-processed event ${event.id} (${event.type})`);
        return res.status(200).json({ ok: true, deduped: true });
      }
      console.error('webhook: dedupe insert failed', dedupeErr);
      return res.status(500).send('Dedupe write failed');
    }
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const userId = s.client_reference_id;
        if (!userId) break;
        const sub = s.subscription as string;
        const customer = s.customer as string;

        const subObj = await stripe.subscriptions.retrieve(sub);
        const priceId = subObj.items.data[0].price.id;
        const plan = planFromPriceId(priceId);
        console.log(`webhook: checkout.session.completed user=${userId} price=${priceId} → plan=${plan}`);

        // current_period_end may be on the Subscription (older Stripe API
        // versions) or on the SubscriptionItem (newer "dahlia"). Try both.
        const cpe =
          (subObj as any).current_period_end ??
          (subObj.items?.data?.[0] as any)?.current_period_end ??
          null;

        await supabase
          .from('users')
          .update({
            plan,
            stripe_customer_id: customer,
            stripe_subscription_id: sub,
            current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
          })
          .eq('id', userId);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // The embedded webhook payload comes back in the *account's* Stripe
        // API version — newer ("dahlia") versions moved current_period_end
        // from the Subscription onto the SubscriptionItem. Re-retrieve via
        // our pinned-version SDK so we get a consistent shape regardless of
        // what Stripe sent us.
        const eventSub = event.data.object as Stripe.Subscription;
        let sub: Stripe.Subscription;
        try {
          sub = await stripe.subscriptions.retrieve(eventSub.id);
        } catch (e) {
          console.warn(
            `webhook: subscriptions.retrieve(${eventSub.id}) failed; falling back to event payload`,
            e
          );
          sub = eventSub;
        }

        // Resolve user. Preferred: sub.metadata.userId (set by checkout via
        // subscription_data.metadata). Fallback: lookup by stripe_customer_id
        // — covers subs whose metadata got lost across upgrade flows or
        // manual Stripe portal edits.
        let userId = (sub.metadata?.userId as string | undefined) || undefined;
        if (!userId && typeof sub.customer === 'string') {
          const { data: byCustomer } = await supabase
            .from('users')
            .select('id')
            .eq('stripe_customer_id', sub.customer)
            .maybeSingle();
          if (byCustomer) {
            userId = byCustomer.id;
            console.log(
              `webhook: ${event.type} resolved user via stripe_customer_id=${sub.customer} → user=${userId}`
            );
          }
        }
        if (!userId) {
          console.warn(
            `webhook: ${event.type} could not resolve user (sub=${sub.id} customer=${sub.customer})`
          );
          break;
        }

        const newPlan: 'free' | 'pro' | 'plus' | 'team' =
          sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due'
            ? planFromPriceId(sub.items.data[0].price.id)
            : 'free';
        console.log(
          `webhook: subscription.${event.type.split('.').pop()} user=${userId} status=${sub.status} → plan=${newPlan}`
        );

        // current_period_end can live on the Subscription (older API versions)
        // or on the SubscriptionItem (newer "dahlia"). Read whichever has it.
        const cpe =
          (sub as any).current_period_end ??
          (sub.items?.data?.[0] as any)?.current_period_end ??
          null;

        await supabase
          .from('users')
          .update({
            plan: newPlan,
            stripe_subscription_id: sub.status === 'canceled' ? null : sub.id,
            current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
          })
          .eq('id', userId);
        break;
      }
      default:
        // ignore other event types
        break;
    }
  } catch (e) {
    console.error('webhook handler failed', e);
    return res.status(500).end();
  }

  return res.status(200).json({ received: true });
}
