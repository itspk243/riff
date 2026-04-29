// /api/templates/[id]  → DELETE a saved template (must be owned by caller)

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'DELETE') return res.status(405).json({ ok: false });

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  const id = parseInt(String(req.query.id), 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Bad id' });

  const supabase = serviceClient();
  const { error } = await supabase
    .from('saved_templates')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id); // ownership check
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true });
}
