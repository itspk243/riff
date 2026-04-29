// /api/templates
//   GET  → list user's saved templates (most recent first)
//   POST → create a saved template { name, pitch, purpose }

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS — extension calls from chrome-extension://
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  const supabase = serviceClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('saved_templates')
      .select('id, name, pitch, purpose, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, templates: data || [] });
  }

  if (req.method === 'POST') {
    const { name, pitch, purpose } = req.body as {
      name?: string;
      pitch?: string;
      purpose?: string;
    };
    if (!name || !pitch) {
      return res.status(400).json({ ok: false, error: 'Name and pitch are required.' });
    }
    if (name.length > 80) {
      return res.status(400).json({ ok: false, error: 'Template name max 80 characters.' });
    }
    if (pitch.length > 1500) {
      return res.status(400).json({ ok: false, error: 'Pitch max 1500 characters.' });
    }
    const validPurpose = ['hire', 'refer', 'network', 'ask', 'advisor'].includes(purpose || '')
      ? purpose
      : 'hire';

    const { data, error } = await supabase
      .from('saved_templates')
      .insert({
        user_id: user.id,
        name: name.trim(),
        pitch: pitch.trim(),
        purpose: validPurpose,
      })
      .select('id, name, pitch, purpose, created_at')
      .single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, template: data });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
