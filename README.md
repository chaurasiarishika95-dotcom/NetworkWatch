# Network Watch

Decision support for parcel-network disruptions. It detects a disruption (weather, road traffic, a closed road or an overloaded sort centre), works out how many parcels are at risk, compares every combination of four recovery options, recommends a plan with its cost and delivery trade-offs, explains it through a Gemini copilot, and records the manager's approval.

Default region: **North India** (17 hubs, 29 lanes). The original **United States** and **Germany** views are still available.

**Sample data:** hubs, lanes, volumes, costs and order profiles are invented unless real rows are loaded into Supabase. Every outcome is a model estimate, not an actual delayed-order count. See `PRD .md`.


## Recent portfolio-demo improvements
- **Cost transparency:** the recommendation view itemises rerouting, temporary transport, extra shifts, promise credits, assumed trust penalties and assumed late-parcel penalties as quantities × unit costs. Assumptions are labelled; these are not Delhivery operating rates.
- **Feasibility checklist:** each recommended plan shows checks for modelled lane room, downstream hub sort room, detour slack and temporary intervention timing/capacity. It does not validate real truck/driver availability or live staffing rosters.
- **Baseline comparisons:** compares the optimiser with do-nothing, diversion-only and forced promise-reset policies for the current scenario, plus unweighted averages across saved scenarios. These results compare policies only inside the synthetic model; they do not prove real-world superiority.
- **Staffing stress test:** North India includes “Delhi NCR staffing shortfall (−25% sort capacity)” as a saved illustrative scenario. It reuses the existing hub-capacity-cut model; it is not live staffing data.
- **Risk overlap adjustment:** estimated ETA exposure on lanes touching overloaded hubs is reduced by a capped overlap estimate to avoid adding the same estimated exposure twice. Aggregate data cannot identify individual parcels, so at-risk totals remain estimates.

To validate performance against reality, the project would need historical shipment-level volumes and promise/actual delivery timestamps, observed lane/hub capacities, disruption windows, intervention costs, and records of what operators actually did.

## Run locally
```
npm install
npm run dev
```
Open http://localhost:3000. Everything works without any keys (sample data, estimated travel times, rule-based copilot).

## Environment variables (Vercel → Project → Settings → Environment Variables)
| Variable | Used for | Without it |
|---|---|---|
| `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) | Operational data, observation logs, decisions | Built-in sample data; decisions kept in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`, or the anon/publishable key) | Same | Same |
| `TOMTOM_API_KEY` (or `TOMTOM_KEY`) | Live truck traffic, road geometry, alternatives | Travel time estimated at 45 km/h |
| `GEMINI_API_KEY`, optional `GEMINI_MODEL` (default `gemini-2.5-flash`) | Copilot and "Explain" | Rule-based copilot and template explanation |

The Vercel–Supabase integration sets the Supabase names automatically. Keep the service-role key server-side only (no `NEXT_PUBLIC_` prefix). Never commit keys.

## Supabase set-up (existing project, nothing is overwritten)
Run these in the Supabase SQL editor, in order:
1. `supabase/00_inspect.sql`: read-only. Lists your current tables and columns and any existing `nw_*` tables. Check it before step 2.
2. `supabase/schema.sql`: creates new `nw_*` tables only (`create table if not exists`), with read/insert policies. It drops and alters nothing.
3. `supabase/seed_sample.sql` (optional): sample hubs, lanes, ~1,700 order batches and temporary-capacity options, all flagged `is_sample = true`. The page labels them as sample data.

To use real data, load your own rows into `nw_hubs`, `nw_lanes`, `nw_orders` and `nw_temp_capacity` with `is_sample = false`. Hub codes must match the app's codes (DEL, JAI, AGR, LKO, …; see `lib/regions.js`).

## Project layout
- `lib/regions.js`: network data, scenarios, cost assumptions
- `lib/engine.js`: capacity model, min-cost reroute, min-cost-flow allocation of interventions, plan comparison, route analysis (shared by page and copilot)
- `lib/copilot.js`: copilot tools and rule-based fallback
- `app/api/traffic`: TomTom; `app/api/weather`: Open-Meteo (India) and NWS alerts (US); `app/api/data`: Supabase reads; `app/api/decisions`: approvals; `app/api/copilot`: Gemini function calling; `app/api/explain`: plan explanation
- `supabase/*.sql`: inspection, schema and sample seed

## Deploy
Push to the existing GitHub repo; Vercel redeploys automatically (framework: Next.js, no build settings needed).

## Model notes
- **Weather cut:** a lane loses exactly the cut shown for its worse end (never more than 95%); a sort centre loses half of its own weather cut. The weather table, route table, map and copilot all use the same figure.
- **Closed roads:** a simulated closure has no travel time, delay or traffic source anywhere on the page or in copilot answers.
- **Forecast:** starts from the hub's current load shown on the map (sort-centre load / current capacity) and compounds at the chosen daily growth. No weekday pattern is modelled.
- **Detours:** when a faster detour is not (fully) used, the page says whether capacity or cost is the reason.
