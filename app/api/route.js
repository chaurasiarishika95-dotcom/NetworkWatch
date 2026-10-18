// Manager approvals. Records the proposed plan and the decision in Supabase.
// This only RECORDS an approval. It does not change any real route, staffing or delivery promise.
import { sbConfig, sbSelect, sbInsert } from '../../../lib/supabase.js';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!sbConfig()) return Response.json({ stored: false, items: [], reason: 'Supabase is not configured.' });
  const r = await sbSelect('nw_decisions', 'select=id,decision,approver,note,decided_at,plan:nw_recovery_plans(id,scenario,actions,incremental_cost,on_time,revised_promise,still_late,currency)&order=decided_at.desc&limit=20');
  if (!r.ok) return Response.json({ stored: false, items: [], reason: r.missing ? 'Decision tables not found. Run supabase/schema.sql.' : r.error });
  return Response.json({ stored: true, items: r.data });
}

export async function POST(req) {
  let body; try { body = await req.json(); } catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }
  const f = body.facts || {}, decision = body.decision === 'rejected' ? 'rejected' : 'approved';
  const at = new Date().toISOString();
  if (!sbConfig()) return Response.json({ stored: false, reason: 'Supabase is not configured.', at });
  const plan = await sbInsert('nw_recovery_plans', [{
    region: f.region || null, scenario: body.scenario || null, route_from: body.route?.from || null, route_to: body.route?.to || null,
    actions: f.actions || [], currency: f.currency || null, incremental_cost: f.incrementalCostPerDay ?? null,
    on_time: f.onTime ?? null, revised_promise: f.revisedPromise ?? null, still_late: f.stillLate ?? null,
    parcels_at_risk: f.parcelsOverCapacityPerDay ?? null, alternatives: body.alternatives || [], facts: f, data_sources: body.sources || {}, created_at: at
  }]);
  if (!plan.ok) return Response.json({ stored: false, reason: plan.missing ? 'Recovery plan table not found. Run supabase/schema.sql.' : `Could not save: ${plan.error}`, at });
  const dec = await sbInsert('nw_decisions', [{ plan_id: plan.data[0]?.id, decision, approver: String(body.approver || 'Manager').slice(0, 80), note: String(body.note || '').slice(0, 500), decided_at: at }]);
  if (!dec.ok) return Response.json({ stored: false, reason: `Plan saved but decision failed: ${dec.error}`, at });
  return Response.json({ stored: true, id: dec.data[0]?.id, planId: plan.data[0]?.id, at });
}
