// Free-tier quota: 5 generations per rolling 7-day window.
// Pro and Team have no soft limit (still logged).
//
// Defensive caps below prevent any single account or coordinated abuse from
// running away with LLM costs even on paid plans:
//   - PAID_DAILY_HARD_CAP: ceiling for any one user's generations in 24h.
//     A real Pro user might do 30/day during heavy sourcing; 200/day is
//     ~7x that. A bot or runaway script trips it.
//   - GLOBAL_DAILY_HARD_CAP: total /api/generate calls across all users.
//     Used as a circuit breaker — if we somehow hit this, something's
//     wrong and we'd rather refuse than rack up a 5-figure Anthropic bill.

import { serviceClient } from './supabase';
import type { UserRow } from './types';
import { hasUnlimitedDrafts } from './capabilities';

export const FREE_WEEKLY_LIMIT = 5;
export const PAID_DAILY_HARD_CAP = 200;
export const GLOBAL_DAILY_HARD_CAP = 5000;

// In-memory daily counter for the global ceiling. Per-instance — multiple
// Vercel serverless instances each track separately; with our traffic
// volume the aggregate stays well below the cap. Replace with a Supabase
// counter row if we ever scale enough that this becomes inaccurate.
let globalDailyDate = todayIso();
let globalDailyCount = 0;
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
export function bumpGlobalCounter(): boolean {
  const t = todayIso();
  if (t !== globalDailyDate) {
    globalDailyDate = t;
    globalDailyCount = 0;
  }
  if (globalDailyCount >= GLOBAL_DAILY_HARD_CAP) return false;
  globalDailyCount++;
  return true;
}
export function decrementGlobalCounter() {
  globalDailyCount = Math.max(0, globalDailyCount - 1);
}

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

export async function getUsageLast24h(userId: string): Promise<number> {
  const supabase = serviceClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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
  // Hard daily ceiling for ALL users (paid or free). Catches abuse and
  // runaway scripts before they hit the Anthropic bill.
  const last24h = await getUsageLast24h(user.id);
  if (last24h >= PAID_DAILY_HARD_CAP) {
    return {
      ok: false,
      reason: `Daily generation cap reached (${PAID_DAILY_HARD_CAP}/day). Resets in 24h. If you legitimately need more, email support@rifflylabs.com.`,
      remaining: 0,
    };
  }

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
