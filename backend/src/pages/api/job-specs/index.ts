// /api/job-specs
//   GET  → list user's active job specs
//   POST → create a new job spec { name, description }
//
// Plan-gated: Plus only (capability `hasActiveProfileAssist`).

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../../lib/supabase';
import { hasActiveProfileAssist, maxJobSpecs } from '../../../lib/capabilities';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS — extension calls from chrome-extension://
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  // Plan gate. Free/Pro see an empty list with locked: true so the popup
  // can render an "Upgrade to Plus" lock chip without a noisy error.
  if (!hasActiveProfileAssist(user.plan)) {
    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        specs: [],
        locked: true,
        maxActiveSpecs: 0,
      });
    }
    return res.status(402).json({
      ok: false,
      error: 'Active Profile Assist is a Plus feature. Upgrade to score profiles against your job specs.',
      needsUpgrade: true,
    });
  }

  const supabase = serviceClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('job_specs')
      .select('id, name, description, archived, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('archived', false)
      .order('updated_at', { ascending: false })
      .limit(20);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({
      ok: true,
      specs: data || [],
      maxActiveSpecs: maxJobSpecs(user.plan),
    });
  }

  if (req.method === 'POST') {
    const { name, description } = (req.body || {}) as {
      name?: string;
      description?: string;
    };
    if (!name || !description) {
      return res.status(400).json({ ok: false, error: 'name and description are required' });
    }
    if (name.length > 80) {
      return res.status(400).json({ ok: false, error: 'name max 80 characters' });
    }
    if (description.length > 5000) {
      return res.status(400).json({ ok: false, error: 'description max 5000 characters' });
    }

    // Enforce per-plan active-spec cap.
    const cap = maxJobSpecs(user.plan);
    const { count } = await supabase
      .from('job_specs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('archived', false);
    if ((count || 0) >= cap) {
      return res.status(400).json({
        ok: false,
        error: `You're at the cap of ${cap} active job specs. Archive an existing one first.`,
      });
    }

    const { data, error } = await supabase
      .from('job_specs')
      .insert({
        user_id: user.id,
        name: name.trim(),
        description: description.trim(),
      })
      .select('id, name, description, archived, created_at, updated_at')
      .single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, spec: data });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
