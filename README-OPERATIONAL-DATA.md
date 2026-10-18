# Network Watch — Operational Recovery Optimizer

This patch ports the original Network Watch intervention-combination planner into the current North India hub journey while keeping the existing traffic, weather, Gemini and Supabase flows.

## Important data boundary

The application does **not** create sample delivery orders, lane volumes, transport rates, temporary capacity or SLA outcomes. Weather is fetched from Open-Meteo. Road routes/traffic estimates are fetched from TomTom when configured, with OSRM as a non-live-traffic fallback. Live external observations are written to `network_observations` if the table and Supabase server credentials are configured.

The route network (hub coordinates/topology and scenario overlays) remains a configured portfolio model. For order-level recovery costs and late/on-time projections, the optimizer reads operational rows from Supabase. Until valid rows are imported, the API returns a setup checklist and withholds order-level outcomes instead of inventing numbers.

## Files in the patch

Copy these files to the same paths in your existing Next.js repository:

- `app/page.js`
- `app/globals.css`
- `app/api/route-analysis/route.js`
- `app/api/recovery-plan/route.js`
- `app/api/road-route/route.js`
- `app/api/traffic-tile/[z]/[x]/[y]/route.js`
- `app/api/weather/route.js`
- `app/api/explain/route.js`
- `app/api/scenarios/route.js`
- `lib/network.js`
- `lib/road-routing.js`
- `lib/supabase-observations.js`
- `lib/supabase-operations.js`

This is a changed-files patch, not a complete application. Do not replace your `package.json`, `next.config.*`, `.git` directory, or any project settings.

## Supabase setup

1. In Supabase SQL Editor, run `supabase-final-schema.sql` if you have not already created `network_observations` and `scenario_runs`. It uses `CREATE TABLE IF NOT EXISTS`, so it is safe to re-run for these tables.
2. Run `supabase-operational-schema.sql` to create `delivery_orders`, `lane_operating_metrics`, `hub_operating_metrics`, and `intervention_costs`. This schema creates empty tables and **does not seed fake rows**.
3. In Supabase Table Editor, import authorised data using the four CSV templates in `templates/`. Each CSV currently contains headers only; populate it with your real authorised operational extract before importing.
4. In Vercel Production environment variables, retain `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key must remain server-side and must never use a `NEXT_PUBLIC_` prefix.
5. Redeploy after adding/replacing code or environment variables.

### Required operational records

- `delivery_orders`: one row per order or order batch using a pseudonymous/internal order identifier. Do not import customer names, telephone numbers, detailed delivery addresses, or other unnecessary personal data. The selected journey must match `origin_hub` and `destination_hub`; `current_lane_key` must map to the current leg in the configured North India graph. Use `promised_delivery_at` and `current_eta_at` to enable estimated on-time/late calculations.
- `lane_operating_metrics`: import current capacity, current daily volume and actual transport cost for every configured modelled lane before relying on the optimizer. The canonical lane keys are:

  `DEL-CHD`, `CHD-LUD`, `DEL-LUD`, `DEL-BHW`, `BHW-JAI`, `DEL-JAI`, `DEL-AGR`, `JAI-AGR`, `AGR-GWL`, `AGR-KNP`, `KNP-LKO`, `AGR-LKO`, `LKO-VAR`, `KNP-VAR`, `GWL-KNP`, `JAI-AJM`, `DEL-GWL`, `CHD-DEL`, `LUD-CHD`, `VAR-LKO`, `BHW-AGR`, `AJM-BHW`.

  The current graph treats configured edges as bidirectional. If actual capacities, rates or active status differ by direction, the data model/graph must be made directional before using those records for operational decisions.
- `hub_operating_metrics`: import actual hub throughput/load. Add `temporary_capacity_parcels_per_day` and `temporary_capacity_cost_per_parcel_inr` only where temporary capacity is genuinely available and priced; otherwise the action remains disabled.
- `intervention_costs`: `promise_adjustment` requires a real cost per order or parcel and, optionally, a customer-impact penalty per order. SLA prioritisation requires mapped priority values in order rows. Costs should be sourced from approved internal rules/contracts, not guessed.

### Supported status / priority values

Terminal order statuses excluded from the active cohort include delivered/completed, cancelled, returned, void, failed, and closed. SLA-critical classes are `sla_critical`, `critical`, `priority`, `express`, `premium`, and `vip`; other values are treated as standard priority. Align these values to your source system or update the mapping in `app/api/recovery-plan/route.js`.

### Operational readiness endpoint

Open the Network Watch app, select an origin/destination, and inspect the Intervention Optimizer. When tables or fields are missing, the endpoint lists the missing tables/lanes/orders and does not substitute fabricated operational figures. After import, re-run the same journey and verify the API's readiness counts against Supabase Table Editor.

## What the optimizer compares

When the required data exists, the endpoint evaluates combinations of:

1. Diverting overflow through available spare capacity on alternative lanes.
2. Adding genuinely configured temporary hub capacity.
3. Prioritising SLA-critical orders for recovered capacity.
4. Moving eligible delivery promises by up to 24 hours, when ETA, lane-delay and policy-cost inputs support that calculation.

Combination ranking minimises projected late parcel units when SLA and delay inputs are complete; otherwise it uses remaining modelled capacity gap, then promise changes and configured incremental cost. Diversion allocation is a greedy capacity-feasible heuristic—not a globally optimal multi-commodity flow solver. Validate recommendations with an operations owner before dispatch.

## Traffic provider decision

The patch keeps your already-working TomTom integration to avoid a provider migration during the final build. TomTom can supply traffic-aware route times, flow tiles and incident sections when returned by the configured API. TomTom's current documentation recommends its newer Orbis APIs for new integrations, so plan a version migration after the core workflow is validated.

Google Routes API is a viable alternative: its official documentation describes `TRAFFIC_AWARE` and `TRAFFIC_AWARE_OPTIMAL`, plus traffic speed intervals along traffic-aware polylines. Traffic-aware features are billed at higher rates and require enabling/configuring Google Maps Platform. HERE Traffic API is also viable; its documentation describes real-time flow speeds/jam factors and traffic incidents. Neither provider can be declared more accurate for your Indian corridors without an A/B comparison on the same routes and times. For this time-boxed patch, keep TomTom rather than introduce an untested provider.

Official provider documentation:

- Google traffic-aware routing and quality options: https://developers.google.com/maps/documentation/routes/config_trade_offs
- Google traffic-aware polylines: https://developers.google.com/maps/documentation/routes/traffic_on_polylines
- HERE Traffic API v7: https://docs.here.com/traffic-api/docs/introduction-to-here-traffic-api-v7
- TomTom Traffic API: https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/product-information/introduction

## AI copilot data contract

The Gemini endpoint is sent the selected origin/destination, candidate route metrics, live provider coverage, hub weather readings for the selected candidate set, recovery-plan combination, Supabase operational readiness and known limitations. It is instructed not to invent operational metrics. When Gemini is not configured, the fallback explicitly says it is a fallback and does not fabricate orders/costs.

## Production caveats

- Live weather is sampled at hub coordinates and is only a corridor proxy; it does not verify a road closure.
- Traffic is live only on legs where TomTom explicitly returns usable traffic. OSRM fallback is baseline routing, not live traffic.
- Order-level outcomes remain unavailable when promise/ETA or lane delay-model data is incomplete.
- Cost projections use imported transport rates and intervention policies; they are planning estimates, not an external carrier quote.
- Before operational use, review table-level access, retention, import freshness, source-system mapping, directional lanes and the model with a responsible operations/data owner.
