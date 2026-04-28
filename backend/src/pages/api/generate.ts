// POST /api/generate
// Body: GenerateRequest
// Headers: Authorization: Bearer <supabase-jwt>  (optional in v0.1 — see ALLOW_ANON)
//
// In production we require auth so we can enforce free-tier quotas and bill.
// In local development you can set ALLOW_ANON=true and skip the header.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer } from '../../lib/supabase';
import { checkQuota, recordUsage } from '../../lib/quota';
import { generateVariants } from '../../lib/llm';
import type { GenerateRequest, GenerateResponse } from '../../lib/types';

const ALLOW_ANON = process.env.ALLOW_ANON === 'true';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GenerateResponse>
) {
  // CORS — extension calls from the chrome-extension:// origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = req.body as GenerateRequest;
  if (!body || !body.profile || !body.pitch || !body.tone || !body.length) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  // Auth + quota
  let user = await getUserFromBearer(req.headers.authorization);
  if (!user) {
    if (!ALLOW_ANON) {
      return res.status(401).json({ ok: false, error: 'Sign in to use Riff. Visit your dashboard.' });
    }
  }

  let remaining: number | null = null;
  if (user) {
    const quota = await checkQuota(user);
    if (!quota.ok) {
      return res.status(402).json({
        ok: false,
        error: quota.reason,
        remainingThisWeek: 0,
        plan: user.plan,
      });
    }
    remaining = quota.remaining;
  }

  // Generate
  let variants;
  try {
    variants = await generateVariants(body);
  } catch (e: any) {
    console.error('generateVariants failed', e);
    return res.status(500).json({ ok: false, error: 'Generation failed. Try again in a moment.' });
  }

  // Record usage (best-effort, don't block response)
  if (user) {
    recordUsage(user.id, variants.length).catch(err =>
      console.error('recordUsage failed', err)
    );
  }

  return res.status(200).json({
    ok: true,
    variants,
    remainingThisWeek: remaining === null ? undefined : remaining - 1,
    plan: user?.plan,
  });
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '128kb' },
  },
};
