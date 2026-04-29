-- Riffly: Saved-Search Daily Digest — Plus tier Phase 2.
--
-- The architectural premise: LinkedIn search pages stay client-side. The
-- extension scrapes whatever search results the user is actively viewing,
-- POSTs them to /api/saved-searches/scan, and we score against the user's
-- active job specs. Same no-automation guarantee as Active Profile Assist —
-- nothing happens unless the user is on the page.
--
-- Two new things:
--   saved_searches             — the search URLs a Plus user wants to track
--   score_events.saved_search_id — tag scoring runs to a search for digest UI
--
-- Run via Supabase SQL editor. Idempotent — safe to re-run.

-- ----------------------------------------------------------------------
-- saved_searches
-- ----------------------------------------------------------------------
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- Short label the user picks; shown in the dashboard digest card.
  name text not null,
  -- The full LinkedIn search URL. We don't try to parse the search params —
  -- LinkedIn changes them periodically. Just store and re-render.
  search_url text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Bump every time the extension reports results for this search. Lets the
  -- dashboard surface "scanned 3 hours ago" without scanning all events.
  last_scanned_at timestamptz,

  constraint saved_searches_name_len check (char_length(name) between 1 and 80),
  constraint saved_searches_url_len check (char_length(search_url) between 10 and 2000),
  constraint saved_searches_url_shape check (search_url like 'https://%linkedin.com/%')
);

create index if not exists saved_searches_user_active_idx
  on public.saved_searches(user_id, archived);

alter table public.saved_searches enable row level security;
drop policy if exists "owner can read" on public.saved_searches;
create policy "owner can read" on public.saved_searches
  for select using (auth.uid() = user_id);
drop policy if exists "owner can write" on public.saved_searches;
create policy "owner can write" on public.saved_searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------
-- score_events: tag rows to the saved_search that produced them
-- ----------------------------------------------------------------------
alter table public.score_events
  add column if not exists saved_search_id uuid references public.saved_searches(id) on delete set null;

create index if not exists score_events_saved_search_idx
  on public.score_events(saved_search_id, scored_at desc)
  where saved_search_id is not null;

-- Verify
-- select column_name, data_type from information_schema.columns
-- where table_name = 'saved_searches' order by ordinal_position;
