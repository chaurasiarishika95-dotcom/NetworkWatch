# Network Watch: Product Requirements Document

**Document version:** 2.0 | **Product version:** v0.3 (North India, live traffic, Supabase, operations copilot) | **Owner:** Rishika Chaurasia

## 0. Data disclosure (read first)
- **All three networks (North India, United States, Germany) are sample data.** Hub locations are real cities; hubs' roles, lanes, capacities, volumes, costs and order profiles are invented. This is an independent portfolio project, not a company system, and it uses no company data.
- **Supabase** can supply hubs, lanes, open orders and temporary-capacity options. Rows marked `is_sample` are labelled as sample data on screen. Real data is used only where rows exist; everything else falls back to sample values.
- **Saved scenarios are illustrative** (Agra corridor fog and closure, monsoon rain, dust storm, Lucknow sort-centre overload, normal day; plus the original US and Germany scenarios), not official records.
- **Live inputs:** weather from Open-Meteo, truck traffic from TomTom (when a key is set), NWS alerts for the US view. Live road events are shown separately; only simulated scenarios close lanes.
- **The model is rule-based, not machine learning.** Thresholds and costs are assumptions. Outcomes are estimates, not actual delayed-order counts.

## 1. Problem
When a disruption hits a parcel network, a manager must quickly decide which parcels are at risk, what to do, and what each option costs in money and customer trust. Road traffic and logistics capacity are different problems: a road can be clear while a sort centre is overloaded. The decision is a trade-off, made today with scattered views and manual judgment.

## 2. Users
| User | Need |
|---|---|
| Network / hub operations manager | See which lanes and hubs break, how many parcels are affected, compare responses, approve one |
| Line-haul planner | Know which roads are delayed or closed and where volume can be diverted |
| Customer promise owner | Know when delivery dates must change before customers are let down |

## 3. Goals and non-goals
**Goals:** one connected story (Detect → Quantify → Optimise → Recommend → Explain and approve); compare combinations of interventions, not single fixes; show cost, capacity and delivery consequences; ground every copilot number in calculations; keep actions human-approved; be honest about what is live, sample or estimated.
**Non-goals (this iteration):** last-mile rider optimisation, computer vision, fraud/RTO prediction, dynamic pricing; executing real route, staffing or promise changes.

## 4. Functional requirements
| ID | Feature | Version | Notes |
|---|---|---|---|
| F1 | Network map: lanes coloured by load vs. remaining capacity | v0.1 / v0.3 | North India 17 hubs, 29 lanes; real road geometry when TomTom is live; closed lanes dashed; overloaded hubs filled red; diversions dotted |
| F2 | Saved scenarios | v0.1–v0.3 | India: Agra corridor, monsoon, dust storm, Lucknow overload, normal day. US and Germany as before |
| F3 | Live weather | v0.1 / v0.3 | India via server route (gusts, rain, visibility, risk flags), refresh, source and time shown |
| F4 | Intensity slider | v0.1 | Scales weather, surges and hub cuts; closures apply above 0% |
| F5 | Capacity impact | v0.1 / v0.3 | Gusts > 35 mph (56 km/h) cut capacity (full at 90 mph); rain up to 50%; snow up to 60%; fog/dust below 1,000 m visibility up to 50%. Lane takes its worse end. Sort centres lose half their weather cut plus any scenario cut, and have processing capacity |
| F6 | Result tiles | v0.2 / v0.3 | Over capacity, past promise from road delay, on time, new date, still late, plan cost per day |
| F7 | Four combinable responses | v0.1 | Divert, temporary capacity (market trucks, extra sort shift), prioritise SLA-critical, adjust promises |
| F8 | Min-cost rerouting | v0.2 / v0.3 | Respects lane and hub spare capacity; path cost uses km, hops and traffic-aware hours; detours must stay within the allowed extra hours |
| F9 | Plan optimiser and recommendation | v0.3 | Min-cost flow allocates every at-risk parcel to an outcome; all 16 combinations compared; best plan and alternatives shown |
| F10 | Recommended-plan panel | v0.3 | Route changes, incremental cost breakdown, delivery impact, capacity impact, alternatives, explanation |
| F11 | Route analysis | v0.3 | Origin/destination → fastest open hub sequence, alternative, per-leg travel/delay/capacity/source, route risks, route weather |
| F12 | Live traffic | v0.3 | TomTom truck routing with traffic for every lane (10-min cache) and door-to-door alternatives with road events; can be switched off |
| F13 | Operations copilot | v0.3 | Gemini function calling over engine tools; English or Hinglish; sources and timestamps per answer; proposes but never executes; rule-based fallback |
| F14 | Approval and decision history | v0.3 | Approve/reject with name and note; stored in Supabase (`nw_recovery_plans`, `nw_decisions`), else in the browser, labelled |
| F15 | Supabase data foundation | v0.3 | Hubs, lanes, orders, temporary capacity, traffic and weather observations, plans, decisions. New `nw_*` tables only |
| F16 | 14-day capacity forecast per hub | v0.2 | Simple growth rule |
| F17 | On-page data disclosure | v0.1 / v0.3 | Banner plus data, traffic and weather source line |

