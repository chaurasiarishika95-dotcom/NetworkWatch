# Network Watch: Product Requirements Document

**Document version:** 3.0 | **Product version:** v0.4 (staffing shortfall, policy baselines, integrity fixes) | **Owner:** Rishika Chaurasia

---

## 0. Data disclosure (read first)

- **All three networks (North India, United States, Germany) are sample data.** Hub locations are real cities; hub roles, lanes, capacities, volumes, costs and order profiles are invented. This is an independent portfolio project, not a company system, and it uses no company data.
- **Supabase** can supply hubs, lanes, open orders and temporary-capacity options. Rows marked `is_sample` are labelled as sample data on screen. Real data is used only where rows exist; everything else falls back to sample values.
- **Saved scenarios are illustrative** (Agra corridor fog and closure, monsoon rain, dust storm, Lucknow sort-centre overload, Delhi NCR staffing shortfall, normal day; plus the US and Germany scenarios), not official records.
- **Live inputs:** weather from Open-Meteo, truck traffic from TomTom (when a key is set), NWS alerts for the US view. Live road events are shown as context; only simulated scenarios close lanes.
- **The decision engine is rule-based, not machine learning.** Thresholds and costs are assumptions. Outcomes are estimates, not actual delayed-order counts.

---

## 1. Problem

When a disruption hits a parcel network, a planner must quickly decide which parcels are at risk, what to do, and what each option costs in money and customer trust. Three things make this hard:

1. **Different constraints break in different ways.** A road can be clear while a sort centre is overloaded; a sort centre can have space but not enough people.
2. **Responses compete for the same spare capacity.** Diverting one flow uses room another flow needs, so the decision is network-wide, not per shipment.
3. **The trade-off is between cash, delivery promises and customer trust**, and today it is made with scattered views and manual judgment.

At festive peak this compounds: volumes surge while labour is scarce, and weather and fuel shocks add pressure. Indian express logistics operators publicly report labour availability and wage inflation as key margin pressures. A staffing shortfall behaves like any other capacity loss and should be planned around the same way.

---

## 2. Users

| User | Role in the product | Primary need |
|---|---|---|
| **Network control / line-haul planner** (primary) | Proposes and approves recovery plans | See which lanes and hubs break, how many parcels are affected, compare responses, approve one |
| Hub operations manager | Executes hub-level actions | Know when a hub is short of sort capacity or staff, and whether an extra shift is feasible |
| Customer promise owner | Approves promise changes | Know when delivery dates must change before customers are let down |

Cross-corridor rerouting is normally a central network decision, so the primary approver is the network planner, not an individual hub manager.

---

## 3. Goals and non-goals

**Goals**
- One connected flow: Detect → Quantify → Optimise → Recommend → Explain and approve.
- Compare combinations of interventions, not single fixes.
- Show cost, capacity and delivery consequences for every option, with each number traceable.
- Treat staffing shortfalls as capacity loss, alongside weather, closures and overloads.
- Ground every copilot number in engine calculations.
- Keep every action human-approved; record decisions, never execute them.
- Be explicit about what is live, sample or estimated.

**Non-goals (this iteration)**
- Last-mile rider optimisation, computer vision, fraud/RTO prediction, dynamic pricing.
- Executing real route, staffing or promise changes.
- Trained ML forecasts (planned for v0.5, see §5).

---

## 4. Functional requirements

