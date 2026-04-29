// POST /api/auth/refresh
// Body: { refresh_token: string }
// Returns: { ok, access_token, refresh_token, expires_at }
//
// The extension calls this when its cached access_token has expired (or is
// near expiry). Supabase access tokens are 1-hour JWTs; refresh tokens are
// long-lived (with rotation). This endpoint hides the Supabase URL/anon key
// from the extension — those stay server-side.
//
// Security note: refresh_tokens are bearer credentials. Anyone with one can
// mint access tokens for that user. The extension stores them in
// chrome.storage.local (per-user, per-machine, isolated from web pages).

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS — the extension calls from chrome-extension:// origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { refresh_token } = (req.body || {}) as { refresh_token?: string };
  if (!refresh_token || typeof refresh_token !== 'string') {
    return res.status(400).json({ ok: false, error: 'refresh_token required' });
  }

  // Use the public anon client — refresh is a public operation. The
  // refresh_token itself authenticates the request.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.error('refresh: missing SUPABASE env vars');
    return res.status(500).json({ ok: false, error: 'Auth misconfigured' });
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.refreshSession({ refresh_token });

  if (error || !data.session) {
    // Common case: refresh_token was rotated/revoked. Tell the extension to
    // prompt for a fresh sign-in.
    return res.status(401).json({
      ok: false,
      error: error?.message || 'Refresh failed — please sign in again on your dashboard.',
      needsReauth: true,
    });
  }

  return res.status(200).json({
    ok: true,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    // Supabase returns expires_at as Unix seconds. Pass it through.
    expires_at: data.session.expires_at,
  });
}
