// POST /api/billing/portal — return Stripe Customer Portal URL for the signed-in user.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer } from '../../../lib/supabase';
import { createPortalSession } from '../../../lib/stripe';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });
  if (!user.stripe_customer_id) {
    return res.status(400).json({ ok: false, error: 'No active subscription' });
  }

  const session = await createPortalSession({
    customerId: user.stripe_customer_id,
    returnUrl: `${process.env.RIFF_PUBLIC_URL}/dashboard`,
  });
  return res.status(200).json({ ok: true, url: session.url });
}