| ID | Feature | Version | Notes |
|---|---|---|---|
| F1 | Network map: lanes coloured by load vs. remaining capacity | v0.1 / v0.3 | North India 17 hubs, 29 lanes; real road geometry when TomTom is live; closed lanes dashed; overloaded hubs filled red; diversions dotted |
| F2 | Saved scenarios | v0.1–v0.4 | India: Agra corridor, monsoon, dust storm, Lucknow overload, **Delhi NCR staffing shortfall**, normal day. US and Germany as before |
| F3 | Live weather | v0.1 / v0.3 | Gusts, rain, visibility and risk flags via server route; refresh; source and timestamp shown |
| F4 | Intensity slider | v0.1 | Scales weather, surges and hub cuts; closures apply above 0%. Disabled in live mode (actual readings) |
| F5 | Capacity impact rules | v0.1 / v0.3 | Gusts > 56 km/h cut capacity (full at 145 km/h); rain up to 50%; snow up to 60%; fog/dust below 1,000 m visibility up to 50%. Lane takes its worse end. Sort centres lose half their weather cut plus any scenario cut |
| F6 | Result tiles | v0.2 / v0.3 | Over capacity, past promise from road delay, on time, new date, still late, plan cost per day |
| F7 | Four combinable responses | v0.1 | Divert, temporary capacity (market trucks, extra sort shift), prioritise SLA-critical, adjust promises |
| F8 | Min-cost rerouting | v0.2 / v0.3 | Respects lane and hub spare capacity; path cost uses km, hops and traffic-aware hours; detours must stay within allowed extra hours |
| F9 | Plan optimiser | v0.3 | Min-cost flow allocates every at-risk parcel to one outcome; all 16 combinations compared; best plan and alternatives shown |
| F10 | Recommended-plan panel | v0.3 / v0.4 | Route changes, itemised cost breakdown (quantity × unit cost, with basis), delivery and capacity impact, explanation |
| F11 | Route analysis | v0.3 | Origin/destination → fastest open hub sequence, alternative, per-leg travel/delay/capacity/source, route risks, route weather |
| F12 | Live traffic | v0.3 | TomTom truck routing with traffic for every lane (10-min cache) and door-to-door alternatives; can be switched off |
| F13 | Operations copilot | v0.3 / v0.4 | Gemini function calling over engine tools; answers in the language of the question (English or Hinglish); sources and timestamps per answer; proposes but never executes; rule-based fallback |
| F14 | Approval and decision history | v0.3 | Approve/reject with name and note; stored in Supabase (`nw_recovery_plans`, `nw_decisions`), else in the browser, labelled |
| F15 | Supabase data foundation | v0.3 | Hubs, lanes, orders, temporary capacity, traffic and weather observations, plans, decisions. New `nw_*` tables only |
| F16 | 14-day capacity forecast per hub | v0.2 / v0.4 | Compounding growth rule starting from the hub's current load on the map; labelled as a rule, not a trained forecast |
| F17 | On-page data disclosure | v0.1 / v0.4 | Banner plus data, traffic and weather source line; fallbacks shown as intentional modes, not errors (§12) |
| **F18** | **Staffing shortfall scenario** | **v0.4** | Cuts a hub's sort capacity (e.g. −25%) and limits the extra-shift lever to the available labour pool, so the optimiser cannot assume staff that do not exist |
| **F19** | **Feasibility checklist** | **v0.4** | Per-plan checks (spare lane capacity, downstream sort capacity, detour within slack, activation windows, staffing availability). Status: PASS / FAIL / **N/A** for levers the plan does not use |
| **F20** | **Policy baseline comparison** | **v0.4** | Optimiser vs. do nothing, diversion only, reset every at-risk parcel; per scenario and averaged across saved scenarios; labelled as synthetic |

---

## 5. Versions and phases

| Version | Theme | Status |
|---|---|---|
| v0.1 | Weather to impact to decision (US) | Shipped |
| v0.2 | Optimise, explain, look ahead, Germany | Shipped |
| v0.3 | North India network, live traffic, hub capacity, multi-option optimiser, copilot, Supabase, approvals | Shipped; live on Vercel |
| **v0.4** | Staffing shortfall, feasibility checklist, policy baselines, integer accounting, fallback labelling | **In progress** (see §10 open items) |
| v0.5 (needs real data) | Trip-time prediction model trained on a public trip dataset with planned vs. actual times; measured against the routing-engine baseline; fed into the optimiser | Not started |
| v0.6 | End-to-end flow tracking (removes double counting); full multi-commodity optimum vs. greedy reroute; IMD alerts mapped to hubs | Not started |
| Pilot (hypothetical) | Backtest → shadow mode → assisted mode → phased rollout (§14) | Requires an operator partner |

