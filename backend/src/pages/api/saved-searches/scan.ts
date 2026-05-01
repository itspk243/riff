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
//   per scan WITHOUT caching.
// - SCORE CACHE (24h window): before scoring we look up score_events for
//   each (user_id, candidate_url, job_spec_id) tuple within the last 24h.
//   Cache hits skip the LLM call entirely and reuse the prior score. This
//   matters because Plus's marketed cadence (daily × 10 saved searches × 5
//   specs) would otherwise cost ~$187/mo per active user on a $25/mo
//   subscription. With the cache, the marginal cost of re-scanning the
//   same search becomes near-zero (just the DB query). Fresh profiles
//   (newly visible in the search results) and 24h+-stale candidates still
//   trigger fresh scoring.
// - Best-effort logging: we don't fail the response if score_events insert
//   fails for one row.

const SCORE_CACHE_WINDOW_MS = 24 * 60 * 60 * 1000;

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../../lib/supabase';
import { hasSavedSearchDigest, maxJobSpecs } from '../../../lib/capabilities';
import { scoreProfile } from '../../../lib/score';
import { checkScanQuota } from '../../../lib/quota';
import type { ProfileSnapshot, JobSpec, ScoreResult } from '../../../lib/types';

const MAX_PROFILES_PER_SCAN = 25;

// Cadence → minimum elapsed milliseconds before another auto-scan is allowed.
// `manual` blocks all auto-scans (must pass force=true). `on_visit` allows
// every call. The auto-trigger paths (popup auto-fire) are the ones rate-
// limited; the dashboard "Scan now" button passes force=true.
const CADENCE_INTERVAL_MS: Record<string, number> = {
  manual: Number.POSITIVE_INFINITY,
  on_visit: 0,
  thrice_daily: 8 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

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

  const { saved_search_id, profiles, force } = (req.body || {}) as {
    saved_search_id?: string;
    profiles?: ProfileSnapshot[];
    force?: boolean;
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
    .select('id, name, scan_cadence, last_scanned_at')
    .eq('id', saved_search_id)
    .eq('user_id', user.id)
    .eq('archived', false)
    .maybeSingle();
  if (!search) {
    return res.status(404).json({ ok: false, error: 'saved search not found' });
  }

  // Cadence enforcement — bypass with force=true (dashboard "Scan now" button).
  if (!force) {
    const cadence = (search as any).scan_cadence || 'manual';
    const interval = CADENCE_INTERVAL_MS[cadence] ?? Number.POSITIVE_INFINITY;
    const last = (search as any).last_scanned_at ? new Date((search as any).last_scanned_at).getTime() : 0;
    const elapsed = Date.now() - last;
    if (interval !== 0 && elapsed < interval) {
      const nextScanAt = new Date(last + interval).toISOString();
      return res.status(429).json({
        ok: false,
        error:
          cadence === 'manual'
            ? 'This search is set to manual. Trigger from the dashboard.'
            : `Next scan available at ${nextScanAt}.`,
        nextScanAt,
        cadence,
        rateLimited: true,
      });
    }
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

  // ---------- Score cache lookup ----------
  // For each (candidate_url, job_spec_id) we already scored within the
  // last 24h, reuse the result instead of paying for another LLM call.
  // Built before parallel scoring so we never enqueue a task for a cached
  // pair. Keyed on `${candidate_url}:${job_spec_id}`.
  const candidateUrls = profiles
    .map(p => p?.profileUrl)
    .filter((u): u is string => !!u && typeof u === 'string');
  const specIds = specs.map(s => s.id);
  const cacheCutoffIso = new Date(Date.now() - SCORE_CACHE_WINDOW_MS).toISOString();
  const cache = new Map<string, ScoreResult>();
  if (candidateUrls.length > 0 && specIds.length > 0) {
    const { data: cached } = await supabase
      .from('score_events')
      .select('candidate_url, job_spec_id, score, reasoning, matched, missing, scored_at')
      .eq('user_id', user.id)
      .in('candidate_url', candidateUrls)
      .in('job_spec_id', specIds)
      .gte('scored_at', cacheCutoffIso)
      .order('scored_at', { ascending: false });
    for (const row of cached || []) {
      const k = `${row.candidate_url}:${row.job_spec_id}`;
      // First row wins because we ordered by scored_at desc — that's the
      // most recent score for this (candidate, spec) pair.
      if (!cache.has(k)) {
        cache.set(k, {
          score: row.score,
          reasoning: row.reasoning,
          matched: row.matched || [],
          missing: row.missing || [],
        } as ScoreResult);
      }
    }
  }

  // ---------- Pre-flight scan-quota check ----------
  // Count how many FRESH (LLM-paying) calls this scan needs after cache
  // hits are subtracted, then ask quota.ts whether the user has budget
  // for them this month. Cached pairs are free — they don't count.
  // Without this gate, a power user could blow through the whole monthly
  // LLM budget on a Plus subscription that's only paying us $25.
  let plannedFresh = 0;
  for (const profile of profiles) {
    if (!profile?.name) continue;
    for (const spec of specs) {
      const cacheKey = profile.profileUrl ? `${profile.profileUrl}:${spec.id}` : '';
      if (!cacheKey || !cache.has(cacheKey)) plannedFresh++;
    }
  }
  if (plannedFresh > 0) {
    const scanQuota = await checkScanQuota(user, plannedFresh);
    if (!scanQuota.ok) {
      return res.status(402).json({
        ok: false,
        error: scanQuota.reason,
        scanQuota: {
          used: scanQuota.used,
          limit: scanQuota.limit,
          remaining: scanQuota.remaining,
          resetsAt: scanQuota.resetsAt,
          resetsLabel: scanQuota.resetsLabel,
        },
        needsUpgrade: false, // it's a usage cap, not a plan-tier issue
      });
    }
  }

  // Score every (profile, spec) pair in parallel — but skip the LLM call
  // for any pair that's already in the 24h cache. The settled array below
  // includes both cached and freshly-scored rows, with `cached` flagged so
  // we know which ones to insert into score_events vs. skip.
  const tasks: Array<Promise<{ profile: ProfileSnapshot; spec: JobSpec; result: ScoreResult | null; cached: boolean }>> = [];
  for (const profile of profiles) {
    if (!profile?.name) continue; // skip malformed entries silently
    for (const spec of specs) {
      const cacheKey = profile.profileUrl ? `${profile.profileUrl}:${spec.id}` : '';
      const cachedResult = cacheKey ? cache.get(cacheKey) : undefined;
      if (cachedResult) {
        tasks.push(Promise.resolve({ profile, spec, result: cachedResult, cached: true }));
        continue;
      }
      tasks.push(
        scoreProfile(profile, spec)
          .then((result) => ({ profile, spec, result, cached: false }))
          .catch(() => ({ profile, spec, result: null as ScoreResult | null, cached: false }))
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

  // Persist FRESHLY-SCORED pairs only. Cached ones already have a row in
  // score_events from a prior scan; re-inserting would inflate the row
  // count and skew the digest. Tagged with saved_search_id so the digest
  // endpoint can still filter to this search.
  const rows = settled
    .filter((s) => s.result && !s.cached)
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

  // Cost telemetry — useful for verifying the cache is doing its job in
  // production without parsing logs.
  const cachedCount = settled.filter((s) => s.cached).length;
  const freshCount = settled.filter((s) => s.result && !s.cached).length;

  return res.status(200).json({
    ok: true,
    saved_search_id: search.id,
    saved_search_name: search.name,
    scanned: profiles.length,
    scored: results.length,
    cachedPairs: cachedCount,
    freshPairs: freshCount,
    results,
  });
}
