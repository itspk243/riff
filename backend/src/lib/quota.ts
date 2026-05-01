// Quota model:
//   Free: 5 generations per rolling 7-day window.
//   Pro:  200 generations per calendar month.
//   Plus: 600 generations per calendar month (3x Pro for 3x the LLM budget).
//   Team: 600/mo (legacy, same as Plus).
//
// Why monthly for paid: matches how users think about subscriptions
// ("resets on the 1st"). A rolling window is more accurate but harder
// to communicate. Calendar month wins on UX clarity.
//
// Defensive caps that sit underneath the plan limits to catch abuse
// even on a generous Plus account:
//   - PAID_DAILY_HARD_CAP: ceiling for any one user's generations in 24h.
//     A real Plus user doing heavy sourcing might do 40-50/day; 200/day
//     is ~4-5x that. A bot or runaway script trips it.
//   - GLOBAL_DAILY_HARD_CAP: total /api/generate calls across all users.
//     Last-line circuit breaker against catastrophic Anthropic bills.

import { serviceClient } from './supabase';
import type { UserRow, Plan } from './types';
import { isPaidPlan } from './capabilities';

export const FREE_WEEKLY_LIMIT = 5;
export const MONTHLY_LIMIT_PRO = 200;
export const MONTHLY_LIMIT_PLUS = 600;
export const MONTHLY_LIMIT_TEAM = 600;
export const PAID_DAILY_HARD_CAP = 200;
export const GLOBAL_DAILY_HARD_CAP = 5000;

export function monthlyLimitForPlan(plan: Plan | null | undefined): number | null {
  if (plan === 'pro') return MONTHLY_LIMIT_PRO;
  if (plan === 'plus') return MONTHLY_LIMIT_PLUS;
  if (plan === 'team') return MONTHLY_LIMIT_TEAM;
  return null;
}

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

// Calendar month boundary, UTC. We use calendar months (not rolling 30-day)
// because users think in calendar months and "resets on the 1st" is a much
// clearer message than "resets when your oldest draft from 30 days ago drops".
export function startOfThisMonthUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
export function startOfNextMonthUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

export async function getUsageThisMonth(userId: string): Promise<number> {
  const supabase = serviceClient();
  const since = startOfThisMonthUtc().toISOString();
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

export interface QuotaInfo {
  used: number;
  limit: number | null;     // null = no plan-level limit (shouldn't happen post-launch)
  remaining: number | null;
  plan: Plan;
  resetsAt: string | null;  // ISO timestamp; null for free (rolling window)
  resetsLabel: string;      // human-readable "Jun 1" or "in 5 days"
  windowKind: 'monthly' | 'weekly';
}

export type QuotaResult =
  | { ok: true } & QuotaInfo
  | { ok: false; reason: string; reasonShort: string } & QuotaInfo;

function humanResetDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export async function checkQuota(user: UserRow): Promise<QuotaResult> {
  const plan = user.plan;
  // One-time bonus credits (e.g. from sharing a /roast result). Added to
  // whichever window applies. Persists until the user's plan-window usage
  // exceeds plan_limit + bonus_drafts; we don't decrement on every call
  // here — see /api/generate.ts for the consume-on-success logic that
  // would refine this in a future migration.
  const bonus = Math.max(0, user.bonus_drafts || 0);

  // Hard daily ceiling for ALL users. Catches runaway scripts and
  // coordinated abuse before they hit the Anthropic bill.
  const last24h = await getUsageLast24h(user.id);
  if (last24h >= PAID_DAILY_HARD_CAP) {
    return {
      ok: false,
      reason: `Daily generation cap reached (${PAID_DAILY_HARD_CAP}/day). Resets in 24 hours. If this is a legitimate workflow, email support@rifflylabs.com.`,
      reasonShort: `Daily cap (${PAID_DAILY_HARD_CAP})`,
      used: last24h,
      limit: PAID_DAILY_HARD_CAP,
      remaining: 0,
      plan,
      resetsAt: null,
      resetsLabel: 'in 24 hours',
      windowKind: 'monthly',
    };
  }

  // Free plan — rolling 7-day window.
  if (!isPaidPlan(plan)) {
    const used = await getUsageThisWeek(user.id);
    const effectiveLimit = FREE_WEEKLY_LIMIT + bonus;
    const remaining = Math.max(0, effectiveLimit - used);
    const base: QuotaInfo = {
      used,
      limit: effectiveLimit,
      remaining,
      plan,
      resetsAt: null,
      resetsLabel: 'weekly',
      windowKind: 'weekly',
    };
    if (remaining <= 0) {
      return {
        ok: false,
        reason: bonus > 0
          ? `Weekly limit reached (${effectiveLimit} drafts including ${bonus} bonus). Upgrade to Pro for 200 drafts/month.`
          : 'Free-tier weekly limit reached (5 drafts/week). Upgrade to Pro for 200 drafts/month.',
        reasonShort: 'Free weekly limit',
        ...base,
      };
    }
    return { ok: true, ...base };
  }

  // Paid plans — calendar month window.
  const planLimit = monthlyLimitForPlan(plan);
  const limit = planLimit !== null ? planLimit + bonus : null;
  const resetsAt = startOfNextMonthUtc();
  const resetsLabel = humanResetDate(resetsAt);
  if (limit === null) {
    // Defensive: unknown paid plan slips through, allow generation but log.
    console.warn(`Unknown paid plan "${plan}" had no monthly limit defined`);
    return {
      ok: true,
      used: 0,
      limit: null,
      remaining: null,
      plan,
      resetsAt: resetsAt.toISOString(),
      resetsLabel,
      windowKind: 'monthly',
    };
  }
  const used = await getUsageThisMonth(user.id);
  const remaining = Math.max(0, limit - used);
  const base: QuotaInfo = {
    used,
    limit,
    remaining,
    plan,
    resetsAt: resetsAt.toISOString(),
    resetsLabel,
    windowKind: 'monthly',
  };
  if (remaining <= 0) {
    const upgradeText = plan === 'pro'
      ? ' Upgrade to Plus for 600 drafts/month and voice fingerprint.'
      : '';
    return {
      ok: false,
      reason: `Monthly limit reached (${limit} drafts).${upgradeText} Resets ${resetsLabel}.`,
      reasonShort: `${limit}/mo limit hit`,
      ...base,
    };
  }
  return { ok: true, ...base };
}
