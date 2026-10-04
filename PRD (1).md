# Network Watch: Product Requirements Document

**Document version:** 2.0 | **Product version:** v0.2 (all planned functionality built) | **Owner:** Rishika Chaurasia

## 0. Data disclosure (read first)
- **Both transportation networks (Southeast US, Germany) are synthetic.** Hubs, lanes, capacities, volumes and costs are invented. This is an independent portfolio project. It is not an Amazon system and uses no Amazon data.
- **Saved weather scenarios are illustrative approximations** (Hurricane Ian replay, heavy rain, heavy wind, German snowstorm), not official records.
- **"Live now" uses real current conditions** from Open-Meteo. In the US it also shows active Florida alerts from the National Weather Service. Alerts are shown for context only and do not change capacity.
- **The model is rule-based, not machine learning.** The forecast is a simple growth rule. All thresholds and per-package costs below are my assumptions.

## 1. Problem
When weather disrupts a transportation network, planners must quickly decide which packages are at risk, what to do, and what each option costs in money and customer trust. The decision is a tradeoff, and today it is made with scattered views and manual judgment.

## 2. Users
| User | Need |
|---|---|
| Network planner | See which lanes break, how many packages are affected, and compare responses |
| Operations manager | Decide fast, with cost and customer impact visible |
| Customer promise owner | Know when delivery dates must change before customers are let down |

## 3. Goals and non-goals
**Goals:** show weather-to-impact in seconds; make the cost vs. customer-trust tradeoff explicit; keep the planner in control; be honest about what is real and what is simulated.
**Non-goals:** replace a real planning system, use confidential data, claim machine-learning accuracy.

## 4. Functional requirements (all built in v0.2)

| ID | Feature | Version | Notes |
|---|---|---|---|
| F1 | Network map: lanes colored by load vs. remaining capacity | v0.1 | US: 10 hubs, 17 lanes. Germany: 9 hubs, 15 lanes |
| F2 | Weather scenarios | v0.1 / v0.2 | US: Ian replay, heavy rain, heavy wind. Germany: snowstorm |
| F3 | Live mode with plain-language status (Calm / Breezy / Disruptive) | v0.1 / v0.2 | US via server route (Open-Meteo + NWS). Germany directly from the browser (Open-Meteo) |
| F4 | Weather intensity slider | v0.1 | Scales the weather's effect |
| F5 | Capacity impact | v0.1 | Wind above 35 mph cuts capacity (full at 90). Rain cuts up to 50%. Snow cuts up to 60%. A lane takes its worse end |
| F6 | Result tiles | v0.2 | Over capacity, delivered on time, given a new date, still late, plan cost per day |
| F7 | Four combinable responses | v0.1 | Divert, add temporary capacity, prioritize SLA-critical, adjust promises |
| F8 | Min-cost rerouting for diversion | v0.2 | Cheapest detours through lanes with spare room (details in section 7) |
| F9 | Recommend a plan | v0.2 | One click sets a suggested mix; the planner can override any response |
| F10 | Explain this plan | v0.2 | Gemini writes a short explanation from the computed numbers only; template fallback if Gemini is unavailable |
| F11 | 14-day capacity forecast per hub | v0.2 | Starts from current load and grows at an assumed daily rate (slider) |
| F12 | "Why these lanes" and per-hub weather table | v0.1 | Makes the logic visible |
| F13 | On-page synthetic-data disclosure | v0.1 | Also in README and this document |

## 5. Versions and phases
| Version | Theme | Contents | Status |
|---|---|---|---|
| **v0.1** | Weather to impact to decision | F1-F5, F7, F12, F13 (US only) | Shipped |
| **v0.2** | Optimize, explain, look ahead | F6, F8-F11, Germany region | Built; deploy and test with Gemini key |
| **Next (needs real data)** | Replace rules with evidence | Trained demand forecast; per-shipment delay risk; end-to-end flow tracking (removes double counting); German alerts mapped to hubs; assumptions calibrated with real planners; greedy rerouting compared with a full optimization. Details in section 10 | Not started. Needs real data and planner access |

## 6. Why this order
Each item was ranked on four questions: Does it prove a skill the role asks for? Can a viewer see it work in two minutes? How risky is it to build? Does it stand alone if I stop here?
- **v0.1 first.** It tells the core story (storm, packages at risk, planner acts), needs no API keys and no AI, and was the lowest-risk first deploy.
- **Solver before explainer.** The explainer describes the plan, so the plan logic had to be sound first.
- **Recommendation after the solver.** A recommendation needs real option costs to rank.
- **Forecast and Germany last.** They widen scope rather than deepen the core flow.

## 7. How the key features work
- **Capacity loss:** each hub gets a cut from its worst weather reading; each lane loses capacity based on its worse end. Overflow = lane volume minus remaining capacity.
- **Rerouting (min-cost flow):** for each damaged lane, largest shortfall first, find the cheapest path through lanes with spare capacity (Bellman-Ford shortest path), push as much as the narrowest lane allows, and repeat. Path cost grows with lane length plus a per-hop handling cost. Lanes are handled one at a time, so this is a greedy approximation of the full optimum, not a proven global optimum.
- **Capacity addition:** recovers up to 35% of the capacity lost on damaged lanes, at $1.60 per package.
- **Promise adjustment:** resets dates on whatever remains, at $0.30 per package in credits.
- **Recommendation rule:** use rerouting if it costs $2.30 or less per package, then temporary capacity, then promise resets for the remainder. Resets rank last because each is assumed to cost $2 of customer trust on top of the $0.30 credit. This trust value is an assumption.
- **Explainer:** the page sends only the computed numbers to a server route, which asks Gemini to explain them and not invent figures. The route limits each visitor to 10 requests per hour (best effort), and the page falls back to a template explanation if Gemini fails.
- **Forecast:** hub load on day N = current load x (1 + daily growth)^N plus a small weekly wave. The default growth rate is 3% per day.

