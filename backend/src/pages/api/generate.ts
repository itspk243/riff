// POST /api/generate
// Body: GenerateRequest
// Headers: Authorization: Bearer <supabase-jwt>  (optional in v0.1 — see ALLOW_ANON)
//
// In production we require auth so we can enforce free-tier quotas and bill.
// In local development you can set ALLOW_ANON=true and skip the header.

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer, serviceClient } from '../../lib/supabase';
import { checkQuota, recordUsage, bumpGlobalCounter, decrementGlobalCounter } from '../../lib/quota';
import { generateVariants } from '../../lib/llm';
import { hasAllVariants } from '../../lib/capabilities';
import { fingerprintAsPromptHint, type VoiceFingerprint } from '../../lib/voice-fingerprint';
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

  // Surface kill switch — env-controlled, no redeploy needed beyond setting
  // the var in Vercel and triggering a redeploy. If LinkedIn ever sends a
  // C&D about Sales Nav / Recruiter, we set
  //   RIFF_DISABLED_SURFACES=sales_navigator,linkedin_recruiter
  // and the affected surfaces start returning a clean 403 within minutes,
  // letting us reply to LinkedIn legal that we've already complied without
  // shipping a new extension version through Web Store review.
  const disabledSurfaces = (process.env.RIFF_DISABLED_SURFACES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (body.profile.surface && disabledSurfaces.includes(body.profile.surface)) {
    const human = body.profile.surface.replace(/_/g, ' ');
    return res.status(403).json({
      ok: false,
      error: `Riffly is temporarily not available on this surface (${human}). Open a public LinkedIn profile (linkedin.com/in/...) or a GitHub or Wellfound profile to draft a message.`,
      surfaceDisabled: true,
    });
  }

  // Auth + quota
  let user = await getUserFromBearer(req.headers.authorization);
  if (!user) {
    if (!ALLOW_ANON) {
      return res.status(401).json({ ok: false, error: 'Sign in to use Riffly. Visit your dashboard.' });
    }
  }

  let usageSnapshot: import('../../lib/types').UsageSnapshot | undefined;
  if (user) {
    const quota = await checkQuota(user);
    usageSnapshot = {
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      plan: quota.plan,
      resetsAt: quota.resetsAt,
      resetsLabel: quota.resetsLabel,
      windowKind: quota.windowKind,
    };
    if (!quota.ok) {
      return res.status(402).json({
        ok: false,
        error: quota.reason,
        remainingThisWeek: 0, // legacy field, kept for old extension versions
        plan: user.plan,
        usage: usageSnapshot,
        // Surfaced so the extension's inline upgrade hint can decide whether
        // to show "Share a roast for +3" (one-time bonus is still available)
        // or hide it (already claimed). Reviewer #12.
        roastShareUsed: !!user.roast_shared_at,
      });
    }
  }

  // Global daily circuit breaker — even after per-user quota passes, this
  // is the last line of defense vs runaway prompts or coordinated abuse
  // hitting the LLM bill directly.
  if (!bumpGlobalCounter()) {
    return res.status(503).json({
      ok: false,
      error: "We've hit today's global generation cap. Try again in a few hours; if this persists, email support@rifflylabs.com.",
    });
  }

  // Voice fingerprint injection (Pro+ moat feature). If the user has trained
  // Riffly on writing samples, append a one-paragraph style hint to the
  // request. The client never sets voiceHint — only the server, after
  // looking up the trusted fingerprint row.
  if (user) {
    try {
      const supabase = serviceClient();
      const { data: fp } = await supabase
        .from('user_voice_fingerprints')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (fp) {
        const hint = fingerprintAsPromptHint(fp as VoiceFingerprint);
        if (hint) (body as GenerateRequest).voiceHint = hint;
      }
    } catch (e) {
      // Best-effort — voice cloning is a polish layer, never block generation
      // because the fingerprint lookup failed.
      console.warn('voice fingerprint fetch failed', e);
    }
  }

  // Generate
  let variants;
  try {
    variants = await generateVariants(body);
  } catch (e: any) {
    decrementGlobalCounter(); // refund the slot — generation didn't happen
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

  // Variant gating: free tier sees only the cold_opener. All paid tiers see all three.
  // The model still generated all three (cheap, same prompt pass) — we just trim
  // follow_up + breakup unless the user upgraded.
  const isPaid = !!user && hasAllVariants(user.plan);
  const visibleVariants = isPaid
    ? variants
    : variants.filter(v => v.type === 'cold_opener');

  // Decrement remaining in the snapshot we return to the client (this
  // generation just counted). Saves the dashboard one round-trip.
  const finalUsage = usageSnapshot
    ? {
        ...usageSnapshot,
        used: usageSnapshot.used + 1,
        remaining: usageSnapshot.remaining === null ? null : Math.max(0, usageSnapshot.remaining - 1),
      }
    : undefined;

  return res.status(200).json({
    ok: true,
    variants: visibleVariants,
    remainingThisWeek: finalUsage?.windowKind === 'weekly' ? (finalUsage.remaining ?? undefined) : undefined,
    plan: user?.plan,
    upgradeMessage: !isPaid
      ? 'Upgrade to Pro for the full sequence (follow-up + breakup variants).'
      : undefined,
    usage: finalUsage,
  });
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '128kb' },
  },
};
