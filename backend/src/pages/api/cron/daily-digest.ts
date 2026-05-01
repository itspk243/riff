// GET /api/cron/daily-digest
//
// Vercel Cron entry point — fires daily at 08:00 UTC (configured in
// vercel.json). For each Plus / Team user, computes top new matches across
// their saved searches in the last 24h and emails them a digest. Skips
// users with zero new matches so we don't spam empty inboxes.
//
// Auth: Vercel Cron sends `x-vercel-cron: 1`. For manual triggers and
// testing, accept Bearer CRON_SECRET. Anything else is rejected.
//
// Idempotent within a 24h window — if you re-run, you'll re-send the same
// digest. We don't dedupe across runs (Vercel Cron only fires once daily).

import type { NextApiRequest, NextApiResponse } from 'next';
import { serviceClient } from '../../../lib/supabase';
import { sendEmail } from '../../../lib/email';

interface DigestCandidate {
  candidate_url: string | null;
  candidate_name: string | null;
  score: number;
  reasoning: string | null;
}

interface DigestEntry {
  saved_search_id: string;
  saved_search_name: string;
  search_url: string;
  top: DigestCandidate[];
  total_in_window: number;
}

const TOP_PER_SEARCH = 5;
const WINDOW_HOURS = 24;
const MIN_SCORE_TO_EMAIL = 50; // skip "low" matches in the email; full list still on dashboard

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Auth
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isManualTrigger =
    process.env.CRON_SECRET &&
    req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isManualTrigger) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const supabase = serviceClient();
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  // Cron firing strategy is controlled by the DIGEST_HOURLY_FIRING env var.
  //
  // - false / unset (Vercel Hobby default): the cron fires once per day. We
  //   ignore digest_send_hour_utc entirely and send to ALL Plus/Team users.
  //   This is the "fail safe" mode — nobody gets silently skipped because
  //   their preferred hour didn't match the single fire time. The reviewer
  //   flagged the previous behavior as silent failure: a user who picked
  //   any hour other than 08:00 UTC got nothing, with no error visible.
  //
  // - true (Vercel Pro or external hourly pinger): we respect the per-user
  //   hour preference — the cron must fire 24×/day for full coverage.
  //
  // The ?hour=N query override is still honored for manual testing.
  const isHourly = process.env.DIGEST_HOURLY_FIRING === 'true';
  const hourOverride = parseInt(String(req.query.hour ?? ''), 10);
  const targetHour = Number.isFinite(hourOverride) && hourOverride >= 0 && hourOverride <= 23
    ? hourOverride
    : new Date().getUTCHours();

  // Two query branches instead of one reassignable `let`. Supabase's
  // PostgrestFilterBuilder type narrows on each chained call, which
  // makes `let q = ...; q = q.eq(...)` reject under strict TS settings.
  // Hourly mode (or manual ?hour= test) → filter by hour. Daily mode →
  // no hour filter, so everyone with a Plus/Team plan + email receives
  // the digest at the single fire time.
  const filterByHour = isHourly || Number.isFinite(hourOverride);
  const baseQuery = supabase
    .from('users')
    .select('id, email, digest_send_hour_utc')
    .in('plan', ['plus', 'team']);
  const { data: users, error: usersErr } = filterByHour
    ? await baseQuery.eq('digest_send_hour_utc', targetHour)
    : await baseQuery;
  if (usersErr) {
    return res.status(500).json({ ok: false, error: usersErr.message });
  }
  const recipients = (users || []).filter((u: any) => u.email);

  const results: Array<{ user_id: string; email: string; status: string; reason?: string }> = [];

  for (const user of recipients) {
    try {
      const digest = await computeUserDigest(supabase, user.id, sinceIso);
      const eligibleSearches = digest.filter(
        (e) => e.top.some((c) => (c.score || 0) >= MIN_SCORE_TO_EMAIL)
      );

      if (eligibleSearches.length === 0) {
        results.push({ user_id: user.id, email: user.email, status: 'skipped', reason: 'no qualifying matches' });
        continue;
      }

      const html = renderDigestHtml({ digest: eligibleSearches });
      const text = renderDigestText({ digest: eligibleSearches });
      const subject = buildSubject(eligibleSearches);

      const send = await sendEmail({ to: user.email, subject, html, text });
      results.push({
        user_id: user.id,
        email: user.email,
        status: send.ok ? 'sent' : 'failed',
        reason: send.ok ? undefined : send.error,
      });
    } catch (e: any) {
      results.push({ user_id: user.id, email: user.email, status: 'error', reason: e?.message || 'unknown' });
    }
  }

  return res.status(200).json({
    ok: true,
    targetHourUtc: targetHour,
    windowHours: WINDOW_HOURS,
    totalUsers: recipients.length,
    sent: results.filter((r) => r.status === 'sent').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed' || r.status === 'error').length,
    results,
  });
}

// ---------- digest computation ----------

