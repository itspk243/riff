// Free-tier quota: 3 generations per rolling 7-day window.
// Tightened from 5 → 3 so free users feel the limit within one session and
// have a real reason to upgrade. Pro and Team have no soft limit (still logged).

import { serviceClient } from './supabase';
import type { UserRow } from './types';
import { hasUnlimitedDrafts } from './capabilities';

export const FREE_WEEKLY_LIMIT = 3;

export async function getUsageThisWeek(userId: string): Promise<number> {
  const supabase = serviceClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('usage')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('generated_at', since);
  return count || 0;
}

export async function recordUsage(userId: string, variants: number) {
  const supabase = serviceClient();
  await supabase.from('usage').insert({
    user_id: userId,
    variants,
  });
}

export async function checkQuota(user: UserRow): Promise<{ ok: true; remaining: number | null } | { ok: false; reason: string; remaining: number }> {
  if (hasUnlimitedDrafts(user.plan)) {
    return { ok: true, remaining: null };
  }
  const used = await getUsageThisWeek(user.id);
  const remaining = Math.max(0, FREE_WEEKLY_LIMIT - used);
  if (remaining <= 0) {
    return {
      ok: false,
      reason: 'Free-tier weekly limit reached. Upgrade to Pro for unlimited generations.',
      remaining: 0,
    };
  }
  return { ok: true, remaining };
}
