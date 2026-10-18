-- Network Watch: step 2. Creates NEW tables only (all prefixed nw_). Nothing is dropped or altered.
-- Safe to re-run: every statement uses IF NOT EXISTS.

create table if not exists public.nw_hubs (
  code text primary key,                 -- e.g. DEL, JAI (must match the app's hub codes)
  name text not null,
  lat double precision, lon double precision,
  capacity_per_day integer,              -- sort/processing capacity, parcels per day
  is_sample boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.nw_lanes (
  id bigserial primary key,
  origin_code text not null references public.nw_hubs(code),
  dest_code text not null references public.nw_hubs(code),
  capacity_per_day integer,              -- line-haul capacity, parcels per day
  volume_per_day integer,                -- planned volume, parcels per day
  road_km numeric,
  transit_hours numeric,
  is_sample boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (origin_code, dest_code)
);

create table if not exists public.nw_orders (
  order_id text primary key,
  origin_code text not null, dest_code text not null,   -- lane the order is moving on
  parcels integer not null default 1,
  sla_tier text not null default 'standard' check (sla_tier in ('critical','standard')),
  status text not null default 'in_transit',             -- rows with status 'delivered' are ignored
  promised_at timestamptz, eta_at timestamptz,
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists nw_orders_lane_idx on public.nw_orders (origin_code, dest_code) where status <> 'delivered';

create table if not exists public.nw_temp_capacity (
  id bigserial primary key,
  hub_code text references public.nw_hubs(code),
  kind text not null check (kind in ('shift','vehicle')), -- extra sort shift / hired market trucks
  capacity_parcels integer,
  activation_hours numeric,
  cost_per_parcel numeric,
  available boolean not null default true,
  is_sample boolean not null default false
);

create table if not exists public.nw_traffic_observations (
  id bigserial primary key,
  lane_key text not null, travel_min integer, free_flow_min integer, delay_min integer,
  road_events jsonb, source text, observed_at timestamptz not null default now()
);

create table if not exists public.nw_weather_observations (
  id bigserial primary key,
  hub_code text not null, gust_mph numeric, rain_mm_h numeric, visibility_m numeric, weather_code integer,
  source text, observed_at timestamptz not null default now()
);

create table if not exists public.nw_recovery_plans (
  id bigserial primary key,
  region text, scenario text, route_from text, route_to text,
  actions jsonb, currency text, incremental_cost numeric,
  on_time integer, revised_promise integer, still_late integer, parcels_at_risk integer,
  alternatives jsonb, facts jsonb, data_sources jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.nw_decisions (
  id bigserial primary key,
  plan_id bigint references public.nw_recovery_plans(id),
  decision text not null check (decision in ('approved','rejected')),
  approver text, note text,
  outcome text,                          -- fill in later if the real outcome is known
  decided_at timestamptz not null default now()
);

-- Row level security. The app's server routes prefer the service-role key (which bypasses RLS).
-- These policies let the app also work with the anon/publishable key: read network data, write logs and decisions.
alter table public.nw_hubs enable row level security;
alter table public.nw_lanes enable row level security;
alter table public.nw_orders enable row level security;
alter table public.nw_temp_capacity enable row level security;
alter table public.nw_traffic_observations enable row level security;
alter table public.nw_weather_observations enable row level security;
alter table public.nw_recovery_plans enable row level security;
alter table public.nw_decisions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['nw_hubs','nw_lanes','nw_orders','nw_temp_capacity','nw_recovery_plans','nw_decisions','nw_traffic_observations','nw_weather_observations'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_read') then
      execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t||'_read', t);
    end if;
  end loop;
  foreach t in array array['nw_recovery_plans','nw_decisions','nw_traffic_observations','nw_weather_observations'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_insert') then
      execute format('create policy %I on public.%I for insert to anon, authenticated with check (true)', t||'_insert', t);
    end if;
  end loop;
end $$;