---

## 6. Why this order

1. Restore the original and confirm it builds (US and Germany results match v0.2 exactly).
2. North India network on the same hub-and-lane model.
3. Traffic and route weather, because they change the inputs the optimiser needs.
4. Multi-option optimiser, because the recommendation and copilot depend on it.
5. Supabase, after the model knows what data it needs.
6. Copilot last, because it only explains what the engine calculates.
7. **v0.4:** staffing realism and evaluation baselines, because a recommendation is only credible if it beats simple policies and never assumes unavailable resources.
8. **v0.5:** ML only where prediction beats rules (trip times), measured against a baseline before it touches decisions.

---

## 7. How the key features work

- **Shortfall items.** Each at-risk parcel belongs to one item: a lane over capacity (weather cut, closure or surge), a sort centre over processing capacity (weather, overload or staffing shortfall), or a lane whose road delay pushes parcels past their promise (share taken from the order slack profile).
- **Integer accounting (v0.4).** Parcel counts are rounded to whole parcels, with SLA-critical counts fixed per shortfall item, **before** any cost is computed. All costs derive from these integers, so every table adds up and plans with identical outcomes have identical costs.
- **Diversion (greedy min-cost reroute).** For each damaged lane, largest shortfall first, find the cheapest path (Bellman-Ford) through lanes with spare capacity and hubs with spare sort capacity, push as much as the narrowest point allows, repeat. Cost per parcel = ₹0.035/km + ₹4 per hop + ₹2 per hour of traffic-aware travel time. Detours beyond the allowed extra hours are rejected. Greedy approximation, not a proven optimum.
- **Temporary capacity.** Market trucks: up to 35% of lost lane capacity at ₹16/parcel, ready in 5 h; on a closed road they run the bypass only if one exists. Extra sort shift: up to 30% of hub capacity (or the Supabase value) at ₹9/parcel, ready in 3 h, **capped by available staff in the staffing scenario**. Each counts only for the share of the dispatch window left after it is ready.
- **Allocation (min-cost flow).** Every at-risk parcel flows to exactly one outcome: diverted, temporary capacity, revised promise, or late. Costs: revised promise ₹10 credit + assumed ₹45 trust cost (double for SLA-critical); late ₹120 (₹300 SLA-critical). With prioritisation on, SLA-critical and standard parcels are separate flows, so critical parcels get scarce capacity first; with it off, capacity is shared pro rata. Solved by successive shortest paths (SPFA).
- **Plan comparison.** All 16 combinations are solved and ranked by incremental cost + assumed trust cost + assumed late cost. Identical outcomes are merged, keeping the plan with fewer actions. The planner can apply any row.
- **Policy baselines.** The same engine evaluates fixed policies (do nothing, diversion only, reset all at-risk) on the same inputs. Because the optimiser searches a superset of these policies, its modelled cost must be ≤ every baseline (checked in §11).
- **Route analysis.** Dijkstra on traffic-aware lane times, avoiding closed and zero-capacity lanes; the alternative is the best route that avoids one leg of the best route. When a faster alternative is skipped for capacity reasons, the panel says why.
- **Copilot.** The page sends its current state. The server rebuilds the identical analysis and exposes six tools (network status, route risk, hub status, compare plans, evaluate plan, propose intervention). Gemini picks tools and explains results; each tool returns evidence (metric, value, source, timestamp). A proposal needs approval; approval records the decision only.
- **US and Germany** keep v0.2 costs, so their results are unchanged.

---

## 8. Example results

Reproducible: "Recommend a plan" at 100% intensity, sample data, no live traffic.

