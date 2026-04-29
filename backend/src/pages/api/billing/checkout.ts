// POST /api/billing/checkout
// Body: { plan: 'pro' | 'plus' | 'team' | 'test' }
// Headers: Authorization: Bearer <jwt>
// Returns: { url: string } — Stripe Checkout URL to redirect the user to.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer } from '../../../lib/supabase';
import {
  createCheckoutSession,
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
  const session = await createCheckoutSession({
    userId: user.id,
    email: user.email,
    priceId,
    successUrl: `${base}/dashboard?upgraded=1`,
    // No /pricing route exists. Send canceled checkouts back to the dashboard
    // (the user is already authenticated; this avoids a 404).
    cancelUrl: `${base}/dashboard?canceled=1`,
  });

  return res.status(200).json({ ok: true, url: session.url });
}
