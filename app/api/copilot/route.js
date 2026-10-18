// Gemini operations copilot with function calling. Gemini interprets the question and explains results;
// every number comes from the Network Watch engine via tools. Falls back to rule-based answers without a key.
import { rebuild, TOOL_DECLS, runTool, ruleAnswer } from '../../../lib/copilot.js';
export const dynamic = 'force-dynamic';

const hits = new Map();
const SYSTEM = `You are the operations copilot inside Network Watch, a decision-support prototype for a North India parcel network.
Rules:
- Always call tools before answering. Never invent costs, parcel volumes, traffic, weather, ETAs or any other number. Every figure you write must appear in a tool result.
- Reply in the user's language. If they write Hinglish (Hindi in Roman script mixed with English), reply in simple Hinglish; otherwise plain English. Keep it short: a direct answer, the key numbers, the trade-off against the alternatives.
- When a recovery action is relevant, call propose_intervention with the plan you recommend. Say clearly that it needs the manager's approval and that nothing has been executed.
- Say when figures are estimates from sample or simulated data, and name the source of important numbers.`;

async function gemini(key, model, body) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
  return r;
}

export async function POST(req) {
  const ip = (req.headers.get('x-forwarded-for') || 'x').split(',')[0], now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600000);
  if (recent.length >= 40) return Response.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  recent.push(now); hits.set(ip, recent);

  let body; try { body = await req.json(); } catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }
  const question = String(body.question || '').slice(0, 600);
  if (!question) return Response.json({ error: 'Empty question' }, { status: 400 });
  const ctxAll = rebuild(body.state || {});
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ ...ruleAnswer(ctxAll, question), mode: 'rules', note: 'Gemini is not configured, so a rule-based answer was generated from the same calculations.' });

  const history = (Array.isArray(body.history) ? body.history : []).slice(-6).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.text || '').slice(0, 1500) }] }));
  const contents = [...history, { role: 'user', parts: [{ text: question }] }];
  const evidence = [], tools = []; let proposal = null;
  let model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  try {
    for (let round = 0; round < 6; round++) {
      const payload = { systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools: [{ functionDeclarations: TOOL_DECLS }], generationConfig: { temperature: 0.2 } };
      let r = await gemini(key, model, payload);
      if (r.status === 404 && model !== 'gemini-2.5-flash') { model = 'gemini-2.5-flash'; r = await gemini(key, model, payload); }
      if (!r.ok) throw new Error('gemini ' + r.status);
      const j = await r.json(), content = j.candidates?.[0]?.content;
      if (!content?.parts?.length) throw new Error('empty');
      const calls = content.parts.filter(p => p.functionCall);
      if (!calls.length) {
        const text = content.parts.map(p => p.text || '').join('').trim();
        if (!text) throw new Error('empty');
        return Response.json({ text, evidence, proposal, tools, mode: 'gemini', model });
      }
      contents.push(content); // keep the model turn verbatim (includes any thought signatures)
      const responses = calls.map(({ functionCall: fc }) => {
        const out = runTool(ctxAll, fc.name, fc.args || {});
        tools.push(fc.name); evidence.push(...out.evidence);
        if (out.proposal) proposal = out.proposal;
        return { functionResponse: { name: fc.name, response: { result: out.result } } };
      });
      contents.push({ role: 'user', parts: responses });
    }
    throw new Error('too many rounds');
  } catch (e) {
    return Response.json({ ...ruleAnswer(ctxAll, question), mode: 'rules', note: 'Gemini was unavailable, so a rule-based answer was generated from the same calculations.' });
  }
}
