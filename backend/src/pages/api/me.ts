// GET /api/me — return the user's profile + plan + usage stats for the dashboard.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer } from '../../lib/supabase';
import { serviceClient } from '../../lib/supabase';
import { getUsageThisWeek, FREE_WEEKLY_LIMIT } from '../../lib/quota';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  const authHeader = req.headers.authorization;
  const user = await getUserFromBearer(authHeader);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  const supabase = serviceClient();

  // Pull Google identity metadata (avatar, name) from the JWT verification
  let avatar_url: string | null = null;
  let full_name: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const { data } = await supabase.auth.getUser(token);
    const meta = data.user?.user_metadata as Record<string, any> | undefined;
    if (meta) {
      avatar_url = meta.avatar_url || meta.picture || null;
      full_name = meta.full_name || meta.name || null;
    }
  }

  // Usage stats — count generations across three windows.
  const now = Date.now();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [{ count: weekCount }, { count: monthCount }, { count: totalCount }] = await Promise.all([
    supabase.from('usage').select('user_id', { count: 'exact', head: true }).eq('user_id', user.id).gte('generated_at', weekAgo),
    supabase.from('usage').select('user_id', { count: 'exact', head: true }).eq('user_id', user.id).gte('generated_at', startOfMonth),
    supabase.from('usage').select('user_id', { count: 'exact', head: true }).eq('user_id', user.id),
  ]);

  let remainingThisWeek: number | undefined;
  if (user.plan === 'free') {
    remainingThisWeek = Math.max(0, FREE_WEEKLY_LIMIT - (weekCount || 0));
  }

  return res.status(200).json({
    ok: true,
    email: user.email,
    full_name,
    avatar_url,
    plan: user.plan,
    remainingThisWeek,
    hasSubscription: !!user.stripe_subscription_id,
    member_since: user.created_at,
    current_period_end: user.current_period_end,
    usage: {
      this_week: weekCount || 0,
      this_month: monthCount || 0,
      all_time: totalCount || 0,
    },
  });
}
