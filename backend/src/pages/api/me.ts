// GET /api/me — return the user's plan + free-tier remaining for the dashboard.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer } from '../../lib/supabase';
import { getUsageThisWeek, FREE_WEEKLY_LIMIT } from '../../lib/quota';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  let remainingThisWeek: number | undefined;
  if (user.plan === 'free') {
    const used = await getUsageThisWeek(user.id);
    remainingThisWeek = Math.max(0, FREE_WEEKLY_LIMIT - used);
  }

  return res.status(200).json({
    ok: true,
    email: user.email,
    plan: user.plan,
    remainingThisWeek,
    hasSubscription: !!user.stripe_subscription_id,
  });
}
