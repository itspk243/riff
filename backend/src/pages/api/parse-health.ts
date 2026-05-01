// POST /api/parse-health
// Best-effort telemetry from the extension. Fire-and-forget — we never
// surface errors to the popup, and the popup never waits on the response.
// Logged via console for now; pipe into a parse_health_events table once
// we want to surface a "parser breakage by surface" dashboard.
//
// Body shape:
//   { surface: 'linkedin_profile' | 'sales_navigator' | 'linkedin_recruiter'
//             | 'github' | 'wellfound', gotName: bool, gotHeadline: bool,
//     gotAbout: bool, gotRecentPosts: bool }
//
// Reviewer rationale: "When LinkedIn changes a class name and your parser
// returns empty fields, the team learns about it from negative Web Store
// reviews — the worst possible feedback loop."
//
// Auth is optional. If the user is signed in we tag the event with their
// id; if not, we still log (anonymous extension installs hit profile pages
// that fail to parse too).

import type { NextApiRequest, NextApiResponse } from 'next';
import { getUserFromBearer } from '../../lib/supabase';

const VALID_SURFACES = new Set([
  'linkedin_profile',
  'sales_navigator',
  'linkedin_recruiter',
  'github',
  'wellfound',
  'unknown',
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const body = req.body || {};
  const surface = typeof body.surface === 'string' ? body.surface : 'unknown';
  if (!VALID_SURFACES.has(surface)) return res.status(200).json({ ok: true });

  // Optional auth — never reject on missing.
  let userId: string | null = null;
  try {
    const user = await getUserFromBearer(req.headers.authorization);
    if (user) userId = user.id;
  } catch {}

  const event = {
    surface,
    user_id: userId,
    got_name: !!body.gotName,
    got_headline: !!body.gotHeadline,
    got_about: !!body.gotAbout,
    got_recent_posts: !!body.gotRecentPosts,
    at: new Date().toISOString(),
  };

  // Console log for now. When we have meaningful traffic, pipe into a
  // parse_health_events table (schema migration is queued under task #112).
  console.log('[parse-health]', JSON.stringify(event));

  return res.status(200).json({ ok: true });
}

export const config = {
  api: { bodyParser: { sizeLimit: '1kb' } },
};
