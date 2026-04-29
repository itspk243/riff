// Active Profile Assist: score a candidate profile against a job spec.
//
// We deliberately use Claude Haiku (cheaper, ~10x faster than Sonnet) since
// scoring is a tighter task than draft generation — the model just has to
// read criteria, read a profile, and emit JSON. Quality stays high; cost per
// score is around $0.001-0.002, which keeps the unit economics of the Plus
// tier sane (a Plus user browsing 100 profiles/day = ~$3/month at most).

import Anthropic from '@anthropic-ai/sdk';
import type { ProfileSnapshot, ScoreResult, JobSpec } from './types';

const SCORE_MODEL = process.env.RIFF_SCORE_MODEL || 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You score how well a candidate profile fits a hiring job spec.

INPUT: a candidate profile (name, headline, role, company, about, recent posts, skills, past roles) and a job spec (free-form description of who's wanted).

OUTPUT: a single JSON object, no commentary, exactly this shape:

{
  "score": <integer 0-100>,
  "reasoning": "<one sentence, ≤140 chars, plain English>",
  "matched": ["<short bullet>", ...],
  "missing": ["<short bullet>", ...]
}

SCORING RUBRIC:
- 90-100: very strong fit; concrete signals that match must-haves AND nice-to-haves
- 75-89: strong fit; matches must-haves, mixed nice-to-haves
- 60-74: decent fit; partial must-have match, worth a look
- 40-59: weak fit; could work with significant compromise
- 0-39: probably not a fit

RULES:
- 2-4 entries each in "matched" and "missing". No more.
- Each bullet is ≤80 chars, references concrete signal from the profile (a role, a post topic, a past company, a skill).
- "missing" can include criteria you can't confirm one way or the other — say "no signal on X".
- "reasoning" is plain English, NOT a sales pitch. Don't pad. Don't speculate beyond the data.
- If the profile is too sparse to score reliably (e.g. blank about, no role), return score ≤30 and explain why in reasoning.
- Output ONLY valid JSON. No markdown, no preamble, no trailing text.`;

function buildUserMessage(profile: ProfileSnapshot, spec: JobSpec): string {
  const lines: string[] = [];
  lines.push('===CANDIDATE PROFILE===');
  if (profile.name) lines.push(`name: ${profile.name}`);
  if (profile.headline) lines.push(`headline: ${profile.headline}`);
  if (profile.currentRole) lines.push(`currentRole: ${profile.currentRole}`);
  if (profile.currentCompany) lines.push(`currentCompany: ${profile.currentCompany}`);
  if (profile.about) lines.push(`about: ${profile.about.slice(0, 1500)}`);
  if (Array.isArray(profile.skills) && profile.skills.length > 0) {
    lines.push(`skills: ${profile.skills.slice(0, 8).join(', ')}`);
  }
  if (Array.isArray(profile.pastRoles) && profile.pastRoles.length > 0) {
    lines.push(`pastRoles: ${profile.pastRoles.slice(0, 2).join('; ')}`);
  }
  if (Array.isArray(profile.recentPosts) && profile.recentPosts.length > 0) {
    lines.push('recentPosts:');
    for (let i = 0; i < Math.min(3, profile.recentPosts.length); i++) {
      lines.push(`  ${i + 1}. ${profile.recentPosts[i].slice(0, 600)}`);
    }
  }
  lines.push('');
  lines.push('===JOB SPEC===');
  lines.push(`name: ${spec.name}`);
  lines.push(`description: ${spec.description}`);
  return lines.join('\n');
}

function safeParse(raw: string): ScoreResult | null {
  // The model usually returns clean JSON. Strip a leading ``` fence if it
  // sneaks one in (rare with system prompt enforcement).
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  try {
    const obj = JSON.parse(s);
    if (typeof obj.score !== 'number') return null;
    const score = Math.max(0, Math.min(100, Math.round(obj.score)));
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 200) : '';
    const matched = Array.isArray(obj.matched)
      ? obj.matched.filter((x: unknown) => typeof x === 'string').slice(0, 4)
      : [];
    const missing = Array.isArray(obj.missing)
      ? obj.missing.filter((x: unknown) => typeof x === 'string').slice(0, 4)
      : [];
    return { score, reasoning, matched, missing };
  } catch {
    return null;
  }
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _client;
}

/**
 * Score one profile against one spec. Returns null if the model misbehaved
 * and we couldn't parse a usable result — the caller decides whether to
 * surface the failure or drop the spec from the result list.
 */
export async function scoreProfile(
  profile: ProfileSnapshot,
  spec: JobSpec
): Promise<ScoreResult | null> {
  const msg = await client().messages.create({
    model: SCORE_MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(profile, spec) }],
  });
  const block = msg.content.find((b: any) => b.type === 'text');
  if (!block || block.type !== 'text') return null;
  return safeParse((block as any).text);
}
