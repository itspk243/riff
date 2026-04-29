// GET /api/me — return the user's profile + plan + usage stats for the dashboard.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer } from '../../lib/supabase';
import { serviceClient } from '../../lib/supabase';
import { getUsageThisWeek, FREE_WEEKLY_LIMIT } from '../../lib/quota';
import { stripe } from '../../lib/stripe';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Extension calls this from chrome-extension:// origin — full CORS preflight.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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

  // Reconcile plan with Stripe (Stripe is source of truth for billing).
  // This catches the failure mode where a webhook didn't fire or its
  // metadata.userId was stale — a user can pay for Plus on Stripe but our
  // users.plan still says 'free'. We self-heal here so the dashboard
  // always reflects what Stripe believes.
  //
  // Strategy:
  //   - If user.stripe_subscription_id is set → fetch + reconcile.
  //   - Else if user.stripe_customer_id is set → list active subs on the
  //     customer, pick the freshest, reconcile.
  //   - Else → trust the DB (user is on free, or never paid).
  let cancel_at_period_end = false;
  let subscription_status: string | null = null;
  let effectivePlan: typeof user.plan = user.plan;
  let reconciledSubId: string | null = user.stripe_subscription_id || null;
  let reconciledPeriodEnd: number | null = null;

  if (user.stripe_customer_id) {
    try {
      let sub: any | null = null;
      if (user.stripe_subscription_id) {
        try {
          sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
        } catch {
          // Sub deleted on Stripe — fall through to customer lookup.
        }
      }
      if (!sub || sub.status === 'canceled' || sub.status === 'incomplete_expired') {
        const list = await stripe.subscriptions.list({
          customer: user.stripe_customer_id,
          status: 'all',
          limit: 5,
        });
        sub = list.data
          .filter(
            (s) =>
              s.status === 'active' ||
              s.status === 'trialing' ||
              s.status === 'past_due'
          )
          .sort((a, b) => b.created - a.created)[0] || null;
      }

      if (sub) {
        cancel_at_period_end = !!sub.cancel_at_period_end;
        subscription_status = sub.status;
        reconciledSubId = sub.id;
        reconciledPeriodEnd = sub.current_period_end || null;
        const priceId = sub.items?.data?.[0]?.price?.id;
        // Derive plan from the live price ID. Mirrors webhook's planFromPriceId.
        if (priceId === process.env.STRIPE_PRICE_PLUS_MONTHLY) effectivePlan = 'plus';
        else if (priceId === process.env.STRIPE_PRICE_TEAM_MONTHLY) effectivePlan = 'team';
        else effectivePlan = 'pro'; // pro, test, or grandfathered all → 'pro'
        if (sub.status !== 'active' && sub.status !== 'trialing' && sub.status !== 'past_due') {
          // Sub is canceled/expired/etc. → revert to free.
          effectivePlan = 'free';
          reconciledSubId = null;
        }
      } else {
        // No active sub on this customer — they're effectively on free.
        effectivePlan = 'free';
        reconciledSubId = null;
      }

      // Persist reconciliation if the DB drifted from Stripe.
      const changed =
        effectivePlan !== user.plan ||
        (reconciledSubId || null) !== (user.stripe_subscription_id || null);
      if (changed) {
        const update: Record<string, any> = {
          plan: effectivePlan,
          stripe_subscription_id: reconciledSubId,
        };
        if (reconciledPeriodEnd) {
          update.current_period_end = new Date(reconciledPeriodEnd * 1000).toISOString();
        }
        await supabase.from('users').update(update).eq('id', user.id);
        console.log(
          `me: reconciled user=${user.id} plan ${user.plan}→${effectivePlan} sub_id ${user.stripe_subscription_id}→${reconciledSubId}`
        );
      }
    } catch (e: any) {
      console.error('me: reconcile failed —', e?.message);
    }
  }

  // Recompute remainingThisWeek using the reconciled plan (so a Plus user
  // who was previously stuck on 'free' doesn't see the free-tier quota nudge).
  let effectiveRemainingThisWeek: number | undefined = remainingThisWeek;
  if (effectivePlan !== 'free') effectiveRemainingThisWeek = undefined;
  else effectiveRemainingThisWeek = Math.max(0, FREE_WEEKLY_LIMIT - (weekCount || 0));

  // Use the freshest period_end we have — if reconciliation pulled a fresh
  // value from Stripe, prefer it over the cached DB column.
  const finalPeriodEnd = reconciledPeriodEnd
    ? new Date(reconciledPeriodEnd * 1000).toISOString()
    : user.current_period_end;

  return res.status(200).json({
    ok: true,
    email: user.email,
    full_name,
    avatar_url,
    plan: effectivePlan,
    remainingThisWeek: effectiveRemainingThisWeek,
    // Surfaced so the extension popup can render "X / N free this week"
    // without hard-coding N. If we change the limit, popup picks it up.
    freeWeeklyLimit: FREE_WEEKLY_LIMIT,
    hasSubscription: !!reconciledSubId,
    cancel_at_period_end,
    subscription_status,
    member_since: user.created_at,
    current_period_end: finalPeriodEnd,
    usage: {
      this_week: weekCount || 0,
      this_month: monthCount || 0,
      all_time: totalCount || 0,
    },
  });
}
