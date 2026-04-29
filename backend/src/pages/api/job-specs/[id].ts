// /api/job-specs/[id]
//   PATCH  → update name/description/archived for one spec (must be owned)
//   DELETE → archive (soft-delete) the spec — keeps score_events history intact

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../../lib/supabase';
import { hasActiveProfileAssist } from '../../../lib/capabilities';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  // Plan gate (same as /api/job-specs).
  if (!hasActiveProfileAssist(user.plan)) {
    return res.status(402).json({
      ok: false,
      error: 'Active Profile Assist is a Plus feature.',
      needsUpgrade: true,
    });
  }

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ ok: false, error: 'id required' });

  const supabase = serviceClient();

  if (req.method === 'PATCH') {
    const body = (req.body || {}) as Partial<{
      name: string;
      description: string;
      archived: boolean;
    }>;
    const update: Record<string, any> = {};
    if (typeof body.name === 'string') {
      if (body.name.length > 80) return res.status(400).json({ ok: false, error: 'name max 80 characters' });
      update.name = body.name.trim();
    }
    if (typeof body.description === 'string') {
      if (body.description.length > 5000) return res.status(400).json({ ok: false, error: 'description max 5000 characters' });
      update.description = body.description.trim();
    }
    if (typeof body.archived === 'boolean') update.archived = body.archived;
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ ok: false, error: 'no updatable fields provided' });
    }
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('job_specs')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id) // ownership guard
      .select('id, name, description, archived, created_at, updated_at')
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data) return res.status(404).json({ ok: false, error: 'spec not found' });
    return res.status(200).json({ ok: true, spec: data });
  }

  if (req.method === 'DELETE') {
    // Soft-delete via archive flag — keeps the score_events FK intact so we
    // don't lose the user's scoring history.
    const { error } = await supabase
      .from('job_specs')
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