| Scenario | Over capacity / day | On time | New date | Still late | Cost / day | Plan |
|---|---|---|---|---|---|---|
| Agra corridor disruption | 6,100 | 2,083 | 4,017 | 0 | ₹77,944 | Divert 450 via Aligarh + market trucks on the bypass 1,633 + prioritise SLA + revise 4,017 |
| Monsoon heavy rain | 5,757 | 3,809 | 1,948 | 0 | ₹80,425 | Temporary capacity + prioritise SLA + revise |
| Dust storm | 4,235 | 2,997 | 1,238 | 0 | ₹62,043 | All four |
| Lucknow sort-centre overload | 6,499 | 4,230 | 2,269 | 0 | ₹60,760 | Extra shift + prioritise SLA + revise |
| Delhi NCR staffing shortfall | *To record after v0.4 integer fix* | | | | | |
| No disruption | 0 | 0 | 0 | 0 | ₹0 | Do nothing |
| Hurricane Ian replay (US) | 26,584 | 14,554 | 12,030 | 0 | $26,896 | Unchanged from v0.2 |
| Germany snowstorm | 16,511 | 13,794 | 2,717 | 0 | $22,885 | Unchanged from v0.2 |

Totals are upper bounds, because parcels are counted per lane and per hub.

**Findings.** In the Agra scenario only 450 parcels a day can bypass the closed expressway via Aligarh: the Jaipur detour is too slow for the promise. Market trucks on the bypass add 1,633; the rest need revised dates. Prioritising SLA-critical parcels costs nothing and appears in most recommended plans, because it moves critical parcels onto physical fixes and standard parcels onto revised promises. The Lucknow case shows a hub problem diversion cannot fix: every road is clear, but the sort centre is 6,499 parcels short. The staffing scenario tests the same hub problem when the extra-shift lever is constrained by labour.

---

## 9. Trade-offs made

| Decision | Chose | Gave up | Why |
|---|---|---|---|
| Sample vs. real network | Sample, replaceable from Supabase | Realism | No authorised operational data |
| Rule-based vs. ML for decisions | Rule-based | An ML label | A model trained on invented data only learns my own rules; planners must be able to explain a reroute |
| ML where it belongs (v0.5) | Prediction of trip times | — | Prediction is where models beat rules; decisions stay transparent |
| Greedy reroute + min-cost-flow allocation | Explainable, fast | Proven global optimum | Full multi-commodity flow is heavier; gap to be measured |
| Trust and late costs in the objective | Explicit assumed values | Pure cash minimisation | Otherwise cheap promise resets always win |
| Integer parcel accounting | Consistent tables | Fractional precision | Fractional parcels made the optimiser appear worse than a baseline |
| Traffic affects time, not capacity | Separate | Simpler single number | Road delay and sort/line-haul capacity are different constraints |
| Live road events shown, not closing lanes | Context only | Automatic closures | Mapping TomTom events to logistics lanes needs validation |
| Copilot through tools only | Grounded numbers | Free-form answers | Prevents invented costs, volumes and ETAs |
| Approval records only | No execution | Automation | No authorised integration exists |
| Demo default: a saved scenario | Repeatable demo | Live-first landing | Calm live conditions produce a weak, variable demo |
| New `nw_*` tables | Isolation | Reusing existing tables | Do not change an existing schema without inspection |

---

## 10. Known limitations and open items

**Model limitations**
- Per-lane and per-hub counting gives upper bounds. Next: end-to-end flow tracking.
- Road-delay risk uses an order slack profile, not individual shipments. Next: per-shipment ETA.
- IMD warnings are not included. Next: official alerts mapped to hubs.
- Costs, recovery shares, activation times and labour availability are assumptions. Next: calibrate with planners.
- Reroute is greedy. Next: compare against a full optimisation.

**Open v0.4 items (found in review, 22 Oct)**

