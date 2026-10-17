# Network Watch — India Logistics Optimisation Prototype

A portfolio prototype for disruption intelligence and capacity-aware recovery planning on a **synthetic North India parcel network**. This is not Delhivery operational data and is not affiliated with Delhivery.

## Features in this iteration
- Schematic network of 11 Indian hubs and synthetic lane connections.
- Simulated monsoon, road closure, festive demand surge and hub-capacity-loss scenarios.
- Live Open-Meteo weather context for hub coordinates (weather does not confirm road closures).
- Capacity-aware graph pathfinder for origin/destination exploration and alternative-path candidates.
- Gemini operations copilot when configured, with a deterministic fallback when no key is set.
- Supabase-ready scenario history, with server-side persistence when configured.

## Run locally
```bash
npm install
npm run dev
```
Open http://localhost:3000.

## Optional environment variables
Copy `.env.example` to `.env.local` and configure:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server only; never use a `NEXT_PUBLIC_` prefix)
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (default `gemini-2.5-flash`)

For persistent scenario history, run `supabase-schema.sql` in the SQL Editor of a **separate Supabase project**. The app uses a server-side service-role key to access the table; keep that key private. If Supabase is not configured, scenario saving is only in server memory and does not survive restarts.

## Data and model limitations
- Hub locations use real city coordinates; hub roles, lane connections, capacity, demand, costs and disruption effects are synthetic assumptions.
- Map layout is schematic, not a road map. Path selection currently uses the synthetic lane graph and cost/time weights; live road-routing integration is not implemented yet.
- Alternative path results are candidates, not a globally optimal multi-commodity flow solution. The app explicitly labels overflow as a modelled exposure estimate rather than a shipment-level count.
- Open-Meteo provides weather context. It does not prove a road is closed. Road closures are simulated in this version.
- No real Delhivery systems, shipment data or proprietary algorithms are used.

## Deployment
Import the repository into Vercel as a Next.js app. Add optional environment variables in Project Settings. Never commit `.env.local`.
