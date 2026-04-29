-- Riff Day 1 schema migration.
-- Run via Supabase SQL editor on the existing 'riff' project.
-- Idempotent — safe to re-run.

-- ============================================================
-- saved_templates
-- ============================================================
-- Per-user saved pitches. Recruiters often re-use the same 3–5
-- pitches across hundreds of messages. Storing them on the server
-- means they sync across devices and survive extension reinstalls.

create table if not exists public.saved_templates (
  id          bigserial primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  name        text not null,
  pitch       text not null,
  purpose     text not null default 'hire' check (purpose in ('hire','refer','network','ask','advisor')),
  created_at  timestamptz not null default now()
);

create index if not exists saved_templates_user_idx
  on public.saved_templates (user_id, created_at desc);

alter table public.saved_templates enable row level security;

drop policy if exists "saved_templates self read"   on public.saved_templates;
drop policy if exists "saved_templates self write"  on public.saved_templates;
drop policy if exists "saved_templates self delete" on public.saved_templates;

create policy "saved_templates self read" on public.saved_templates
  for select using (auth.uid() = user_id);

-- (no insert/update/delete via RLS — service role mutates from API routes)

-- ============================================================
-- events
-- ============================================================
-- Per-candidate timeline. Records when a user marks a draft as
-- sent/replied. Lets us detect "have I talked to this person?" on
-- popup re-open, and aggregate reply rates server-side for
-- cross-device stats.

create table if not exists public.events (
  id              bigserial primary key,
  user_id         uuid not null references public.users(id) on delete cascade,
  candidate_url   text not null,
  candidate_name  text,
  variant_type    text not null check (variant_type in ('cold_opener','follow_up','breakup')),
  tone            text,
  length_label    text,
  kind            text not null check (kind in ('sent','replied')),
  created_at      timestamptz not null default now()
);

create index if not exists events_user_candidate_idx
  on public.events (user_id, candidate_url, created_at desc);

create index if not exists events_user_kind_time_idx
  on public.events (user_id, kind, created_at desc);

alter table public.events enable row level security;

drop policy if exists "events self read" on public.events;

create policy "events self read" on public.events
  for select using (auth.uid() = user_id);

-- ============================================================
-- Verify
-- ============================================================
-- After running, the dashboard should be able to:
--   select count(*) from public.saved_templates;  -- 0 to start
--   select count(*) from public.events;           -- 0 to start
