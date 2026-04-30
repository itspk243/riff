// POST /api/install-reminder
//
// Mobile visitors who like the pitch but can't install a Chrome extension
// from their phone leave us their email so we can ping them on desktop.
// We send a single email immediately via Resend with the install link.
//
// No auth required — this is a public form. Light rate-limiting via the
// fact that Resend itself caps spam, plus we never store emails (each
// submission is just a one-shot send and forget).

import type { NextApiRequest, NextApiResponse } from 'next';
import { sendEmail } from '../../lib/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const { email } = (req.body || {}) as { email?: string };
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ ok: false, error: 'A valid email is required.' });
  }
  const clean = email.trim().toLowerCase();

  const result = await sendEmail({
    to: clean,
    subject: 'Install Riffly on your desktop',
    html: `<!doctype html>
<html><body style="margin:0;padding:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.55;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
  <div style="font-size:13px;color:#888;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:8px;">Riffly</div>
  <h1 style="font-size:22px;font-weight:600;margin:0 0 12px;letter-spacing:-0.01em;">Open this on the computer you'll use for outreach.</h1>
  <p style="font-size:14px;color:#555;margin:0 0 18px;">Riffly is a Chrome extension — it lives in your browser toolbar on whichever machine you actually do recruiting from. From a desktop, hit the button below to sign up and follow the install steps:</p>
  <p style="margin:0 0 24px;"><a href="https://rifflylabs.com/signup" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">Sign up &amp; install →</a></p>
  <hr style="border:none;border-top:1px solid #e7e4dc;margin:24px 0;">
  <p style="font-size:12px;color:#888;margin:0;">You're getting this because someone (probably you) asked us to email a desktop install link from rifflylabs.com on a phone. If that wasn't you, ignore this — we don't keep your address.</p>
</div>
</body></html>`,
    text: `Riffly is a Chrome extension — open this on the computer you'll use for outreach.\n\nSign up and follow the install steps: https://rifflylabs.com/signup\n\nIf this wasn't you, ignore — we don't keep your address.`,
  });

  if (!result.ok) {
    return res.status(500).json({ ok: false, error: result.error || 'Email send failed.' });
  }
  return res.status(200).json({ ok: true });
}
