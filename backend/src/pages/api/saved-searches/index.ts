// /api/saved-searches
//   GET  → list user's active saved searches
//   POST → create a new saved search { name, search_url }
//
// Plan-gated: Plus only (capability `hasSavedSearchDigest`).
//
// A "saved search" is a LinkedIn search URL the user wants to track. The
// extension scrapes visible profile cards on that URL, POSTs them to /scan,
// and we score them against active job specs. Top results surface in the
// dashboard digest.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../../lib/supabase';
import { hasSavedSearchDigest, maxWatches } from '../../../lib/capabilities';

const LINKEDIN_URL_RE = /^https:\/\/[a-z0-9.-]*linkedin\.com\//i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS — extension calls from chrome-extension://
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  // Free/Pro see locked-empty so the dashboard can render an upgrade chip.
  if (!hasSavedSearchDigest(user.plan)) {
    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        searches: [],
        locked: true,
        maxSearches: 0,
      });
    }
    return res.status(402).json({
      ok: false,
      error: 'Saved-Search Daily Digest is a Plus feature. Upgrade to track LinkedIn searches.',
      needsUpgrade: true,
    });
  }

  const supabase = serviceClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('saved_searches')
      .select('id, name, search_url, archived, created_at, updated_at, last_scanned_at')
      .eq('user_id', user.id)
      .eq('archived', false)
      .order('updated_at', { ascending: false })
      .limit(20);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({
      ok: true,
      searches: data || [],
      maxSearches: maxWatches(user.plan),
    });
  }

  if (req.method === 'POST') {
    const { name, search_url } = (req.body || {}) as {
      name?: string;
      search_url?: string;
    };
    if (!name || !search_url) {
      return res.status(400).json({ ok: false, error: 'name and search_url are required' });
    }
    if (name.length > 80) {
      return res.status(400).json({ ok: false, error: 'name max 80 characters' });
    }
    if (search_url.length < 10 || search_url.length > 2000) {
      return res.status(400).json({ ok: false, error: 'search_url must be 10–2000 characters' });
    }
    if (!LINKEDIN_URL_RE.test(search_url)) {
      return res.status(400).json({ ok: false, error: 'search_url must be a https://...linkedin.com/... URL' });
    }

    // Enforce per-plan watch cap.
    const cap = maxWatches(user.plan);
    const { count } = await supabase
      .from('saved_searches')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('archived', false);
    if ((count || 0) >= cap) {
      return res.status(400).json({
        ok: false,
        error: `You're at the cap of ${cap} saved searches. Archive an existing one first.`,
      });
    }

    const { data, error } = await supabase
      .from('saved_searches')
      .insert({
        user_id: user.id,
        name: name.trim(),
        search_url: search_url.trim(),
      })
      .select('id, name, search_url, archived, created_at, updated_at, last_scanned_at')
      .single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, search: data });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
