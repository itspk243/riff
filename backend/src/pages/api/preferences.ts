// /api/preferences
//   GET   → return user's preferences (currently just digest_send_hour_utc)
//   PATCH → update preferences { digest_send_hour_utc?: 0-23 }
//
// Future: extend with email-on/off toggle, weekly vs daily cadence, etc.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = await getUserFromBearer(req.headers.authorization);
  if (!user) return res.status(401).json({ ok: false, error: 'Sign in first' });

  const supabase = serviceClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('users')
      .select('digest_send_hour_utc')
      .eq('id', user.id)
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({
      ok: true,
      digest_send_hour_utc: (data as any)?.digest_send_hour_utc ?? 8,
    });
  }

  if (req.method === 'PATCH') {
    const body = (req.body || {}) as { digest_send_hour_utc?: number };
    const update: Record<string, any> = {};
    if (typeof body.digest_send_hour_utc === 'number') {
      const h = Math.floor(body.digest_send_hour_utc);
      if (!Number.isFinite(h) || h < 0 || h > 23) {
        return res.status(400).json({ ok: false, error: 'digest_send_hour_utc must be 0–23' });
      }
      update.digest_send_hour_utc = h;
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ ok: false, error: 'No updatable fields provided' });
    }
    const { error } = await supabase.from('users').update(update).eq('id', user.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, ...update });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
