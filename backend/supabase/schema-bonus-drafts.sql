-- Riff: bonus drafts + roast-share tracking.
-- Run via Supabase SQL editor. Idempotent — safe to re-run.
--
-- bonus_drafts: int counter, defaults to 0. Added to the user's effective
-- monthly draft limit. Awarded via /api/roast-share when a signed-in user
-- shares their first /roast result. Decrement-on-use is left for a future
-- migration; for the launch promo we accept that the bonus may persist
-- across calendar months until consumed.
--
-- roast_shared_at: timestamp of when the user first shared a roast. NULL
-- means they have not yet shared. Used by /api/roast-share to gate the
-- one-time bonus award.

alter table public.users
  add column if not exists bonus_drafts int not null default 0;

alter table public.users
  add column if not exists roast_shared_at timestamptz;

-- Defensive: bonus_drafts should never go negative. The /api/generate
-- decrement path uses a guarded update, but a CHECK adds a second layer.
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'users' and column_name = 'bonus_drafts'
      and constraint_name = 'users_bonus_drafts_nonneg'
  ) then
    alter table public.users
      add constraint users_bonus_drafts_nonneg check (bonus_drafts >= 0);
  end if;
end $$;
