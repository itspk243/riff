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
 * IMPORTANT: The $5 Test tier (STRIPE_PRICE_TEST_MONTHLY) intentionally maps to
 * 'pro' so anyone who pays $5 gets identical feature access to the $39 Pro plan
 * — unlimited generations, all 3 variants, billing portal access. The Test
 * tier is a pricing smoke-test, NOT a feature tier.
 *
 * If you ever want a real "starter" tier with reduced features, add a new plan
 * label (e.g. 'starter') to the database CHECK constraint and route Test there
 * — but as of today every paid plan === Pro features.
 */
function planFromPriceId(priceId: string): 'pro' | 'team' {
  if (priceId === process.env.STRIPE_PRICE_TEAM_MONTHLY) return 'team';
  // Pro ($39), Test ($5), and any future low-tier prices all default to Pro features.
  // Logged so future "why did this user get Pro" questions are answerable.
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
        const newPlan: 'free' | 'pro' | 'team' =
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
