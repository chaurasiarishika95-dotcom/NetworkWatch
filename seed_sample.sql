-- Network Watch: step 3 (optional). SAMPLE data for development, every row marked is_sample = true.
-- This is invented data, not real operational data. The app labels it "Supabase (rows marked as sample data)".
-- Re-running is safe: existing rows with the same keys are left untouched.
-- To remove it later:  delete from nw_orders where is_sample; delete from nw_temp_capacity where is_sample;
--                      delete from nw_lanes where is_sample; delete from nw_hubs where is_sample;

insert into public.nw_hubs (code, name, lat, lon, capacity_per_day, is_sample) values
  ('ATQ', 'Amritsar', 31.63, 74.87, 3500, true),
  ('LDH', 'Ludhiana', 30.9, 75.85, 11600, true),
  ('CHD', 'Chandigarh', 30.73, 76.78, 12900, true),
  ('DED', 'Dehradun', 30.32, 78.03, 8300, true),
  ('DEL', 'Delhi NCR', 28.61, 77.21, 39300, true),
  ('MRT', 'Meerut', 28.98, 77.71, 10800, true),
  ('BLY', 'Bareilly', 28.37, 79.43, 12300, true),
  ('ALW', 'Alwar', 27.55, 76.6, 5100, true),
  ('JAI', 'Jaipur', 26.91, 75.79, 16500, true),
  ('AJM', 'Ajmer', 26.45, 74.64, 3400, true),
  ('ALG', 'Aligarh', 27.88, 78.08, 8900, true),
  ('AGR', 'Agra', 27.18, 78.01, 24800, true),
  ('GWL', 'Gwalior', 26.22, 78.18, 5300, true),
  ('KNP', 'Kanpur', 26.45, 80.33, 13500, true),
  ('LKO', 'Lucknow', 26.85, 80.95, 18800, true),
  ('PRG', 'Prayagraj', 25.44, 81.85, 9400, true),
  ('VNS', 'Varanasi', 25.32, 82.97, 7100, true)
on conflict (code) do nothing;

insert into public.nw_lanes (origin_code, dest_code, capacity_per_day, volume_per_day, road_km, transit_hours, is_sample) values
  ('DEL', 'CHD', 7000, 5000, 245, 5.4, true),
  ('CHD', 'LDH', 5000, 3400, 100, 2.2, true),
  ('LDH', 'ATQ', 4000, 2800, 140, 3.1, true),
  ('DEL', 'LDH', 4500, 3100, 310, 6.9, true),
  ('CHD', 'DED', 3000, 1900, 170, 3.8, true),
  ('DEL', 'DED', 4000, 2700, 250, 5.6, true),
  ('DEL', 'MRT', 6000, 4300, 75, 1.7, true),
  ('MRT', 'DED', 3000, 2000, 170, 3.8, true),
  ('MRT', 'BLY', 3500, 2300, 210, 4.7, true),
  ('DEL', 'BLY', 4000, 2900, 250, 5.6, true),
  ('BLY', 'LKO', 4500, 3100, 250, 5.6, true),
  ('DEL', 'JAI', 8000, 5900, 280, 6.2, true),
  ('DEL', 'ALW', 3500, 2100, 160, 3.6, true),
  ('ALW', 'JAI', 3500, 2000, 150, 3.3, true),
  ('JAI', 'AJM', 4000, 2700, 135, 3.0, true),
  ('JAI', 'AGR', 4000, 2600, 240, 5.3, true),
  ('DEL', 'AGR', 8000, 6100, 230, 5.1, true),
  ('DEL', 'ALG', 4500, 3000, 140, 3.1, true),
  ('ALG', 'AGR', 4000, 2600, 85, 1.9, true),
  ('ALG', 'BLY', 2500, 1500, 180, 4.0, true),
  ('AGR', 'GWL', 4000, 2700, 120, 2.7, true),
  ('AGR', 'LKO', 7000, 5000, 335, 7.4, true),
  ('AGR', 'KNP', 4000, 2600, 280, 6.2, true),
  ('GWL', 'KNP', 2500, 1500, 260, 5.8, true),
  ('KNP', 'LKO', 6000, 4300, 90, 2.0, true),
  ('LKO', 'VNS', 4500, 3100, 300, 6.7, true),
  ('KNP', 'PRG', 4500, 3000, 200, 4.4, true),
  ('PRG', 'VNS', 4000, 2600, 125, 2.8, true),
  ('LKO', 'PRG', 3000, 1900, 200, 4.4, true)
on conflict (origin_code, dest_code) do nothing;

insert into public.nw_temp_capacity (hub_code, kind, capacity_parcels, activation_hours, cost_per_parcel, is_sample)
select * from (values
  ('ATQ', 'shift', 1100, 3, 9, true),
  ('LDH', 'shift', 3500, 3, 9, true),
  ('CHD', 'shift', 3900, 3, 9, true),
  ('DED', 'shift', 2500, 3, 9, true),
  ('DEL', 'shift', 11800, 3, 9, true),
  ('MRT', 'shift', 3200, 3, 9, true),
  ('BLY', 'shift', 3700, 3, 9, true),
  ('ALW', 'shift', 1500, 3, 9, true),
  ('JAI', 'shift', 5000, 3, 9, true),
  ('AJM', 'shift', 1000, 3, 9, true),
  ('ALG', 'shift', 2700, 3, 9, true),
  ('AGR', 'shift', 7400, 3, 9, true),
  ('GWL', 'shift', 1600, 3, 9, true),
  ('KNP', 'shift', 4100, 3, 9, true),
  ('LKO', 'shift', 5600, 3, 9, true),
  ('PRG', 'shift', 2800, 3, 9, true),
  ('VNS', 'shift', 2100, 3, 9, true),
  (null, 'vehicle', null, 5, 16, true)
) v(hub_code, kind, capacity_parcels, activation_hours, cost_per_parcel, is_sample)
where not exists (select 1 from public.nw_temp_capacity where is_sample);

-- About 60 order batches per lane, ~30% SLA-critical, promise slack spread from 0 to 30 hours.
select setseed(0.42);
insert into public.nw_orders (order_id, origin_code, dest_code, parcels, sla_tier, status, promised_at, eta_at, is_sample)
select 'S-' || l.origin_code || '-' || l.dest_code || '-' || g,
       l.origin_code, l.dest_code, greatest(1, l.volume_per_day / 60),
       case when random() < 0.3 then 'critical' else 'standard' end, 'in_transit',
       now() + interval '1 hour' * (6 + s.slack), now() + interval '6 hours', true
from public.nw_lanes l
cross join generate_series(1, 60) g
cross join lateral (select power(random(), 1.6) * 30 + 0 * g as slack) s
where l.is_sample
on conflict (order_id) do nothing;