## 8. Example results (reproducible, using "Recommend a plan" at 100% intensity)
| Scenario | Over capacity / day | On time | New date | Still late | Cost / day |
|---|---|---|---|---|---|
| Hurricane Ian replay | 26,584 | 14,554 | 12,030 | 0 | $26,896 |
| Heavy rain day | 1,017 | 1,017 | 0 | 0 | $1,627 |
| Heavy wind front | 13,510 | 12,148 | 1,361 | 0 | $19,846 |
| Germany snowstorm | 16,511 | 13,794 | 2,717 | 0 | $22,886 |

Totals are upper bounds, because packages are counted per lane.

**Finding:** rerouting recovers nothing in Ian, wind or snow here, because every lane into the damaged hubs is also down. You cannot reroute around a closed destination. This is why promise adjustment matters. In the rain scenario rerouting could move 317 packages, but at about $2.33 each it costs more than adding capacity, so it is not chosen.

## 9. Tradeoffs made
| Decision | Chose | Gave up | Why |
|---|---|---|---|
| Real vs. synthetic network | Synthetic | Realism | No access to real data; using confidential data would be wrong |
| Rule-based model vs. ML | Rule-based | A "machine learning" label | A model trained on invented data only learns my own rules |
| Saved scenarios plus live mode | Both | Simplicity | Live weather is often calm, so saved scenarios keep the demo reliable |
| Greedy rerouting | Greedy, one lane at a time | Proven optimum | Simple, fast and explainable; full multi-flow optimization is heavier |
| Recommendation is a rule, not a learned policy | Transparent rule with an assumed trust cost | Sophistication | The planner can read it, challenge it and override it |
| Promise adjustment as a response | Included | Fewer options | It protects customers when physical fixes run out |
| Gemini free tier | Free | Guaranteed availability | Rate limits can fail, so a template fallback is built in |
| Germany live data fetched in the browser | Direct from Open-Meteo | Server-side control | Avoided changing the server route; no key needed |
| Alerts shown, not used in capacity | Context only | Alert-driven capacity cuts | Mapping alerts to hubs is unreliable without real geography |
| No accounts or saved plans | None | Persistence | Not needed to demonstrate the decision |

## 10. Known limitations and next steps
- Counts are per lane, so totals are upper bounds. Next: track flow end to end through the network.
- Forecast is a growth rule. Next: train on real demand history, with accuracy tracked.
- No per-shipment risk scores. Next: estimate delay risk for each shipment.
- German alerts are not included. Next: add official alert data and map alerts to hubs.
- Cost, trust and recovery assumptions are mine. Next: calibrate with real planners and data.
- Solver is greedy. Next: compare against a full optimization.

## 11. Evaluation and quality checks
Status is stated plainly: **Run** means I executed it; **Planned** means defined but not yet run.

| Area | Check | Pass criteria | Status |
|---|---|---|---|
| Calculation integrity | Across 4 scenarios x 11 intensities x 16 response combinations (704 runs): delivered on time + new date + still late equals packages over capacity; no negative cost or flows | 0 violations | **Run: 0 violations** |
| Monotonic behavior | Packages over capacity never fall as weather intensity rises; zero at 0% intensity | 0 exceptions | **Run: 0 exceptions** |
| Reproducibility | Section 8 results recomputed from the app's logic | Match the on-screen tiles | **Run** |
| Explainer grounding | Every number in the Gemini text appears in the facts sent to it; no new figures | 100% of numbers traceable, on a sample of 20 plans | **Planned** |
| Explainer fallback | With the key removed or the call failing, the page shows the template and labels it | Template shown 100% of the time | **Run manually** (template shown before the key was added) |
| Recommendation quality | Compare "Recommend a plan" cost to the cheapest manual mix that leaves 0 late | Within 10% of the cheapest manual mix | **Planned** |
| Rerouting quality | Compare the greedy result to a full optimization on the same network | Gap reported, not hidden | **Planned** |
| Forecast | Back-test on real demand history | Error tracked against a simple baseline | **Planned** (needs real data) |
| Usability | 5 first-time viewers explain the screen within 2 minutes | At least 4 of 5 succeed | **Planned** |

What the checks do not prove: they show the code is internally consistent. They do not show the assumptions (thresholds, costs, the $2 trust value) match reality.

## 12. Success metrics (proposed, not measured)
- **North star:** share of at-risk packages protected from a missed promise
- **Decision quality:** plan cost per package delivered on time
- **Speed:** time from weather alert to a chosen plan
- **Trust:** share of packages given a new date
- **Demo quality:** time for a first-time viewer to explain the screen (target under 2 minutes)

## 13. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Live weather API fails | Clear message; saved scenarios always available |
| Gemini fails or is rate-limited | Template explanation from the same numbers |
| Gemini invents numbers | Prompt restricts it to supplied figures; page labels the source |
| Viewer thinks data is real | Disclosure on page, README and this document |
| Recommendation mistaken for optimal | Described as a rule with an assumed trust cost; planner can override |
| Over-claiming skills | Called a rule-based simulation; no ML claims |

## 14. Setup notes
Deploys on Vercel from GitHub. The explainer needs a `GEMINI_API_KEY` environment variable (optional `GEMINI_MODEL`); without it the page uses the template explanation. Never commit the key to GitHub.
