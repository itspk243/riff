// POST /api/demo-generate
//
// Public, no-auth landing-page demo. Lets a visitor type their actual pitch
// + tone and see a REAL Riffly draft generated against a hardcoded sample
// LinkedIn profile (Alex Chen — same one shown in the hero window). This is
// the answer to the brutal-review feedback that the static "Sample draft"
// window doesn't actually demonstrate the product.
//
// Abuse controls:
//   - Cookie-based one-shot (riff_demo_used). Anyone can clear cookies but
//     this kills 95% of casual abuse.
//   - Hard daily cap on total demo generations across all visitors via an
//     in-memory counter (resets on cold start — acceptable for early stage).
//   - Returns 1 variant, not 3, so cost is ~1/3 of a real generation.
//   - Pitch length capped at 240 chars so abusers can't smuggle long prompts.
//
// Hardcoded sample profile mirrors the one in the hero illustration so the
// experience reads as "the demo above is showing what Riffly does for
// candidates like this — try it with your own pitch."

import type { NextApiRequest, NextApiResponse } from 'next';
import { generateVariants } from '../../lib/llm';
import type { GenerateRequest, MessageVariant } from '../../lib/types';
import { bumpRateLimit, decrementRateLimit, hashIp } from '../../lib/demo-rate-limit';

const COOKIE_NAME = 'riff_demo_used';
const COOKIE_GENERATIONS_KEY = 'riff_demo_count';
const PITCH_MAX = 240;
const ALLOWED_TONES = new Set(['warm', 'direct', 'cheeky']);
const ALLOWED_LENGTHS = new Set(['short', 'medium']);

// Per-cookie cap — generous enough for "let me try a different tone" but
// blocks endless loops. Upgrades to unlimited via signup.
const PER_COOKIE_LIMIT = 3;

// IP-based daily limit. Persisted in Supabase (demo_rate_limits table) so
// it survives Vercel cold starts. Previously this was an in-memory Map
// that reset on every deploy, letting bursts of abuse slip through.
const PER_IP_DAILY_LIMIT = 5;

// Global daily hard cap — last line of defense if everything else fails.
// Also persisted now.
const DAILY_HARD_CAP = 200;

// Vercel sets x-forwarded-for and x-real-ip on every request. Take the
// first IP in the chain (the actual client). Falls back to a coarse bucket
// when running locally so dev still works.
function getClientIp(req: NextApiRequest): string {
  const xfwd = req.headers['x-forwarded-for'];
  if (typeof xfwd === 'string') {
    const ip = xfwd.split(',')[0].trim();
    if (ip) return ip;
  }
  const xreal = req.headers['x-real-ip'];
  if (typeof xreal === 'string' && xreal) return xreal;
  return 'local';
}

