// POST /api/auth/magic-link
// Body: { email: string }
// Sends a Supabase magic-link email. The user clicks it, lands on our /auth/callback page,
// which extracts the access token and stashes it in chrome.storage via the extension's
// dashboard tab. (Auth flow detailed in DEPLOY.md.)

import type { NextApiRequest, NextApiResponse } from 'next';
import { serviceClient } from '../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { email } = req.body as { email?: string };
  if (!email || !/.+@.+\..+/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Valid email required' });
  }

  const supabase = serviceClient();
  const redirectTo = `${process.env.RIFF_PUBLIC_URL}/auth/callback`;
  const { error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
  // inviteUserByEmail errors if user already exists; fall back to OTP
  if (error) {
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (otpErr) {
      console.error('magic-link otp failed', otpErr);
      return res.status(500).json({ ok: false, error: 'Could not send link. Try again.' });
    }
  }
  return res.status(200).json({ ok: true });
}
