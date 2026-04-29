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

  // Record usage (best-effort, don't block response). We log the FULL variants
  // count generated, not what we returned — accurate cost accounting.
  if (user) {
    recordUsage(user.id, variants.length).catch(err =>
      console.error('recordUsage failed', err)
    );
  }

  // Variant gating: free tier sees only the cold_opener. Pro/Team see all three.
  // The model still generated all three (it's cheap on Gemini and the same prompt
  // pass) — we just don't return follow_up/breakup unless the user upgraded.
  const isPaid = user && (user.plan === 'pro' || user.plan === 'team');
  const visibleVariants = isPaid
    ? variants
    : variants.filter(v => v.type === 'cold_opener');

  return res.status(200).json({
    ok: true,
    variants: visibleVariants,
    remainingThisWeek: remaining === null ? undefined : remaining - 1,
    plan: user?.plan,
    // Surface the upgrade nudge when free users hit the variant ceiling.
    upgradeMessage: !isPaid
      ? 'Upgrade to Pro for the full sequence — follow-up + breakup variants automatically.'
      : undefined,
  });
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '128kb' },
  },
};
