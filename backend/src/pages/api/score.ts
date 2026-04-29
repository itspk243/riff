// POST /api/score
// Body: ScoreRequest { profile, jobSpecId? }
// Returns: ScoreResponse
//
// Two modes:
//   - jobSpecId provided → score that one spec, return result
//   - jobSpecId omitted   → score against ALL active specs in parallel,
//                            return them all sorted (best first) + best
//
// Plan-gated to Plus. We log every score to score_events for cost analysis.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../lib/supabase';
import {
  hasActiveProfileAssist,
  maxJobSpecs,
} from '../../lib/capabilities';
import { scoreProfile } from '../../lib/score';
import type {
  ScoreRequest,
  ScoreResponse,
  JobSpec,
  ProfileSnapshot,
} from '../../lib/types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ScoreResponse>
) {
  // CORS — extension calls from chrome-extension://
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  if (!hasActiveProfileAssist(user.plan)) {
    return res.status(402).json({
      ok: false,
      error: 'Active Profile Assist is a Plus feature. Upgrade to score profiles against your job specs.',
    });
  }

  const { profile, jobSpecId } = (req.body || {}) as ScoreRequest;
  if (!profile || !profile.name) {
    return res.status(400).json({ ok: false, error: 'profile required' });
  }

  const supabase = serviceClient();

  // Pull the spec(s) we'll score against.
  let specs: JobSpec[] = [];
  if (jobSpecId) {
    const { data, error } = await supabase
      .from('job_specs')
      .select('*')
      .eq('id', jobSpecId)
      .eq('user_id', user.id)
      .eq('archived', false)
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data) return res.status(404).json({ ok: false, error: 'spec not found' });
    specs = [data as JobSpec];
  } else {
    const { data, error } = await supabase
      .from('job_specs')
      .select('*')
      .eq('user_id', user.id)
      .eq('archived', false)
      .order('updated_at', { ascending: false })
      .limit(maxJobSpecs(user.plan));
    if (error) return res.status(500).json({ ok: false, error: error.message });
    specs = (data || []) as JobSpec[];
  }

  if (specs.length === 0) {
    return res.status(200).json({
      ok: true,
      activeSpecsCount: 0,
      maxActiveSpecs: maxJobSpecs(user.plan),
      // No specs yet — popup uses this to nudge the user to add one.
      error: 'No active job specs to score against. Add one to get started.',
    });
  }

  // Score in parallel. Filter out any specs the model couldn't score.
  const settled = await Promise.allSettled(
    specs.map((s) => scoreProfile(profile as ProfileSnapshot, s))
  );

  const all = specs
    .map((s, i) => {
      const r = settled[i];
      if (r.status !== 'fulfilled' || !r.value) return null;
      return { jobSpecId: s.id, jobSpecName: s.name, result: r.value };
    })
    .filter(Boolean) as NonNullable<ScoreResponse['all']>;

  if (all.length === 0) {
    console.error('score: all specs failed for user', user.id);
    return res.status(500).json({ ok: false, error: 'Scoring failed. Try again in a moment.' });
  }

  all.sort((a, b) => b.result.score - a.result.score);
  const best = all[0];

  // Log score events (best-effort; don't block the response).
  Promise.all(
    all.map((entry) =>
      supabase.from('score_events').insert({
        user_id: user.id,
        job_spec_id: entry.jobSpecId,
        candidate_url: profile.profileUrl || null,
        candidate_name: profile.name || null,
        score: entry.result.score,
        reasoning: entry.result.reasoning,
        matched: entry.result.matched,
        missing: entry.result.missing,
      })
    )
  ).catch((err) => console.error('score: events log failed', err));

  return res.status(200).json({
    ok: true,
    best,
    all,
    activeSpecsCount: specs.length,
    maxActiveSpecs: maxJobSpecs(user.plan),
  });
}
