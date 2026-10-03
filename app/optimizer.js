// Network Watch — lightweight min-cost-flow optimizer.
// All data is synthetic. The solver chooses a combination of interventions
// to minimize modeled operational cost + customer-promise penalty.

const INF = 1e15;

function addEdge(g, from, to, cap, cost, meta = null) {
  const f = { to, rev: g[to].length, cap, cost, initialCap: cap, meta };
  const r = { to: from, rev: g[from].length, cap: 0, cost: -cost, initialCap: 0, meta: null };
  g[from].push(f);
  g[to].push(r);
}

// Successive shortest augmenting path min-cost max-flow.
function minCostFlow(g, source, sink, required) {
  let flow = 0;
  let cost = 0;
  const n = g.length;

  while (flow < required) {
    const dist = Array(n).fill(INF);
    const prev = Array(n).fill(null);
    const inQ = Array(n).fill(false);
    const q = [source];
    dist[source] = 0;
    inQ[source] = true;

    // SPFA is sufficient for this tiny portfolio-demo graph and supports
    // the negative reverse edges created by the residual network.
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi];
      inQ[u] = false;
      for (let ei = 0; ei < g[u].length; ei++) {
        const e = g[u][ei];
        if (e.cap <= 1e-9) continue;
        const nd = dist[u] + e.cost;
        if (nd < dist[e.to] - 1e-9) {
          dist[e.to] = nd;
          prev[e.to] = [u, ei];
          if (!inQ[e.to]) {
            q.push(e.to);
            inQ[e.to] = true;
          }
        }
      }
    }

    if (prev[sink] === null) break;

    let add = required - flow;
    for (let v = sink; v !== source;) {
      const [u, ei] = prev[v];
      add = Math.min(add, g[u][ei].cap);
      v = u;
    }

    for (let v = sink; v !== source;) {
      const [u, ei] = prev[v];
      const e = g[u][ei];
      e.cap -= add;
      g[v][e.rev].cap += add;
      v = u;
    }

    flow += add;
    cost += add * dist[sink];
  }

  return { flow, cost };
}

export function optimizeNetwork({ lanes, gap, lost, spare }) {
  const demand = Math.max(0, gap);
  if (!demand) {
    return {
      actions: [],
      flows: { div: 0, cap: 0, prm: 0 },
      late: 0,
      protected: 0,
      operationalCost: 0,
      objectiveCost: 0,
      feasible: true,
      status: 'No intervention required',
      explanation: 'No capacity shortfall exists under the current disruption level.'
    };
  }

  // We model the disrupted overflow as supply that must be absorbed by one
  // of three intervention channels. Priority is a risk-allocation policy,
  // not a capacity-creating intervention, so it is applied after flow.
  const S = 0;
  const DIV = 1;
  const CAP = 2;
  const PRM = 3;
  const T = 4;
  const g = Array.from({ length: 5 }, () => []);

  // Cost units: dollars per package. Promise adjustment has a separate
  // customer-promise penalty so the solver does not choose cheap promise
  // resets when capacity-protecting interventions are feasible.
  const DIV_COST = 0.95;
  const CAP_COST = 1.60;
  const PROMISE_COST = 0.30;
  const PROMISE_PENALTY = 8.00;

  addEdge(g, S, DIV, Math.max(0, spare), DIV_COST, 'div');
  addEdge(g, S, CAP, Math.max(0, 0.35 * lost), CAP_COST, 'cap');
  addEdge(g, S, PRM, demand, PROMISE_COST + PROMISE_PENALTY, 'prm');
  addEdge(g, DIV, T, Math.max(0, spare), 0, 'div');
  addEdge(g, CAP, T, Math.max(0, 0.35 * lost), 0, 'cap');
  addEdge(g, PRM, T, demand, 0, 'prm');

  const result = minCostFlow(g, S, T, demand);

  const flowByAction = { div: 0, cap: 0, prm: 0 };
  for (const node of [DIV, CAP, PRM]) {
    for (const e of g[S]) {
      if (e.to !== node || !e.meta) continue;
      flowByAction[e.meta] = e.initialCap - e.cap;
    }
  }

  const late = Math.max(0, demand - result.flow);
  const protectedByOps = Math.max(0, demand - flowByAction.prm - late);
  const operationalCost =
    flowByAction.div * DIV_COST +
    flowByAction.cap * CAP_COST +
    flowByAction.prm * PROMISE_COST;

  const actions = [];
  if (flowByAction.div > 0.5) actions.push('div');
  if (flowByAction.cap > 0.5) actions.push('cap');
  if (protectedByOps > 0.5 && late > 0.5) actions.push('pri');
  if (flowByAction.prm > 0.5) actions.push('prm');

  const status = late > 0.5
    ? 'Residual exposure remains'
    : flowByAction.prm > 0.5
      ? 'Promise exposure contained with contingency action'
      : 'Capacity shortfall fully covered';

  return {
    actions,
    flows: flowByAction,
    late,
    protected: Math.max(0, demand - late),
    operationalCost,
    objectiveCost: result.cost,
    feasible: result.flow >= demand - 0.5,
    status,
    explanation: 'The solver allocated disrupted volume across diversion, temporary capacity and promise adjustment subject to modeled capacity constraints.'
  };
}
