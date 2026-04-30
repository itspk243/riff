-- Riffly: Saved-Search scan-cadence — Plus tier Phase 2.1.
--
-- Adds a per-search cadence column so users can throttle how often Riffly
-- scans (and burns Claude tokens against) each saved search.
--
-- Cadence values:
--   manual     — only scan when the user clicks the button (default)
--   on_visit   — scan every time the user is on the search URL
--   thrice_daily — auto-scan once per ~8h
--   daily      — auto-scan once per 24h
--   weekly     — auto-scan once per 7d
--
-- The /api/saved-searches/scan endpoint enforces the cadence by comparing
-- last_scanned_at against now(); the popup auto-triggers (or shows
-- "next scan in X") accordingly.
--
-- Run via Supabase SQL editor. Idempotent — safe to re-run.

alter table public.saved_searches
  add column if not exists scan_cadence text not null default 'manual';

-- Drop the old check constraint if it exists (so we can update the allowed
-- value list without conflict on re-run). Then add the current one.
alter table public.saved_searches
  drop constraint if exists saved_searches_scan_cadence_check;

alter table public.saved_searches
  add constraint saved_searches_scan_cadence_check
  check (scan_cadence in ('manual', 'on_visit', 'thrice_daily', 'daily', 'weekly'));

-- Verify
-- select column_name, data_type, column_default from information_schema.columns
-- where table_name = 'saved_searches' and column_name = 'scan_cadence';
