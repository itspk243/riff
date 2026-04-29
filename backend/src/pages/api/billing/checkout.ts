// POST /api/billing/checkout
// Body: { plan: 'pro' | 'plus' | 'team' | 'test' }
// Headers: Authorization: Bearer <jwt>
// Returns: { url: string } — Stripe Checkout URL to redirect the user to.
//
// Plan-change behavior:
//   - First-time subscriber → Stripe Checkout Session.
//   - Existing subscriber on a different price → swap the subscription's
//     price in-place via Stripe Subscriptions API (proration applied).
//     This avoids the bug where Pro → Plus created a SECOND subscription
//     and the user paid both rates simultaneously.
//   - Existing subscriber on the same price → redirect to Customer Portal
//     so they can manage card / cancel / etc.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer } from '../../../lib/supabase';
import {
  stripe,
  createCheckoutSession,
  createPortalSession,
  PRICE_PRO_MONTHLY,
  PRICE_PLUS_MONTHLY,
  PRICE_TEAM_MONTHLY,
  PRICE_TEST_MONTHLY,
} from '../../../lib/stripe';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  const { plan } = req.body as { plan: 'pro' | 'plus' | 'team' | 'test' };
  let priceId: string;
  if (plan === 'plus') priceId = PRICE_PLUS_MONTHLY;
  else if (plan === 'team') priceId = PRICE_TEAM_MONTHLY;
  else if (plan === 'test') priceId = PRICE_TEST_MONTHLY;
  else priceId = PRICE_PRO_MONTHLY;
  if (!priceId) {
    return res.status(400).json({ ok: false, error: `Plan ${plan} is not configured` });
  }

  const base = process.env.RIFF_PUBLIC_URL;

  // Existing subscriber → swap price in place rather than creating a second
  // Checkout. This is THE bug that previously caused users upgrading from
  // Pro to Plus to be charged twice.
  if (user.stripe_subscription_id && user.stripe_customer_id) {
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
      const itemId = sub.items.data[0]?.id;
      const currentPriceId = sub.items.data[0]?.price?.id;

      if (currentPriceId === priceId) {
        // Already on this plan. Send them to portal to manage / cancel.
        const portal = await createPortalSession({
          customerId: user.stripe_customer_id,
          returnUrl: `${base}/dashboard`,
        });
        return res.status(200).json({ ok: true, url: portal.url, alreadyOnPlan: true });
      }

      if (itemId && (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due')) {
        await stripe.subscriptions.update(user.stripe_subscription_id, {
          items: [{ id: itemId, price: priceId }],
          proration_behavior: 'create_prorations',
          // If the sub was previously set to cancel at period end, undo that.
          cancel_at_period_end: false,
        });
        // The subscription.updated webhook will flip user.plan in Supabase.
        // Redirect with ?upgraded=1 so the dashboard re-fetches /api/me.
        return res.status(200).json({
          ok: true,
          url: `${base}/dashboard?upgraded=1`,
          changed: true,
        });
      }
      // Sub exists but is in a state we can't update in place (canceled,
      // unpaid, incomplete_expired). Fall through to a new Checkout Session.
    } catch (e: any) {
      console.warn(
        'checkout: existing-sub update failed, falling through to Checkout —',
        e?.message
      );
    }
  }

  const session = await createCheckoutSession({
    userId: user.id,
    email: user.email,
    priceId,
    successUrl: `${base}/dashboard?upgraded=1`,
    cancelUrl: `${base}/dashboard?canceled=1`,
  });

  return res.status(200).json({ ok: true, url: session.url });
}