## 5. Versions and phases
| Version | Theme | Status |
|---|---|---|
| v0.1 | Weather to impact to decision (US) | Shipped |
| v0.2 | Optimise, explain, look ahead, Germany | Shipped |
| **v0.3** | North India network, live traffic, hub capacity, multi-option optimiser, copilot, Supabase, approvals | Built; deploy with keys and validate live |
| Next (needs real data) | Trained demand forecast; per-shipment risk; end-to-end flow tracking (removes double counting); IMD alerts mapped to hubs; calibrated costs; compare greedy reroute with a full multi-commodity optimum | Not started |

## 6. Why this order
1. Restore the original and confirm it builds (the US and Germany results below match v0.2 exactly).
2. North India network on the same hub-and-lane model.
3. Traffic and route weather, because they change the inputs the optimiser needs.
4. Multi-option optimiser, because the recommendation and copilot depend on it.
5. Supabase, after the model knows what data it needs.
6. Copilot last, because it only explains what the engine calculates.

## 7. How the key features work
- **Shortfall items.** Each at-risk parcel belongs to one item: a lane over capacity (weather cut, closure or surge), a sort centre over processing capacity, or a lane whose road delay pushes parcels past their promise (share taken from the order slack profile).
- **Diversion (greedy min-cost reroute).** For each damaged lane, largest shortfall first, find the cheapest path (Bellman-Ford) through lanes with spare capacity and hubs with spare sort capacity, push as much as the narrowest point allows, repeat. Cost per parcel = ₹0.035/km + ₹4 per hop + ₹2 per hour of traffic-aware travel time. Detours longer than the allowed extra hours are rejected. This is a greedy approximation, not a proven optimum.
- **Temporary capacity.** Market trucks: up to 35% of lost lane capacity at ₹16/parcel, ready in 5 h; on a closed road they run the bypass only if one exists. Extra sort shift: up to 30% of hub capacity (or the Supabase value) at ₹9/parcel, ready in 3 h. Each counts only for the share of the dispatch window left after it is ready.
- **Allocation (min-cost flow).** Every at-risk parcel flows to exactly one outcome: diverted, temporary capacity, revised promise, or late. Costs: revised promise ₹10 credit + assumed ₹45 trust cost (double for SLA-critical); late ₹120 (₹300 SLA-critical). With prioritisation on, SLA-critical and standard parcels are separate flows, so critical parcels get scarce capacity first; with it off, capacity is shared pro rata. Successive shortest paths (SPFA) solve it.
- **Plan comparison.** All 16 combinations are solved and ranked by incremental cost + assumed trust cost + assumed late cost. Identical outcomes are merged, keeping the plan with fewer actions. The planner can apply any row.
- **Route analysis.** Dijkstra on traffic-aware lane times, avoiding closed and zero-capacity lanes; the alternative is the best route that avoids one leg of the best route.
- **Copilot.** The page sends its current state. The server rebuilds the identical analysis and exposes six tools (network status, route risk, hub status, compare plans, evaluate plan, propose intervention). Gemini picks tools and explains the results; each tool returns its evidence (metric, value, source, timestamp). A proposal needs the manager's approval; approval records the decision only.
- **US and Germany** keep the v0.2 costs ($0.95-type detours, $1.60 temporary capacity, $0.30 credit plus $2 trust), so their results are unchanged.

## 8. Example results (reproducible: "Recommend a plan" at 100% intensity, sample data, no live traffic)
| Scenario | Over capacity / day | On time | New date | Still late | Cost / day | Plan |
|---|---|---|---|---|---|---|
| Agra corridor disruption | 6,100 | 2,083 | 4,017 | 0 | ₹77,944 | Divert 450 via Aligarh + market trucks on the bypass 1,633 + prioritise SLA + revise 4,017 |
| Monsoon heavy rain | 5,757 | 3,809 | 1,948 | 0 | ₹80,425 | Temporary capacity + prioritise SLA + revise |
| Dust storm | 4,235 | 2,997 | 1,238 | 0 | ₹62,043 | All four |
| Lucknow sort-centre overload | 6,499 | 4,230 | 2,269 | 0 | ₹60,760 | Extra shift + prioritise SLA + revise |
| No disruption | 0 | 0 | 0 | 0 | ₹0 | Do nothing |
| Hurricane Ian replay (US) | 26,584 | 14,554 | 12,030 | 0 | $26,896 | Unchanged from v0.2 |
| Germany snowstorm | 16,511 | 13,794 | 2,717 | 0 | $22,885 | Unchanged from v0.2 |

