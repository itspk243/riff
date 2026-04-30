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
  });
}
