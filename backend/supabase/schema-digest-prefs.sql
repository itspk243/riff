-- Riffly: Per-user digest send-time preference.
--
-- Adds an integer 0–23 column for the UTC hour the user wants their daily
-- Saved-Search Digest email. Default = 8 (08:00 UTC) so existing users keep
-- their current behavior with no migration of values.
--
-- The /api/cron/daily-digest endpoint filters recipients by:
--    digest_send_hour_utc = current_hour_utc()
-- so the cron must invoke once per hour to cover all 24 buckets. Vercel
-- Hobby caps cron at daily frequency — wire an hourly external pinger
-- (cron-job.org / EasyCron) hitting the endpoint with Bearer CRON_SECRET,
-- or upgrade the Vercel project to Pro for hourly cron.
--
-- Run via Supabase SQL editor. Idempotent — safe to re-run.

alter table public.users
  add column if not exists digest_send_hour_utc int not null default 8;

-- Drop and re-add CHECK in case the previous bound was different.
alter table public.users
  drop constraint if exists users_digest_send_hour_utc_check;

alter table public.users
  add constraint users_digest_send_hour_utc_check
  check (digest_send_hour_utc between 0 and 23);

-- Verify
-- select column_name, data_type, column_default from information_schema.columns
-- where table_name = 'users' and column_name = 'digest_send_hour_utc';
