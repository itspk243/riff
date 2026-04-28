-- Riff Supabase schema. Run via Supabase SQL editor on a fresh project.

create extension if not exists "uuid-ossp";

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create table public.usage (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  variants int not null default 3,
  generated_at timestamptz not null default now()
);

create index usage_user_time_idx on public.usage (user_id, generated_at desc);

-- Row Level Security: users can read their own row, but only the service role can mutate.
alter table public.users enable row level security;
alter table public.usage enable row level security;

create policy "users self read" on public.users
  for select using (auth.uid() = id);
-- (no insert/update policies — only service role writes)

create policy "usage self read" on public.usage
  for select using (auth.uid() = user_id);