Totals are upper bounds, because parcels are counted per lane and per hub.

**Findings.** In the Agra scenario only 450 parcels a day can bypass the closed expressway via Aligarh: the Jaipur detour is too slow for the promise. Market trucks on the bypass add 1,633, and the rest need revised dates. Prioritising SLA-critical parcels costs nothing and appears in most recommended plans, because it moves critical parcels onto the physical fixes and standard parcels onto revised promises. The Lucknow case shows a hub problem that diversion cannot fix: every road is clear, but the sort centre is 6,499 parcels short.

## 9. Trade-offs made
| Decision | Chose | Gave up | Why |
|---|---|---|---|
| Sample vs. real network | Sample, replaceable from Supabase | Realism | No authorised operational data yet |
| Rule-based vs. ML | Rule-based | An ML label | A model trained on invented data only learns my own rules |
| Greedy reroute + min-cost-flow allocation | Explainable, fast | Proven global optimum for diversion | Full multi-commodity flow is heavier; gap to be measured |
| Trust and late costs in the objective | Explicit assumed values | Pure cash minimisation | Otherwise cheap promise resets always win |
| Traffic affects time, not capacity | Separate | Simpler single number | Road delay and sort/line-haul capacity are different constraints |
| Live road events shown, not closing lanes | Context only | Automatic closures | Mapping TomTom events to logistics lanes needs validation |
| Copilot through tools only | Grounded numbers | Free-form answers | Prevents invented costs, volumes and ETAs |
| Approval records only | No execution | Automation | No authorised integration exists |
| New `nw_*` tables | Isolation | Reusing existing tables | Do not change an existing schema without inspection |

## 10. Known limitations and next steps
- Per-lane and per-hub counting gives upper bounds. Next: end-to-end flow tracking.
- Road-delay risk uses an order slack profile, not individual shipments. Next: per-shipment ETA from real orders.
- IMD warnings are not included. Next: official alerts mapped to hubs.
- Costs, recovery shares and activation times are assumptions. Next: calibrate with planners.
- Reroute is greedy. Next: compare against a full optimisation.

## 11. Evaluation and quality checks
| Area | Check | Pass criteria | Status |
|---|---|---|---|
| Calculation integrity | 12 scenarios × 11 intensities × 16 combinations (2,112 runs): diverted + temporary + revised + late = parcels at risk; no negative flows or costs; SLA-critical late ≤ late | 0 violations | **Run: 0 violations** |
| Monotonic behaviour | Parcels over capacity never fall as intensity rises; zero at 0% | 0 exceptions | **Run: 0 exceptions** |
| Recommendation | Best plan's modelled cost ≤ do-nothing in every run | 0 exceptions | **Run: 0 exceptions** |
| Backward compatibility | US Ian and Germany snowstorm match v0.2 numbers | Exact match | **Run: match** |
| Validation scenarios | Agra corridor; Jaipur–Delhi journey (with a 3 h jam the route moves via Alwar); Lucknow hub shortfall; no disruption; traffic/weather/Gemini/Supabase unavailable (fallbacks shown and labelled) | Behaves as described | **Run locally with mocked APIs; repeat on the live deployment** |
| Supabase SQL | Inspect, schema and seed run twice on Postgres without errors or duplicates | Idempotent | **Run (PGlite)** |
| Copilot grounding | Every number in Gemini answers appears in tool results, on 20 questions | 100% traceable | **Planned (needs live key)** |
| Rerouting quality | Greedy vs. full optimisation | Gap reported | **Planned** |
| Usability | 5 first-time viewers explain the screen within 2 minutes | ≥ 4 of 5 | **Planned** |

What the checks do not prove: they show the code is internally consistent, not that the assumptions match reality.

## 12. Success metrics (proposed, not measured)
- **North star:** share of at-risk parcels protected from a missed promise
- **Decision quality:** cost per parcel delivered on time; SLA-critical parcels late
- **Speed:** time from disruption to an approved plan
- **Trust:** share of parcels given a new date
- **Copilot:** share of answers with every number traceable to a source

## 13. Risks and mitigations
| Risk | Mitigation |
|---|---|
| TomTom quota or outage | 10-minute cache; estimated travel times, labelled |
| Weather API fails | Clear message; saved scenarios always available |
| Gemini fails or invents numbers | Tools-only grounding, evidence list, rule-based fallback |
| Viewer thinks data is real | Disclosure banner and source line; sample rows flagged |
| Approval mistaken for execution | Stated on the approval box and in every saved message |
| Schema clash in the existing Supabase project | Read-only inspection first; new prefixed tables only |

## 14. Setup notes
See README: environment variables, Supabase steps, deploy.
