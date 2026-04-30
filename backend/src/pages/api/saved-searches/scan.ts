// POST /api/saved-searches/scan
// Body: { saved_search_id: string, profiles: ProfileSnapshot[] }
//
// Called by the extension when the user is on a tracked LinkedIn search URL
// and the content script has scraped visible profile cards. We score each
// profile against the user's active job specs in parallel, persist to
// score_events tagged with saved_search_id, and bump last_scanned_at.
//
// Plan-gated: Plus only (capability `hasSavedSearchDigest`).
//
// Scaling notes:
// - Hard cap of 25 profiles per request to bound LLM cost (~$0.005 each ×
//   number of active specs). At 25 profiles × 5 specs = 125 calls = $0.625
//   per scan. Scans are user-triggered (visit + click), not background.
// - Best-effort logging: we don't fail the response if score_events insert
//   fails for one row.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../../lib/supabase';
import { hasSavedSearchDigest, maxJobSpecs } from '../../../lib/capabilities';
import { scoreProfile } from '../../../lib/score';
import type { ProfileSnapshot, JobSpec, ScoreResult } from '../../../lib/types';

const MAX_PROFILES_PER_SCAN = 25;

interface ScanResultRow {
  profileUrl: string;
  candidateName: string;
  best?: { jobSpecId: string; jobSpecName: string; result: ScoreResult };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  if (!hasSavedSearchDigest(user.plan)) {
    return res.status(402).json({
      ok: false,
      error: 'Saved-Search Daily Digest is a Plus feature. Upgrade to scan tracked searches.',
      needsUpgrade: true,
    });
  }

  const { saved_search_id, profiles } = (req.body || {}) as {
    saved_search_id?: string;
    profiles?: ProfileSnapshot[];
  };
  if (!saved_search_id) return res.status(400).json({ ok: false, error: 'saved_search_id required' });
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return res.status(400).json({ ok: false, error: 'profiles[] required (non-empty array)' });
  }
  if (profiles.length > MAX_PROFILES_PER_SCAN) {
    return res.status(400).json({
      ok: false,
      error: `Too many profiles in one scan. Max is ${MAX_PROFILES_PER_SCAN}.`,
    });
  }

  const supabase = serviceClient();

  // Confirm the saved search belongs to this user.
  const { data: search } = await supabase
    .from('saved_searches')
    .select('id, name')
    .eq('id', saved_search_id)
    .eq('user_id', user.id)
    .eq('archived', false)
    .maybeSingle();
  if (!search) {
    return res.status(404).json({ ok: false, error: 'saved search not found' });
  }

  // Pull active job specs once.
  const { data: specsData, error: specsErr } = await supabase
    .from('job_specs')
    .select('*')
    .eq('user_id', user.id)
    .eq('archived', false)
    .order('updated_at', { ascending: false })
    .limit(maxJobSpecs(user.plan));
  if (specsErr) return res.status(500).json({ ok: false, error: specsErr.message });
  const specs = (specsData || []) as JobSpec[];
  if (specs.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Add at least one active job spec before scanning a saved search.',
      needsJobSpec: true,
    });
  }

  // Score every (profile, spec) pair in parallel.
  const tasks: Array<Promise<{ profile: ProfileSnapshot; spec: JobSpec; result: ScoreResult | null }>> = [];
  for (const profile of profiles) {
    if (!profile?.name) continue; // skip malformed entries silently
    for (const spec of specs) {
      tasks.push(
        scoreProfile(profile, spec)
          .then((result) => ({ profile, spec, result }))
          .catch(() => ({ profile, spec, result: null }))
      );
    }
  }
  const settled = await Promise.all(tasks);

  // Group by profile, find best spec match per profile.
  const byProfile = new Map<string, ScanResultRow>();
  for (const { profile, spec, result } of settled) {
    if (!result) continue;
    const key = profile.profileUrl || profile.name;
    const existing = byProfile.get(key);
    const candidate = { jobSpecId: spec.id, jobSpecName: spec.name, result };
    if (!existing) {
      byProfile.set(key, {
        profileUrl: profile.profileUrl || '',
        candidateName: profile.name,
        best: candidate,
      });
    } else if (!existing.best || result.score > existing.best.result.score) {
      existing.best = candidate;
    }
  }

  // Persist all scores (one row per (profile, spec) pair) tagged with
  // saved_search_id so the digest endpoint can filter.
  const rows = settled
    .filter((s) => s.result)
    .map((s) => ({
      user_id: user.id,
      job_spec_id: s.spec.id,
      saved_search_id: search.id,
      candidate_url: s.profile.profileUrl || null,
      candidate_name: s.profile.name || null,
      score: s.result!.score,
      reasoning: s.result!.reasoning,
      matched: s.result!.matched,
      missing: s.result!.missing,
    }));
  if (rows.length > 0) {
    const { error: insertErr } = await supabase.from('score_events').insert(rows);
    if (insertErr) console.error('saved-searches/scan: events insert failed', insertErr);
  }

  // Bump last_scanned_at on the saved search.
  await supabase
    .from('saved_searches')
    .update({ last_scanned_at: new Date().toISOString() })
    .eq('id', search.id)
    .eq('user_id', user.id);

  // Return only the best-match-per-profile, sorted by score desc.
  const results = Array.from(byProfile.values())
    .filter((r) => r.best)
    .sort((a, b) => (b.best!.result.score || 0) - (a.best!.result.score || 0));

  return res.status(200).json({
    ok: true,
    saved_search_id: search.id,
    saved_search_name: search.name,
    scanned: profiles.length,
    scored: results.length,
    results,
  });
}
