// POST /api/roast-share
// Auth: required (signed-in users only).
// Awards a one-time +3 bonus drafts the first time a signed-in user shares
// a /roast result. Subsequent shares are no-ops (return ok with awarded:0).
//
// The /roast page detects the local riff_token, calls this endpoint when
// the user clicks any share button (Copy verdict / Copy link / X / LinkedIn),
// and surfaces the awarded count in a toast.
//
// Race-safety: we use a guarded SQL update so two concurrent share clicks
// can't both award the bonus. Whichever update wins flips roast_shared_at
// from NULL to now(); the loser hits the WHERE filter and updates 0 rows.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../lib/supabase';

const BONUS_AMOUNT = 3;

interface RoastShareResponse {
  ok: boolean;
  awarded?: number;          // number of bonus drafts granted on this call (0 if already shared before)
  totalBonus?: number;       // user's total bonus_drafts after the award
  alreadyShared?: boolean;   // true if this isn't the first share
  error?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<RoastShareResponse>) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) {
    // Not signed in — no bonus to award. We return ok so the /roast page
    // doesn't surface an error to anonymous sharers.
    return res.status(200).json({ ok: true, awarded: 0, alreadyShared: false });
  }

  const supabase = serviceClient();

  // Atomic guarded update: only flips roast_shared_at and bumps bonus_drafts
  // if roast_shared_at IS NULL right now. If two concurrent requests race,
  // whichever update lands first wins; the second matches zero rows.
  const { data, error } = await supabase
    .from('users')
    .update({
      roast_shared_at: new Date().toISOString(),
      bonus_drafts: (user.bonus_drafts || 0) + BONUS_AMOUNT,
    })
    .eq('id', user.id)
    .is('roast_shared_at', null)
    .select('bonus_drafts')
    .maybeSingle();

  if (error) {
    console.error('roast-share update failed', error);
    return res.status(500).json({ ok: false, error: 'Could not record share. Try again.' });
  }

  if (!data) {
    // No rows updated → user has already shared before. No award.
    return res.status(200).json({
      ok: true,
      awarded: 0,
      alreadyShared: true,
      totalBonus: user.bonus_drafts || 0,
    });
  }

  return res.status(200).json({
    ok: true,
    awarded: BONUS_AMOUNT,
    alreadyShared: false,
    totalBonus: data.bonus_drafts,
  });
}

export const config = {
  api: { bodyParser: { sizeLimit: '1kb' } },
};
