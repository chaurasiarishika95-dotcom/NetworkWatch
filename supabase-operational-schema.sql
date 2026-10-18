-- Network Watch operational data schema.
-- This creates tables only: it does NOT seed invented orders, capacities, costs, or KPIs.
-- Fill with authorised, appropriately minimised operational extracts before enabling order-level optimization.

create table if not exists public.delivery_orders (
  order_id text primary key,
  origin_hub text not null,
  destination_hub text not null,
  current_lane_key text,
  parcel_count integer not null default 1 check (parcel_count > 0),
  status text not null default 'in_transit',
  priority_class text not null default 'standard',
  planned_departure_at timestamptz,
  promised_delivery_at timestamptz,
  current_eta_at timestamptz,
  current_route_duration_minutes integer,
  updated_at timestamptz not null default now()
);
create index if not exists delivery_orders_od_status_idx
  on public.delivery_orders (origin_hub, destination_hub, status);
create index if not exists delivery_orders_lane_idx
  on public.delivery_orders (current_lane_key, status);
create index if not exists delivery_orders_eta_idx
  on public.delivery_orders (promised_delivery_at, current_eta_at);
alter table public.delivery_orders enable row level security;
revoke all on public.delivery_orders from anon, authenticated;

create table if not exists public.lane_operating_metrics (
  lane_key text primary key,
  from_hub text not null,
  to_hub text not null,
  capacity_parcels_per_day integer not null check (capacity_parcels_per_day >= 0),
  current_volume_parcels_per_day integer not null check (current_volume_parcels_per_day >= 0),
  transport_cost_per_parcel_inr numeric(12,4) not null check (transport_cost_per_parcel_inr >= 0),
  average_transit_minutes integer,
  delay_minutes_per_100_over_capacity numeric(12,4),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.lane_operating_metrics enable row level security;
revoke all on public.lane_operating_metrics from anon, authenticated;

create table if not exists public.hub_operating_metrics (
  hub_id text primary key,
  throughput_capacity_parcels_per_day integer not null check (throughput_capacity_parcels_per_day >= 0),
  current_load_parcels_per_day integer not null check (current_load_parcels_per_day >= 0),
  temporary_capacity_parcels_per_day integer not null default 0 check (temporary_capacity_parcels_per_day >= 0),
  temporary_capacity_cost_per_parcel_inr numeric(12,4),
  updated_at timestamptz not null default now()
);
alter table public.hub_operating_metrics enable row level security;
revoke all on public.hub_operating_metrics from anon, authenticated;

create table if not exists public.intervention_costs (
  action_key text primary key check (action_key in ('divert', 'temporary_capacity', 'prioritize_sla', 'promise_adjustment')),
  cost_per_parcel_inr numeric(12,4),
  cost_per_order_inr numeric(12,4),
  customer_impact_penalty_per_order_inr numeric(12,4),
  enabled boolean not null default true,
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.intervention_costs enable row level security;
revoke all on public.intervention_costs from anon, authenticated;

-- Existing API server reads via SUPABASE_SERVICE_ROLE_KEY. Never expose that key in browser code.
-- Do not insert sample delivery orders. Import authorised records without customer names, phones, addresses, or other unnecessary PII.
