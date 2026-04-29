-- Riff: Active Profile Assist — Phase 1 schema.
--
-- Two new tables:
--   job_specs    — what a Plus user is hiring for. Their saved descriptions.
--   score_events — every fit-score we compute, for cost accounting + future
--                  caching (same profile + same spec → recent score → reuse).
--
-- Run via Supabase SQL editor. Idempotent — safe to re-run.

-- ----------------------------------------------------------------------
-- job_specs
-- ----------------------------------------------------------------------
create table if not exists public.job_specs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- short, human label shown in chip rows. Cap mirrors saved_templates.name.
  name text not null,
  -- the actual hiring criteria. Free-form text; the LLM does the parsing.
  description text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint job_specs_name_len check (char_length(name) between 1 and 80),
  constraint job_specs_desc_len check (char_length(description) between 1 and 5000)
);

create index if not exists job_specs_user_active_idx
  on public.job_specs(user_id, archived);

alter table public.job_specs enable row level security;
-- Service role (used by API) bypasses RLS, so policies are defense-in-depth
-- against accidental anon access.
drop policy if exists "owner can read" on public.job_specs;
create policy "owner can read" on public.job_specs
  for select using (auth.uid() = user_id);
drop policy if exists "owner can write" on public.job_specs;
create policy "owner can write" on public.job_specs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------
-- score_events — log every score we compute
-- ----------------------------------------------------------------------
create table if not exists public.score_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  job_spec_id uuid references public.job_specs(id) on delete set null,
  candidate_url text,
  candidate_name text,
  score smallint,
  reasoning text,
  matched jsonb,
  missing jsonb,
  scored_at timestamptz not null default now(),

  constraint score_events_score_range check (score is null or (score between 0 and 100))
);

create index if not exists score_events_user_recent_idx
  on public.score_events(user_id, scored_at desc);
create index if not exists score_events_candidate_idx
  on public.score_events(user_id, candidate_url, scored_at desc);

alter table public.score_events enable row level security;
drop policy if exists "owner can read events" on public.score_events;
create policy "owner can read events" on public.score_events
  for select using (auth.uid() = user_id);

-- Verify
-- select table_name, column_name, data_type from information_schema.columns
-- where table_name in ('job_specs', 'score_events') order by table_name, ordinal_position;
