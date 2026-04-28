// POST /api/billing/checkout
// Body: { plan: 'pro' | 'team' }
// Headers: Authorization: Bearer <jwt>
// Returns: { url: string } — Stripe Checkout URL to redirect the user to.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer } from '../../../lib/supabase';
import { createCheckoutSession, PRICE_PRO_MONTHLY, PRICE_TEAM_MONTHLY } from '../../../lib/stripe';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  const { plan } = req.body as { plan: 'pro' | 'team' };
  const priceId = plan === 'team' ? PRICE_TEAM_MONTHLY : PRICE_PRO_MONTHLY;

  const base = process.env.RIFF_PUBLIC_URL;
  const session = await createCheckoutSession({
    userId: user.id,
    email: user.email,
    priceId,
    successUrl: `${base}/dashboard?upgraded=1`,
    cancelUrl: `${base}/pricing?canceled=1`,
  });

  return res.status(200).json({ ok: true, url: session.url });
}
