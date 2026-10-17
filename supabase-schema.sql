-- Run in the Supabase SQL Editor for the Network Watch project.
-- Prototype stores scenario snapshots. Never expose SUPABASE_SERVICE_ROLE_KEY in browser code.
create table if not exists public.scenario_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_key text not null,
  scenario_name text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists scenario_runs_created_at_idx on public.scenario_runs (created_at desc);

-- This prototype writes through a server-side service-role key, so browser RLS access is not needed.
-- Enable RLS and deny anonymous/authenticated access unless you intentionally add authenticated user flows.
alter table public.scenario_runs enable row level security;
revoke all on public.scenario_runs from anon, authenticated;
