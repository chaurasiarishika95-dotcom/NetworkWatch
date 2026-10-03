# Network Watch: Product Requirements Document

**Version:** 0.1 (document) | **Status:** v0.1 built, v0.2 onward planned | **Owner:** Rishi

## 0. Data disclosure (read first)
- **The transportation network is synthetic.** Hubs, lanes, capacities, volumes and costs are invented. This is an independent portfolio project. It is not an Amazon system and uses no Amazon data.
- **Saved weather scenarios are illustrative approximations** (Hurricane Ian replay, heavy rain, heavy wind). They are not official records.
- **"Live now" uses real current conditions** from Open-Meteo, plus active Florida alerts from the US National Weather Service.
- **The model is rule-based, not machine learning.** Thresholds, the 35% critical-package share, the 35% temporary-capacity recovery and all per-package costs are my assumptions, not measured values.

## 1. Problem
When weather disrupts a transportation network, planners must decide quickly which packages are at risk, what to do about it, and what each option costs. Today that means checking several views by hand, which is slow when a storm is moving.

## 2. Users
| User | Need |
|---|---|
| Network planner | See which lanes break, how many packages are affected, and compare responses |
| Operations manager | Decide fast, with cost and customer impact visible |
| Customer promise owner | Know when delivery dates must change before customers are let down |

## 3. Goals and non-goals
**Goals:** show weather-to-impact in seconds; make the cost vs. customer-trust tradeoff explicit; stay honest about what is real and what is simulated.
**Non-goals (all versions):** replace a real planning system, use confidential data, claim machine-learning accuracy.

## 4. Functional requirements

| ID | Feature | Version | Status |
|---|---|---|---|
| F1 | Network map: 10 hubs, 17 lanes, lanes colored by load vs. remaining capacity | v0.1 | Built |
| F2 | Weather scenarios: Hurricane Ian replay, Heavy rain day, Heavy wind front | v0.1 | Built |
| F3 | Live mode: current conditions (Open-Meteo) and active Florida NWS alerts, with failure message | v0.1 | Built |
| F4 | Weather intensity slider | v0.1 | Built |
| F5 | Capacity impact: wind/rain thresholds cut hub capacity; each lane takes its worse end | v0.1 | Built |
| F6 | Result stats: packages over capacity, still late, plan cost per day | v0.1 | Built |
| F7 | Four responses, combinable: divert, add temporary capacity, prioritize SLA-critical, adjust delivery promises | v0.1 | Built |
| F8 | "Why these lanes" explanation (top lanes short of capacity) and per-hub weather table | v0.1 | Built |
| F9 | On-page synthetic-data disclosure | v0.1 | Built |
| F10 | Min-cost flow solver: finds the cheapest reroute instead of fixed rules | v0.2 | Planned |
| F11 | Gemini explainer: plain-language summary of the plan, with template fallback | v0.3 | Planned |
| F12 | Capacity-gap forecast (14 days ahead, e.g. Atlanta hub) | v0.4 | Planned |
| F13 | Germany scenario (snowstorm, DWD/Open-Meteo) | v0.4 | Planned |
| F14 | PR/FAQ, roadmap one-pager, 2-minute walkthrough video | v0.5 | Planned |

## 5. Versions and phases

| Version | Theme | Contents | Done when |
|---|---|---|---|
| **v0.1** | Weather to impact to decision | F1-F9 | Deployed on Vercel; all scenarios and live mode work |
| **v0.2** | Smarter rerouting | F10 | Solver result beats fixed-rule cost on at least one scenario |
| **v0.3** | Explain it | F11 | Explanation uses only computed numbers; fallback works if Gemini fails |
| **v0.4** | Look ahead and go global | F12, F13 | Forecast flags a breach day; second region demonstrated |
| **v0.5** | Make it a product story | F14 | PR/FAQ and video done; link sent to hiring manager |

## 6. Why this order
Each item was ranked on four questions: Does it prove a skill the role asks for? Can a viewer see it work in under two minutes? How risky is it to build? Does it stand alone if I stop here?

| Decision | Reason |
|---|---|
| **v0.1 first: weather to impact to decision** | It is the core story of the role (a storm hits, packages are at risk, planner acts). It works with no API keys and no AI, so the first deploy has the lowest risk. If I stopped here, the project would still make sense. |
| **Solver (v0.2) before AI explainer (v0.3)** | The solver proves I understand the underlying optimization problem. An explainer on top of fixed rules explains weak logic. Explain after the logic is solid. |
| **Explainer (v0.3) before forecast (v0.4)** | The explainer makes the decision readable to non-technical users and covers GenAI. The forecast is valuable but is a separate view that adds less to the main story. |
| **Germany and forecast last (v0.4)** | They widen scope (second region, time dimension) rather than deepen the core flow. Doing them early would risk an unfinished project. |
| **Product docs (v0.5) last, but not skipped** | They explain the choices. They are written last so they describe what was actually built, not what I hoped to build. |

## 7. Tradeoffs made

| Decision | Chose | Gave up | Why |
|---|---|---|---|
| Real vs. synthetic network | Synthetic | Realism | No access to real data, and using any confidential data would be wrong |
| Rule-based model vs. ML | Rule-based | A "machine learning" label | A model trained on invented data only learns my own rules. Rule-based is honest and explainable |
| Saved scenarios plus live mode | Both | Simplicity | Live alone can show calm weather when the hiring manager clicks. Saved scenarios always demo |
| Approximate Ian values | Illustrative numbers, labeled | Historical accuracy | Exact records were not verified, so I labeled them instead of implying precision |
| Four responses at once | Combinable options | A single "best" answer | The product point is the cost vs. trust tradeoff; a single answer hides it |
| Promise adjustment included | Yes | Fewer options | The role describes protecting customers by adjusting delivery promises, and it is a real tradeoff |
| Next.js on Vercel | Real backend | Single-file simplicity | Needed for live weather calls and the Gemini key to stay server-side |
| Gemini free tier | Free | Guaranteed availability | Rate limits can fail, so a template fallback is required |
| Solver in JavaScript | JS | OR-Tools / PuLP in Python | Simpler deploy on Vercel; same math |
| Atlanta forecast cut from v0.1 | Cut | Earlier coverage of "predict gaps" | Did not fit the first build without risking quality |

## 8. Success metrics (proposed, not measured)
- **North star:** share of at-risk packages protected from a missed promise
- **Decision quality:** plan cost per protected package
- **Speed:** time from weather alert to a chosen plan
- **Demo quality:** time for a first-time viewer to explain the screen (target: under 2 minutes)

## 9. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Live weather API fails or rate-limits | Clear error message; saved scenarios always available |
| Gemini free tier fails | Template explanation from the same numbers |
| Viewer thinks data is real | Disclosure on page, README and this document |
| Scope creep | Version plan; nothing in v0.2+ starts until the previous version is deployed |
| Over-claiming skills | Describe it as a rule-based simulation; no ML claims |

## 10. Open questions
- Which published sources should back the Ian scenario values?
- What cost and capacity figures would a real planner consider realistic?
- Should promise adjustment be capped to protect customer trust?