| # | Issue | Fix |
|---|---|---|
| O1 | Optimiser total (₹2,048) exceeds "reset all" baseline (₹2,046) in live mode | Integer accounting (§7); add check E3b |
| O2 | Trust units shown as "39 = (31 + 7)" and SLA-critical count differs between rows (7 vs 8) | Integer accounting; fix SLA split per item |
| O3 | "Prioritise SLA-critical" costs more than "do nothing" | Same root cause; check E3c |
| O4 | Extra-shift check shows PASS when unused and assumes staff | N/A for unused levers; cap by labour pool (F18, F19) |
| O5 | "Supabase tables not set up" / "Gemini not available" read as errors | Relabel as intentional modes (§12) |
| O6 | Explanation says "about 0 parcels no longer fit" | Omit zero clauses |
| O7 | Copilot language does not always match the question | Language-match rule; eval C4 |
| O8 | Region selector exposes US/Germany on the India demo | Default to North India; move others under "More regions" |

---

## 11. Evaluation and quality checks

### 11a. Engine integrity (offline, automated)

| ID | Check | Pass criteria | Status |
|---|---|---|---|
| E1 | Conservation: 12 scenarios × 11 intensities × 16 combinations (2,112 runs): diverted + temporary + revised + late = parcels at risk; no negative flows or costs; SLA-critical late ≤ late | 0 violations | **Run: 0 violations** |
| E2 | Monotonicity: parcels over capacity never fall as intensity rises; zero at 0% | 0 exceptions | **Run: 0 exceptions** |
| E3a | Best plan cost ≤ do nothing in every run | 0 exceptions | **Run: 0 exceptions** |
| E3b | Best plan cost ≤ **every** policy baseline in every run | 0 exceptions | **Open (fails in live mode, O1)** |
| E3c | Enabling "prioritise SLA-critical" never increases modelled cost | 0 exceptions | **Planned** |
| E4 | Integer accounting: all displayed counts are whole parcels; every cost row = quantity × unit cost | 0 mismatches | **Planned** |
| E5 | Feasibility: no plan uses more extra-shift capacity than the labour cap | 0 violations | **Planned** |
| E6 | Backward compatibility: US Ian and Germany snowstorm match v0.2 | Exact match | **Run: match** |
| E7 | Supabase SQL: schema and seed run twice without errors or duplicates | Idempotent | **Run (PGlite)** |

### 11b. Copilot evaluation

| ID | Check | Method | Pass criteria | Status |
|---|---|---|---|---|
| C1 | Grounding: every number in an answer appears in tool results | 50-question set (20 English, 20 Hinglish, 10 adversarial) | 100% traceable | **Planned (needs live key)** |
| C2 | Tool selection: correct tool(s) called | Labelled expected tools per question | ≥ 95% | Planned |
| C3 | Refusal: off-topic or unanswerable questions declined, no invented figures | 10 adversarial prompts (e.g. "what is Delhivery's real cost per parcel?") | 10/10 | Planned |
| C4 | Language match: reply language = question language | Same set | ≥ 95% | Planned |
| C5 | Never executes: proposals always land in "waiting for approval" | Prompts that ask it to "just do it" | 100% | Planned |
| C6 | Latency and cost | p50/p95 response time; tokens per answer | p95 < 8 s | Planned |
| C7 | Fallback parity: rule-based answers match engine numbers when Gemini is off | Same question set | 100% numeric match | Planned |

### 11c. Decision quality

| ID | Check | Pass criteria | Status |
|---|---|---|---|
| D1 | Policy baselines across saved scenarios (synthetic): optimiser vs. do nothing, diversion only, reset all | Optimiser ≤ every baseline on modelled cost; late parcels ≤ every baseline | **Built; passes on saved scenarios; recheck after O1** |
| D2 | Greedy vs. full multi-commodity optimum | Gap reported per scenario | Planned (v0.6) |
| D3 | Sensitivity: rank of recommended plan under ±50% trust and late costs | Report how often the recommendation changes | Planned |
| D4 | Backtest on historical disruptions (needs operator data): would the plan have beaten the action taken? | ≥ 15% fewer late parcels at ≤ 5% extra cost | Requires data |

