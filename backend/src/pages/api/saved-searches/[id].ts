// /api/saved-searches/[id]
//   PATCH  → update name/search_url/archived for one saved search (must be owned)
//   DELETE → archive (soft-delete) — keeps score_events history intact

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../../lib/supabase';
import { hasSavedSearchDigest } from '../../../lib/capabilities';

const LINKEDIN_URL_RE = /^https:\/\/[a-z0-9.-]*linkedin\.com\//i;
const ALLOWED_CADENCES = new Set(['manual', 'on_visit', 'thrice_daily', 'daily', 'weekly']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  if (!hasSavedSearchDigest(user.plan)) {
    return res.status(402).json({
      ok: false,
      error: 'Saved-Search Daily Digest is a Plus feature.',
      needsUpgrade: true,
    });
  }

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });

  const supabase = serviceClient();

  if (req.method === 'PATCH') {
    const body = (req.body || {}) as Partial<{
      name: string;
      search_url: string;
      archived: boolean;
      scan_cadence: string;
    }>;
    const update: Record<string, any> = {};
    if (typeof body.name === 'string') {
      if (body.name.length > 80) return res.status(400).json({ ok: false, error: 'name max 80 characters' });
      update.name = body.name.trim();
    }
    if (typeof body.search_url === 'string') {
      if (body.search_url.length < 10 || body.search_url.length > 2000) {
        return res.status(400).json({ ok: false, error: 'search_url must be 10–2000 characters' });
      }
      if (!LINKEDIN_URL_RE.test(body.search_url)) {
        return res.status(400).json({ ok: false, error: 'search_url must be a https://...linkedin.com/... URL' });
      }
      update.search_url = body.search_url.trim();
    }
    if (typeof body.archived === 'boolean') update.archived = body.archived;
    if (typeof body.scan_cadence === 'string') {
      if (!ALLOWED_CADENCES.has(body.scan_cadence)) {
        return res.status(400).json({ ok: false, error: `scan_cadence must be one of: ${Array.from(ALLOWED_CADENCES).join(', ')}` });
      }
      update.scan_cadence = body.scan_cadence;
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ ok: false, error: 'no updatable fields provided' });
    }
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('saved_searches')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id) // ownership guard
      .select('id, name, search_url, archived, scan_cadence, created_at, updated_at, last_scanned_at')
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data) return res.status(404).json({ ok: false, error: 'saved search not found' });
    return res.status(200).json({ ok: true, search: data });
  }

  if (req.method === 'DELETE') {
    // Soft-delete via archive flag — keeps score_events FK intact.
    const { error } = await supabase
      .from('saved_searches')
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