async function computeUserDigest(supabase: any, userId: string, sinceIso: string): Promise<DigestEntry[]> {
  const { data: searches } = await supabase
    .from('saved_searches')
    .select('id, name, search_url')
    .eq('user_id', userId)
    .eq('archived', false);

  if (!searches || searches.length === 0) return [];

  const searchIds = searches.map((s: any) => s.id);
  const { data: events } = await supabase
    .from('score_events')
    .select('saved_search_id, candidate_url, candidate_name, score, reasoning')
    .eq('user_id', userId)
    .in('saved_search_id', searchIds)
    .gte('scored_at', sinceIso)
    .order('score', { ascending: false })
    .limit(2000);

  // Dedupe per (saved_search_id, candidate) keeping highest score.
  const grouped = new Map<string, Map<string, DigestCandidate>>();
  for (const ev of events || []) {
    if (!ev.saved_search_id) continue;
    const key = ev.candidate_url || ev.candidate_name || '';
    if (!key) continue;
    let bucket = grouped.get(ev.saved_search_id);
    if (!bucket) {
      bucket = new Map();
      grouped.set(ev.saved_search_id, bucket);
    }
    const existing = bucket.get(key);
    if (!existing || (ev.score || 0) > (existing.score || 0)) {
      bucket.set(key, {
        candidate_url: ev.candidate_url,
        candidate_name: ev.candidate_name,
        score: ev.score || 0,
        reasoning: ev.reasoning,
      });
    }
  }

  return searches.map((s: any) => {
    const bucket = grouped.get(s.id);
    const all = bucket ? Array.from(bucket.values()) : [];
    all.sort((a, b) => (b.score || 0) - (a.score || 0));
    return {
      saved_search_id: s.id,
      saved_search_name: s.name,
      search_url: s.search_url,
      total_in_window: all.length,
      top: all.slice(0, TOP_PER_SEARCH),
    };
  });
}

// ---------- email rendering ----------

function buildSubject(digest: DigestEntry[]): string {
  const totalQualifying = digest.reduce(
    (n, e) => n + e.top.filter((c) => (c.score || 0) >= MIN_SCORE_TO_EMAIL).length,
    0
  );
  if (totalQualifying === 1) return 'Riffly digest: 1 strong match this morning';
  return `Riffly digest: ${totalQualifying} strong matches this morning`;
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDigestHtml({ digest }: { digest: DigestEntry[] }): string {
  const sections = digest
    .map((entry) => {
      const candidates = entry.top
        .filter((c) => (c.score || 0) >= MIN_SCORE_TO_EMAIL)
        .map(
          (c) => `
          <li style="margin: 0 0 14px; padding: 12px; background: #faf9f6; border: 1px solid #e7e4dc; border-radius: 8px;">
            <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;">
              <span style="display: inline-block; min-width: 32px; text-align: center; padding: 2px 8px; background: ${scoreBg(c.score)}; color: ${scoreFg(c.score)}; font-size: 12px; font-weight: 700; border-radius: 4px;">${c.score}</span>
              ${
                c.candidate_url
                  ? `<a href="${escapeHtml(c.candidate_url)}" style="color: #111; font-weight: 600; text-decoration: none;">${escapeHtml(c.candidate_name || 'Unnamed candidate')}</a>`
                  : `<span style="color: #111; font-weight: 600;">${escapeHtml(c.candidate_name || 'Unnamed candidate')}</span>`
              }
            </div>
            ${c.reasoning ? `<div style="margin-top: 6px; font-size: 13px; color: #555; line-height: 1.5;">${escapeHtml(c.reasoning)}</div>` : ''}
          </li>`
        )
        .join('');

      if (!candidates) return '';

      return `
        <section style="margin: 28px 0;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; color: #666; margin-bottom: 4px;">Saved search</div>
          <div style="font-size: 16px; font-weight: 600; color: #111; margin-bottom: 12px;">
            <a href="${escapeHtml(entry.search_url)}" style="color: #111; text-decoration: none;">${escapeHtml(entry.saved_search_name)} →</a>
          </div>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${candidates}
          </ul>
        </section>`;
    })
    .filter(Boolean)
    .join('');

  return `<!doctype html>
<html>
<body style="margin: 0; padding: 0; background: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111; line-height: 1.55;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 20px;">
    <div style="font-size: 13px; color: #888; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 8px;">Riffly · Daily Digest</div>
    <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em;">Today's top matches.</h1>
    <p style="font-size: 14px; color: #555; margin: 0 0 8px;">From your saved LinkedIn searches in the last 24 hours, scored against your active job specs.</p>
    ${sections}
    <hr style="border: none; border-top: 1px solid #e7e4dc; margin: 32px 0;">
    <p style="font-size: 12px; color: #888; margin: 0 0 8px;">
      <a href="https://rifflylabs.com/dashboard" style="color: #111;">Open dashboard</a>
      &nbsp;·&nbsp;
      <a href="https://rifflylabs.com/dashboard#digest-prefs" style="color: #888;">Email preferences</a>
    </p>
    <p style="font-size: 11px; color: #aaa; margin: 0;">You're receiving this because you have an active Riffly Plus subscription with at least one tracked LinkedIn search. Reply to this email to reach the team.</p>
  </div>
</body>
</html>`;
}

function renderDigestText({ digest }: { digest: DigestEntry[] }): string {
  const lines: string[] = [];
  lines.push('Riffly · Daily Digest');
  lines.push("Today's top matches from your saved LinkedIn searches.");
  lines.push('');
  for (const entry of digest) {
    const filtered = entry.top.filter((c) => (c.score || 0) >= MIN_SCORE_TO_EMAIL);
    if (filtered.length === 0) continue;
    lines.push(`== ${entry.saved_search_name} ==`);
    lines.push(entry.search_url);
    lines.push('');
    for (const c of filtered) {
      lines.push(`  [${c.score}] ${c.candidate_name || 'Unnamed candidate'}`);
      if (c.candidate_url) lines.push(`       ${c.candidate_url}`);
      if (c.reasoning) lines.push(`       ${c.reasoning}`);
      lines.push('');
    }
  }
  lines.push('---');
  lines.push('Open dashboard: https://rifflylabs.com/dashboard');
  return lines.join('\n');
}

function scoreBg(score: number): string {
  if (score >= 70) return '#e7f4ec';
  if (score >= 50) return '#fff8eb';
  return '#f3f0e8';
}
function scoreFg(score: number): string {
  if (score >= 70) return '#1a7a48';
  if (score >= 50) return '#6b4a14';
  return '#666';
}