### 11d. Prediction model (v0.5)

| ID | Check | Pass criteria |
|---|---|---|
| M1 | Trip-time MAE vs. routing-engine planned time, on a time-based holdout (train on earlier weeks, test on later) | Beats baseline by a reported margin |
| M2 | Error by corridor and time of day | No corridor worse than baseline |
| M3 | Calibration of prediction intervals | 80% intervals contain ~80% of actuals |
| M4 | Drift monitoring | Weekly MAE tracked; alert if > baseline for 2 weeks |
| M5 | Disruption detection (if added): precision and recall on labelled disruption windows | Report both; tune threshold to planner tolerance for false alarms |

### 11e. Usability

| ID | Check | Pass criteria | Status |
|---|---|---|---|
| U1 | 5 first-time viewers explain the screen within 2 minutes | ≥ 4 of 5 | Planned |
| U2 | Demo path (staffing scenario → Recommend → copilot) completed unaided | ≥ 4 of 5 | Planned |
| U3 | Mobile: all five steps readable at 380 px width | No horizontal scroll on key panels | Planned |

**What these checks do not prove:** they show the system is internally consistent and well-behaved on synthetic data, not that the assumptions match reality. Only D4 and a pilot (§14) can show that.

---

## 12. Fallbacks and degraded modes

Every external dependency has a detected failure state, a fallback, and an on-screen label that reads as a mode, not an error.

| Dependency | Failure detected by | Fallback | On-screen label | Data freshness rule |
|---|---|---|---|---|
| TomTom traffic | Timeout (5 s), quota error, missing key | Estimated lane times from distance and speed profile; last good cache if < 10 min old | "Traffic: estimated" or "Traffic: cached HH:MM" | Live data older than 30 min shown as stale |
| Open-Meteo weather | Timeout, empty response | Saved scenarios remain available; live mode disabled | "Weather: unavailable, use a saved scenario" | Readings older than 60 min flagged |
| Gemini copilot | Timeout (10 s), error, missing key | Rule-based answers from the same engine tools | "Explanation: rules-based summary" | — |
| Supabase | Connection error, tables absent | Built-in sample data; decisions stored in browser | "Data: built-in sample" / "Decisions: saved in this browser" | — |
| NWS (US view) | Timeout | Weather-only risk flags | "Alerts: unavailable" | — |
| Optimiser | Exception or > 3 s solve time | Show best single-lever plan; flag "partial comparison" | "Showing best single response" | — |

Rules:
- A fallback never silently changes numbers; the label always changes with it.
- The approval step stays available in every mode, with the active data sources recorded on the decision.

---

## 13. Testing strategy

| Layer | What | Tooling | Runs |
|---|---|---|---|
| Unit | Capacity rules (F5), cost functions, rounding, path search, SPFA flow | Vitest / Jest | Every commit |
| Property-based | Invariants E1–E5 over random networks, intensities and lever combinations | fast-check | Every commit |
| Golden scenarios | §8 results pinned as snapshots; any change requires an explicit update | Snapshot tests | Every commit |
| API contract | TomTom, Open-Meteo, Gemini, Supabase mocked, including timeouts, errors, malformed payloads | MSW (mock service worker) | Every commit |
| Fallback | Each §12 row: kill the dependency, assert fallback output and label | Integration tests | Every commit |
| Copilot eval | §11b question set with expected tools and numbers | Scripted eval harness | Nightly / before deploy |
| End-to-end | Demo path: load → staffing scenario → Recommend → copilot question → Approve → decision appears | Playwright | Before deploy |
| Cross-browser and mobile | Chrome, Safari, Firefox; 380 px viewport | Playwright | Before deploy |
| Production smoke | Live page loads, live traffic count > 0, weather timestamp < 60 min | Scheduled check | Hourly |

---

## 14. Rollout plan (for a real deployment)

Hypothetical; requires an operator partner and authorised data.

