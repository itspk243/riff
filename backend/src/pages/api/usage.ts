// GET /api/usage
// Returns the current usage snapshot for the authenticated user. Used by
// the dashboard usage panel and (future) extension popup indicator to
// render a progress bar without having to first call /api/generate.
//
// Response shape mirrors GenerateResponse.usage so callers can share code.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer } from '../../lib/supabase';
import { checkQuota } from '../../lib/quota';
import type { UsageSnapshot } from '../../lib/types';

interface UsageApiResponse {
  ok: boolean;
  usage?: UsageSnapshot;
  blocked?: boolean;
  reason?: string;
  error?: string;
  /** True if the user has already burned their one-time +3 roast-share bonus. */
  roastShareUsed?: boolean;
  /** Total unconsumed bonus drafts on the user's account (added to limit). */
  bonusDrafts?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<UsageApiResponse>) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Sign in to see your usage.' });
  }

  const quota = await checkQuota(user);
  return res.status(200).json({
    ok: true,
    usage: {
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      plan: quota.plan,
      resetsAt: quota.resetsAt,
      resetsLabel: quota.resetsLabel,
      windowKind: quota.windowKind,
    },
    blocked: !quota.ok,
    reason: quota.ok ? undefined : (quota as any).reason,
    // True if the user has already burned their one-time +3 roast share
    // bonus. UsagePanel uses this to decide whether to show the
    // "share a roast for +3" CTA or just the upgrade-to-Pro CTA.
    roastShareUsed: !!user.roast_shared_at,
    bonusDrafts: user.bonus_drafts || 0,
  });
}
