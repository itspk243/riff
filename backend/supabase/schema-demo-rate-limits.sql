-- Demo rate-limit counters. Persistent replacement for the in-memory
-- counter used by /api/demo-generate, which reset on every Vercel cold
-- start and let bursts of demo abuse slip through during deploys.
--
-- Two scopes:
--   scope='ip'     bucket=<sha256(ip + RIFF_IP_SALT)>   per-IP daily count
--   scope='global' bucket='all'                          global daily count
--
-- A row is one (scope, bucket, day) triple. We never store raw IPs —
-- only their salted hash, so a leak of this table can't link back to
-- individual visitors.
--
-- RLS is enabled and locked. Only the service-role key (server-side)
-- ever writes here.

create table if not exists public.demo_rate_limits (
  scope       text         not null check (scope in ('ip', 'global')),
  bucket      text         not null,
  day         date         not null,
  count       int          not null default 0,
  updated_at  timestamptz  not null default now(),
  primary key (scope, bucket, day),
  constraint demo_rate_limits_count_nonneg check (count >= 0)
);

-- Index for the periodic cleanup job (delete rows older than 30 days).
-- Cheap because day is a date column.
create index if not exists demo_rate_limits_day_idx
  on public.demo_rate_limits(day);

alter table public.demo_rate_limits enable row level security;

-- No public policies. Service role bypasses RLS, so the API can read +
-- write. Anonymous and authenticated roles see nothing.
revoke all on public.demo_rate_limits from anon, authenticated;
