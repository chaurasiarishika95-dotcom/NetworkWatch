# Network Watch operational optimizer patch

- Restores intervention-combination optimizer: divert overflow to available lanes, add only configured temporary hub capacity, prioritize SLA-critical orders, and adjust eligible promises by up to one day.
- Keeps the North India route topology, Open-Meteo weather, TomTom traffic routing/map overlay, Gemini copilot, and Supabase scenario history.
- Persists live weather and route/traffic observations to `network_observations` when Supabase is configured.
- Reads delivery orders, lane loads/capacity/rates, hub operating metrics and intervention costs from Supabase operational tables.
- Adds blank CSV templates for authorized real records; no fake delivery orders, lane metrics, capacity, cost, or SLA records are seeded.
- Corrects Open-Meteo local timestamps for Asia/Kolkata when writing observation timestamps to Supabase.
- Filters Supabase delivery-order retrieval by selected origin/destination to reduce unnecessary data reads.

## Data readiness

The operational recovery endpoint deliberately returns an import/setup checklist until required Supabase tables and lane/order records are present. After importing authorised data, use a representative journey and compare counts shown by the API to the Supabase tables before relying on cost or SLA estimates.
