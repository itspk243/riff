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
 *   STRIPE_PRICE_PLUS_MONTHLY ($19.99) → 'plus'  (agentic features)
 *   STRIPE_PRICE_PRO_MONTHLY  ($14.99) → 'pro'   (drafting features)
 *   STRIPE_PRICE_TEST_MONTHLY ($5)     → 'pro'   (devmode smoke-test, full Pro features)
 *   STRIPE_PRICE_TEAM_MONTHLY ($99)    → 'team'  (legacy, grandfathered)
 *   anything unknown                   → 'pro'   (defensive default + warning log)
 */
function planFromPriceId(priceId: string): 'pro' | 'plus' | 'team' {
  if (priceId === process.env.STRIPE_PRICE_PLUS_MONTHLY) return 'plus';
  if (priceId === process.env.STRIPE_PRICE_TEAM_MONTHLY) return 'team';
  // Pro ($14.99), Test ($5), grandfathered $39 Pro all map to plan='pro'.
  if (
    priceId !== process.env.STRIPE_PRICE_PRO_MONTHLY &&
    priceId !== process.env.STRIPE_PRICE_TEST_MONTHLY
  ) {
    console.log(`webhook: unknown priceId ${priceId} — defaulting to 'pro'`);
  }
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

        await supabase
          .from('users')
          .update({
            plan,
            stripe_customer_id: customer,
            stripe_subscription_id: sub,
            current_period_end: new Date(subObj.current_period_end * 1000).toISOString(),
          })
          .eq('id', userId);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;
        const newPlan: 'free' | 'pro' | 'plus' | 'team' =
          sub.status === 'active' || sub.status === 'trialing'
            ? planFromPriceId(sub.items.data[0].price.id)
            : 'free';
        console.log(`webhook: subscription.${event.type.split('.').pop()} user=${userId} status=${sub.status} → plan=${newPlan}`);
        await supabase
          .from('users')
          .update({
            plan: newPlan,
            stripe_subscription_id: sub.status === 'canceled' ? null : sub.id,
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
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