// Read the count from the existing cookie (number 1-N stored as
// "riff_demo_count=3"). Used so we honor the per-cookie cap across runs.
function readCookieCount(cookieHeader: string): number {
  const m = cookieHeader.match(new RegExp(`${COOKIE_GENERATIONS_KEY}=(\\d+)`));
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

const SAMPLE_PROFILE: GenerateRequest['profile'] = {
  profileUrl: 'https://linkedin.com/in/alex-chen-sample',
  name: 'Alex Chen',
  headline: 'Staff Engineer · Distributed Systems · Currently keeping FinTech APIs from falling over',
  currentRole: 'Staff Engineer',
  currentCompany: 'Loop',
  about:
    "Distributed systems and reliability work. The kind of engineer who reads a Jepsen post in their head when someone says 'eventually consistent.' Right now: building cross-region replay for a payments API at Loop. Previously: SRE work at two B2B fintechs. I write occasionally about the gap between systems theory and what happens when the pager goes off at 3 AM.",
  capturedAt: new Date(0).toISOString(), // sample profile, deterministic timestamp
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Cookie-based per-browser cap. Allows up to N generations so visitors can
  // try multiple tones / lengths, but blocks the obvious abuse loop.
  const cookieHeader = req.headers.cookie || '';
  const cookieCount = readCookieCount(cookieHeader);
  if (cookieCount >= PER_COOKIE_LIMIT) {
    return res.status(429).json({
      ok: false,
      error: `You've used your ${PER_COOKIE_LIMIT} demo generations on this browser. Sign up free to keep going — no card required.`,
      alreadyUsed: true,
    });
  }

  // IP-based daily cap. Survives cookie clears AND Vercel cold starts —
  // unlike the previous in-memory implementation. The IP itself is hashed
  // (sha256 + RIFF_IP_SALT) before persistence so a leak of the
  // demo_rate_limits table can't be linked back to specific visitors.
  const ip = getClientIp(req);
  const ipBucket = hashIp(ip);
  const ipResult = await bumpRateLimit('ip', ipBucket, PER_IP_DAILY_LIMIT);
  if (!ipResult.ok) {
    return res.status(429).json({
      ok: false,
      error: "You've hit today's demo limit on this network. Sign up free to keep going.",
      ipCapHit: true,
    });
  }

  // Global daily cap — last line of defense against scrapers / coordinated
  // abuse hitting from many IPs. Now persistent across deploys.
  const globalResult = await bumpRateLimit('global', 'all', DAILY_HARD_CAP);
  if (!globalResult.ok) {
    await decrementRateLimit('ip', ipBucket);
    return res.status(429).json({
      ok: false,
      error: "Demo's been popular today — we've hit our daily generation cap. Sign up free to keep going.",
      dailyCapHit: true,
    });
  }

  // Helper to refund both counters when a request fails after the bump.
  // Both decrements are best-effort — small accuracy loss on failure is
  // fine; the user-visible behavior is still bounded by the cap.
  const refund = async () => {
    await Promise.all([
      decrementRateLimit('ip', ipBucket),
      decrementRateLimit('global', 'all'),
    ]);
  };

  const body = (req.body || {}) as { pitch?: string; tone?: string; length?: string };
  const pitchRaw = (body.pitch || '').trim();
  const toneRaw = (body.tone || 'direct').trim();
  const lengthRaw = (body.length || 'medium').trim();

  if (!pitchRaw) {
    await refund();
    return res.status(400).json({ ok: false, error: 'Add a one-sentence pitch first.' });
  }
  if (pitchRaw.length > PITCH_MAX) {
    await refund();
    return res.status(400).json({
      ok: false,
      error: `Pitch is too long for the demo (${pitchRaw.length}/${PITCH_MAX} chars). Sign up free for unlimited length.`,
    });
  }
  if (!ALLOWED_TONES.has(toneRaw)) {
    await refund();
    return res.status(400).json({ ok: false, error: 'Pick warm, direct, or cheeky.' });
  }
  if (!ALLOWED_LENGTHS.has(lengthRaw)) {
    await refund();
    return res.status(400).json({ ok: false, error: 'Length must be short or medium.' });
  }

  // Run the real generation.
  let variants: MessageVariant[] = [];
  try {
    variants = await generateVariants({
      profile: SAMPLE_PROFILE,
      pitch: pitchRaw,
      tone: toneRaw as any,
      length: lengthRaw as any,
      purpose: 'hire',
      language: 'en',
    });
  } catch (e: any) {
    await refund();
    return res.status(500).json({
      ok: false,
      error: 'The demo model is busy right now. Try again in a moment, or sign up to use the real extension.',
    });
  }

  // Pick just the cold opener (variants[0] is always cold_opener) and return
  // it. Cheaper, simpler UX, and the visitor can sign up to see all three.
  const opener = variants.find((v) => v.type === 'cold_opener') || variants[0];
  if (!opener) {
    await refund();
    return res.status(500).json({ ok: false, error: 'No draft produced. Try again.' });
  }

  // Bump the per-cookie counter and set both cookies (legacy COOKIE_NAME for
  // compatibility, COOKIE_GENERATIONS_KEY for the new per-cookie cap).
  const newCount = cookieCount + 1;
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=1; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
    `${COOKIE_GENERATIONS_KEY}=${newCount}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
  ]);

  return res.status(200).json({
    ok: true,
    profile: { name: SAMPLE_PROFILE.name, headline: SAMPLE_PROFILE.headline },
    variant: opener,
    remaining: PER_COOKIE_LIMIT - newCount,
    note: 'Real generation against a sample profile (Alex Chen). Sign up to run it on whoever\'s in front of you.',
  });
}