| Phase | What happens | Duration | Go / no-go to next phase |
|---|---|---|---|
| 0. Calibrate | Replace assumed costs, recovery shares, activation times and labour caps with planner-provided values | 2 weeks | Planners sign off on cost parameters |
| 1. Backtest | Replay past disruptions; compare agent plans with actions taken | 2–4 weeks | Agent plans would have cut late parcels ≥ 15% at ≤ 5% extra cost |
| 2. Shadow mode | Runs silently in 5 disruption-prone hubs vs. matched control hubs; planners see nothing | 4 weeks | Same thresholds on live data; no SLA-critical regression |
| 3. Assisted mode | Planners see recommendations and approve or override | 4–6 weeks | ≥ 70% acceptance; override reasons logged and reviewed |
| 4. Phased rollout | Region by region | Ongoing | Guardrails (§15) hold in each region |

**Kill switch:** any phase stops if guardrail metrics breach for two consecutive weeks.

---

## 15. Success metrics (proposed, not measured)

| Type | Metric | Definition | Target (proposed) |
|---|---|---|---|
| **North star** | Protected-promise rate | Share of at-risk parcels delivered on their original promise | +15% vs. control hubs |
| Input | Time to approved plan | Minutes from disruption detected to plan approved | −50% vs. current manual process |
| Input | Cost per protected parcel | Incremental recovery cost ÷ parcels protected | ≤ +5% vs. control |
| Guardrail | SLA-critical late parcels | Count per disruption | No increase vs. control |
| Guardrail | Promise-reset share | Parcels given a new date ÷ parcels at risk | Must not rise above control baseline |
| Guardrail | Infeasible recommendations | Plans planners reject as not executable | < 5% |
| Adoption | Acceptance rate | Approved unchanged ÷ recommendations shown | ≥ 70% |
| Adoption | Override reasons | Categorised from approval notes | Reviewed weekly |
| Copilot | Traceable answers | Answers where every number maps to a tool result | 100% |
| Copilot | Resolution rate | Questions answered without escalation to a person | Tracked |

---

## 16. Feedback loop

Every decision logs: scenario and data sources, recommended plan, chosen plan, approver, note, and (when available) the actual outcome (on time, rescheduled, late, actual cost).

Used to:
1. **Recalibrate costs:** if planners consistently override promise resets, the assumed trust cost is too low.
2. **Find missing constraints:** "infeasible" overrides reveal constraints the model lacks (e.g. dock slots, driver hours).
3. **Train v0.5+ models:** outcomes become labels for trip-time and disruption-impact prediction.
4. **Improve the copilot:** questions it could not answer become new tools or eval cases.

---

## 17. Risks and mitigations

| Risk | Mitigation |
|---|---|
| TomTom quota or outage | 10-minute cache; estimated times, labelled (§12) |
| Weather API fails | Saved scenarios always available; clear label |
| Gemini fails or invents numbers | Tools-only grounding, evidence list, rule-based fallback, eval C1/C3 |
| Viewer thinks data is real | Disclosure banner, source line, sample rows flagged |
| Approval mistaken for execution | Stated on the approval box and in every saved message |
| Optimiser recommends something a naive policy beats | Baseline checks E3b and D1 block release |
| Model assumes staff or trucks that do not exist | Labour and truck caps (F18); feasibility checklist (F19); planner override logged |
| Over-reliance on promise resets | Promise-reset guardrail (§15); trust cost in objective |
| Schema clash in existing Supabase project | Read-only inspection first; new prefixed tables only |

---

## 18. Open questions for an operator

1. Does the existing routing or serviceability engine see live staffing levels at each hub, or only parcel load and physical capacity?
2. Who approves cross-corridor reroutes today, and how long does that take?
3. Are trained staff ever pooled across nearby hubs at peak?
4. What are real costs for market trucks, extra shifts and promise credits by region?
5. Which disruption types cause the most late parcels by volume: weather, road events, hub overload or staffing?

---

## 19. Setup notes

See README: environment variables, Supabase steps, deploy.
