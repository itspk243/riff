// /api/events
//   POST → record a sent / replied event for a candidate.
//   GET  → list recent events (?candidate=<url> filters to one candidate)

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../../lib/supabase';
import { hasReplyAnalytics } from '../../../lib/capabilities';

const VARIANT_TYPES = ['cold_opener', 'follow_up', 'breakup'];
const KINDS = ['sent', 'replied'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  // Plan gate: cross-machine reply analytics + follow-up detection are paid-tier.
  // Free users still get LOCAL stats (chrome.storage.local) — they just don't sync.
  if (!hasReplyAnalytics(user.plan)) {
    return res.status(402).json({
      ok: false,
      error: 'Reply tracking sync is a Pro feature. Upgrade to sync sent/replied marks across devices and enable follow-up reminders.',
      needsUpgrade: true,
    });
  }

  const supabase = serviceClient();

  if (req.method === 'POST') {
    const { candidate_url, candidate_name, variant_type, tone, length_label, kind } = req.body as {
      candidate_url?: string;
      candidate_name?: string;
      variant_type?: string;
      tone?: string;
      length_label?: string;
      kind?: string;
    };

    if (!candidate_url || !variant_type || !kind) {
      return res.status(400).json({ ok: false, error: 'candidate_url, variant_type, and kind are required.' });
    }
    if (!VARIANT_TYPES.includes(variant_type)) {
      return res.status(400).json({ ok: false, error: 'Invalid variant_type.' });
    }
    if (!KINDS.includes(kind)) {
      return res.status(400).json({ ok: false, error: 'Invalid kind.' });
    }

    const { data, error } = await supabase
      .from('events')
      .insert({
        user_id: user.id,
        candidate_url: candidate_url.slice(0, 1000),
        candidate_name: candidate_name ? candidate_name.slice(0, 200) : null,
        variant_type,
        tone: tone || null,
        length_label: length_label || null,
        kind,
      })
      .select('id, kind, variant_type, tone, length_label, created_at')
      .single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, event: data });
  }

  if (req.method === 'GET') {
    const candidate = typeof req.query.candidate === 'string' ? req.query.candidate : null;

    let query = supabase
      .from('events')
      .select('id, candidate_url, candidate_name, variant_type, tone, length_label, kind, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (candidate) {
      query = query.eq('candidate_url', candidate);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, events: data || [] });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
