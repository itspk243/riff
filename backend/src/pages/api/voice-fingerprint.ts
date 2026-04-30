// /api/voice-fingerprint
//   GET   → return the user's current fingerprint (or null)
//   POST  → recompute from posted message samples and store
//   DELETE → clear the fingerprint
//
// Pro+ only. We accept message samples in the body (max 20, max 2000 chars
// each), compute the fingerprint server-side, and store the DERIVED stats
// only — never the raw messages. The client also computes the fingerprint
// independently for instant feedback in the onboarding UI.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../lib/supabase';
import { hasUnlimitedDrafts } from '../../lib/capabilities';
import { computeFingerprint } from '../../lib/voice-fingerprint';

const MAX_SAMPLES = 20;
const MAX_SAMPLE_LEN = 2000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  // Voice fingerprint is a Pro+ feature.
  if (!hasUnlimitedDrafts(user.plan)) {
    return res.status(402).json({
      ok: false,
      error: "Voice fingerprint is a Pro feature. Upgrade to make Riffly sound exactly like you.",
      needsUpgrade: true,
    });
  }

  const supabase = serviceClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('user_voice_fingerprints')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, fingerprint: data || null });
  }

  if (req.method === 'POST') {
    const { samples } = (req.body || {}) as { samples?: string[] };
    if (!Array.isArray(samples) || samples.length === 0) {
      return res.status(400).json({ ok: false, error: 'samples (string[]) required' });
    }
    if (samples.length > MAX_SAMPLES) {
      return res.status(400).json({ ok: false, error: `Max ${MAX_SAMPLES} samples` });
    }
    // Clip each sample to a sane size to bound CPU.
    const clipped = samples
      .map((s) => (typeof s === 'string' ? s.slice(0, MAX_SAMPLE_LEN) : ''))
      .filter(Boolean);

    const fingerprint = computeFingerprint(clipped);
    if (!fingerprint) {
      return res.status(400).json({
        ok: false,
        error: 'Need at least 3 messages with 10+ words each to compute a meaningful fingerprint.',
      });
    }

    const { error } = await supabase
      .from('user_voice_fingerprints')
      .upsert(
        {
          user_id: user.id,
          ...fingerprint,
          updated_at: new Date().toISOString(),
          computed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true, fingerprint });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('user_voice_fingerprints')
      .delete()
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
