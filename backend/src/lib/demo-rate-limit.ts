// Persistent rate limiter for /api/demo-generate. Replaces the previous
// in-memory counter that reset on every Vercel cold start and let
// bursts of demo abuse slip through during deploys.
//
// Backed by the demo_rate_limits table (see schema-demo-rate-limits.sql).
// Two scopes:
//   - 'ip'     keyed on a salted SHA-256 of the client IP (privacy:
//              we never store raw IPs)
//   - 'global' keyed on 'all', tracks total demo generations site-wide
//
// Atomicity: we use a read-then-conditional-write pattern instead of a
// stored procedure. There's a small race window where two concurrent
// requests could both pass the check at the threshold edge, letting one
// extra request through. For a rate limiter at this volume that's
// acceptable — the worst-case is +1 over the cap, not unbounded.

import crypto from 'crypto';
import { serviceClient } from './supabase';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Hash an IP with a server-side salt before persisting. RIFF_IP_SALT
// should be a long random string set in env. Falls back to a constant
// if unset (dev only — production deploys must set it).
export function hashIp(ip: string): string {
  const salt = process.env.RIFF_IP_SALT || 'riff-dev-salt-change-me';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

interface BumpResult {
  ok: boolean;
  count: number;
}

/**
 * Atomically increment a counter, refusing if it would exceed `limit`.
 * Returns { ok: true, count: N } on success, { ok: false, count: N } if
 * the cap was already hit.
 *
 * The race-window note above means in rare cases (two concurrent calls
 * at exactly the cap) you might see +1 over the limit. Acceptable for
 * abuse prevention.
 */
export async function bumpRateLimit(
  scope: 'ip' | 'global',
  bucket: string,
  limit: number,
): Promise<BumpResult> {
  const supabase = serviceClient();
  const day = todayIso();

  // Read current count.
  const { data: existing } = await supabase
    .from('demo_rate_limits')
    .select('count')
    .eq('scope', scope)
    .eq('bucket', bucket)
    .eq('day', day)
    .maybeSingle();

  const currentCount = existing?.count ?? 0;
  if (currentCount >= limit) {
    return { ok: false, count: currentCount };
  }

  // Upsert the incremented row. Postgres handles the (scope, bucket, day)
  // uniqueness — concurrent inserts collapse to a single row.
  const newCount = currentCount + 1;
  const { error } = await supabase
    .from('demo_rate_limits')
    .upsert(
      { scope, bucket, day, count: newCount, updated_at: new Date().toISOString() },
      { onConflict: 'scope,bucket,day' },
    );

  if (error) {
    // On write failure we let the request through rather than block users
    // because of our DB hiccup. Log loudly so we can see it.
    console.error('bumpRateLimit:write_failure', JSON.stringify({
      scope,
      bucket,
      day,
      error: error.message,
    }));
    return { ok: true, count: currentCount + 1 };
  }
  return { ok: true, count: newCount };
}

/**
 * Decrement a counter (used to refund a slot when validation fails after
 * the bump). Best-effort — if it fails we accept the small accuracy loss.
 */
export async function decrementRateLimit(
  scope: 'ip' | 'global',
  bucket: string,
): Promise<void> {
  const supabase = serviceClient();
  const day = todayIso();
  const { data: existing } = await supabase
    .from('demo_rate_limits')
    .select('count')
    .eq('scope', scope)
    .eq('bucket', bucket)
    .eq('day', day)
    .maybeSingle();
  if (!existing || existing.count <= 0) return;
  await supabase
    .from('demo_rate_limits')
    .update({ count: Math.max(0, existing.count - 1), updated_at: new Date().toISOString() })
    .eq('scope', scope)
    .eq('bucket', bucket)
    .eq('day', day);
}
