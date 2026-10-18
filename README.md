# Network Watch

Decision support for parcel-network disruptions. It detects a disruption (weather, road traffic, a closed road or an overloaded sort centre), works out how many parcels are at risk, compares every combination of four recovery options, recommends a plan with its cost and delivery trade-offs, explains it through a Gemini copilot, and records the manager's approval.

Default region: **North India** (17 hubs, 29 lanes). The original **United States** and **Germany** views are still available.

**Sample data:** hubs, lanes, volumes, costs and order profiles are invented unless real rows are loaded into Supabase. Every outcome is a model estimate, not an actual delayed-order count. See `PRD .md`.

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
