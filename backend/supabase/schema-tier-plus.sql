-- Riff: add 'plus' tier to users.plan check constraint.
-- Run via Supabase SQL editor. Idempotent — safe to re-run.

-- The original schema constrains plan to ('free', 'pro', 'team').
-- We're adding 'plus' for the $19.99/mo tier with agentic features
-- (Active Profile Assist + Saved-Search Daily Digest).

alter table public.users
  drop constraint if exists users_plan_check;

alter table public.users
  add constraint users_plan_check
  check (plan in ('free', 'pro', 'plus', 'team'));

-- Verify
-- select column_name, data_type from information_schema.columns where table_name = 'users';
