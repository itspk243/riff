// POST /api/billing/webhook
// Stripe webhook: subscription created, updated, canceled, invoice paid/failed.
// Updates user plan in Supabase.

import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { stripe } from '../../../lib/stripe';
import { serviceClient } from '../../../lib/supabase';

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

        // Determine plan from price
        const subObj = await stripe.subscriptions.retrieve(sub);
        const priceId = subObj.items.data[0].price.id;
        const plan = priceId === process.env.STRIPE_PRICE_TEAM_MONTHLY ? 'team' : 'pro';

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
        const newPlan = sub.status === 'active' || sub.status === 'trialing'
          ? (sub.items.data[0].price.id === process.env.STRIPE_PRICE_TEAM_MONTHLY ? 'team' : 'pro')
          : 'free';
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
