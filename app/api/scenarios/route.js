export const dynamic = 'force-dynamic';

// In-memory fallback is for demonstration only; it does not survive a server restart.
const memory = [];
const supabaseConfigured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

async function supabaseRequest(path, options = {}) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  return fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
    cache: 'no-store',
  });
}

export async function GET() {
  if (!supabaseConfigured()) {
    return Response.json({ persisted: false, scenarios: memory.slice(0, 10), message: 'Supabase not configured' });
  }

  try {
    const response = await supabaseRequest('scenario_runs?select=id,scenario_name,summary,created_at&order=created_at.desc&limit=10');
    if (!response.ok) throw new Error(await response.text());
    return Response.json({ persisted: true, scenarios: await response.json() });
  } catch {
    return Response.json({ persisted: false, scenarios: memory.slice(0, 10), message: 'Supabase query failed. Check schema and environment variables.' });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body?.scenario || !body?.plan) {
      return Response.json({ error: 'scenario and plan are required' }, { status: 400 });
    }

    const row = {
      scenario_name: body.plan.scenarioName || body.scenario,
      summary: `${body.plan.affectedLanes || 0} affected lanes · ${Math.round(body.plan.capacityLost || 0)} parcels/day capacity removed · synthetic scenario`,
      scenario_key: body.scenario,
      payload: {
        plan: body.plan,
        question: body.question || null,
        weather: body.weather || null,
        routeContext: body.routeContext || null,
      },
    };

    if (!supabaseConfigured()) {
      const saved = { ...row, id: `local-${Date.now()}`, created_at: new Date().toISOString() };
      memory.unshift(saved);
      return Response.json({ persisted: false, saved, scenarios: memory.slice(0, 10), message: 'Stored in server memory only; configure Supabase for persistent storage.' });
    }

    const response = await supabaseRequest('scenario_runs', {
      method: 'POST',
      body: JSON.stringify(row),
    });
    if (!response.ok) throw new Error(await response.text());

    const inserted = await response.json();
    const listResponse = await GET();
    const list = await listResponse.json();
    return Response.json({ persisted: true, saved: inserted[0], scenarios: list.scenarios || [] });
  } catch (error) {
    return Response.json({ error: 'Could not save scenario. Check Supabase schema and server logs.', detail: error.message?.slice(0, 200) }, { status: 500 });
  }
}
