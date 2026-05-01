-- Stripe webhook idempotency log. Stripe retries webhooks aggressively
-- on any non-2xx response; without a dedup table we'd re-process the
-- same event.id repeatedly, re-running plan updates and firing
-- notification emails twice.
--
-- The webhook handler INSERTs the row at the top of the request. If the
-- row already exists (Postgres error 23505), the handler returns 200
-- immediately. This is bulletproof against retries.
--
-- We never delete from this table — Stripe event IDs are immutable and
-- retention is cheap. A future cleanup cron can prune entries older
-- than 90 days if the table grows past a few million rows.

create table if not exists public.webhook_events (
  id           text         primary key,    -- Stripe event.id
  type         text         not null,        -- e.g. 'checkout.session.completed'
  processed_at timestamptz  not null default now(),
  result       jsonb
);

create index if not exists webhook_events_processed_at_idx
  on public.webhook_events(processed_at desc);

alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
