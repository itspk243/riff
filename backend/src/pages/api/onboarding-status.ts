// GET /api/onboarding-status
//
// Returns whether each onboarding step is complete for the current user. The
// dashboard's OnboardingChecklist uses this to auto-tick steps as the user
// progresses, so the checklist disappears once they're "in."
//
// Steps (auto-detected from existing data — no schema changes):
//   - extensionUsed: ≥1 row in `usage` (proves extension is installed AND
//     signed in AND working)
//   - firstSpec:    ≥1 row in `job_specs` (Plus benefit; needed for fit-score)
//   - firstSearch:  ≥1 row in `saved_searches` (Plus only)
//
// "Sign in" is implicit — they wouldn't see this dashboard otherwise.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  const supabase = serviceClient();

  // Three lightweight count(*) queries in parallel. head: true means no rows
  // come back — just the count — which is the cheapest possible Postgres call.
  const [{ count: usageCount }, { count: specsCount }, { count: searchesCount }] = await Promise.all([
    supabase.from('usage').select('user_id', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('job_specs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('archived', false),
    supabase.from('saved_searches').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('archived', false),
  ]);

  return res.status(200).json({
    ok: true,
    extensionUsed: (usageCount || 0) > 0,
    firstSpec: (specsCount || 0) > 0,
    firstSearch: (searchesCount || 0) > 0,
    plan: user.plan,
  });
}
