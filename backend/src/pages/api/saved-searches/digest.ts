// GET /api/saved-searches/digest?days=7&top=5
//
// Returns the top-N scored candidates per active saved search over the last
// `days` days. Powers the Plus-tier dashboard "Daily Digest" section.
//
// We deduplicate per (saved_search_id, candidate_url) keeping the highest-
// scoring event so a candidate that appeared multiple times only shows once.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../../lib/supabase';
import { hasSavedSearchDigest } from '../../../lib/capabilities';

interface DigestCandidate {
  candidate_url: string | null;
  candidate_name: string | null;
  score: number;
  reasoning: string | null;
  job_spec_id: string;
  scored_at: string;
}

interface DigestEntry {
  saved_search_id: string;
  saved_search_name: string;
  search_url: string;
  last_scanned_at: string | null;
  total_in_window: number;
  top: DigestCandidate[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  if (!hasSavedSearchDigest(user.plan)) {
    // Free/Pro see a locked empty state so the dashboard renders an upgrade chip
    // instead of a noisy error.
    return res.status(200).json({ ok: true, locked: true, digest: [] });
  }

  const days = clampInt(req.query.days, 1, 30, 7);
  const top = clampInt(req.query.top, 1, 25, 5);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const supabase = serviceClient();

  // Fetch active saved searches.
  const { data: searches, error: searchesErr } = await supabase
    .from('saved_searches')
    .select('id, name, search_url, last_scanned_at')
    .eq('user_id', user.id)
    .eq('archived', false)
    .order('updated_at', { ascending: false });
  if (searchesErr) {
    return res.status(500).json({ ok: false, error: searchesErr.message });
  }

  if (!searches || searches.length === 0) {
    return res.status(200).json({ ok: true, digest: [], windowDays: days });
  }

  // Pull scoring events in the window for this user, tagged with any of these
  // saved searches. Single query is more efficient than per-search loop.
  const searchIds = searches.map((s: any) => s.id);
  const { data: events, error: eventsErr } = await supabase
    .from('score_events')
    .select('saved_search_id, candidate_url, candidate_name, score, reasoning, job_spec_id, scored_at')
    .eq('user_id', user.id)
    .in('saved_search_id', searchIds)
    .gte('scored_at', sinceIso)
    .order('score', { ascending: false })
    .limit(2000); // hard cap; one user shouldn't exceed this in a 30-day window

  if (eventsErr) {
    return res.status(500).json({ ok: false, error: eventsErr.message });
  }

  // Group by saved_search_id, dedupe per candidate (keep highest score),
  // then take top-N.
  const grouped = new Map<string, Map<string, DigestCandidate>>();
  for (const ev of events || []) {
    if (!ev.saved_search_id) continue;
    const key = ev.candidate_url || ev.candidate_name || '';
    if (!key) continue;
    let bucket = grouped.get(ev.saved_search_id);
    if (!bucket) {
      bucket = new Map();
      grouped.set(ev.saved_search_id, bucket);
    }
    const existing = bucket.get(key);
    if (!existing || (ev.score || 0) > (existing.score || 0)) {
      bucket.set(key, {
        candidate_url: ev.candidate_url,
        candidate_name: ev.candidate_name,
        score: ev.score || 0,
        reasoning: ev.reasoning,
        job_spec_id: ev.job_spec_id,
        scored_at: ev.scored_at,
      });
    }
  }

  const digest: DigestEntry[] = searches.map((s: any) => {
    const bucket = grouped.get(s.id);
    const all = bucket ? Array.from(bucket.values()) : [];
    all.sort((a, b) => (b.score || 0) - (a.score || 0));
    return {
      saved_search_id: s.id,
      saved_search_name: s.name,
      search_url: s.search_url,
      last_scanned_at: s.last_scanned_at,
      total_in_window: all.length,
      top: all.slice(0, top),
    };
  });

  return res.status(200).json({ ok: true, digest, windowDays: days });
}

function clampInt(raw: any, min: number, max: number, fallback: number): number {
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
