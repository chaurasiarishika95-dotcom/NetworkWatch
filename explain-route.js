// Save as app/api/explain/route.js. Needs GEMINI_API_KEY in Vercel environment variables.
export const dynamic='force-dynamic';
const hits=new Map();
export async function POST(req){
 const ip=(req.headers.get('x-forwarded-for')||'x').split(',')[0],now=Date.now();
 const recent=(hits.get(ip)||[]).filter(t=>now-t<3600000);
 if(recent.length>=10)return Response.json({error:'Too many requests'},{status:429});
 recent.push(now);hits.set(ip,recent);
 const key=process.env.GEMINI_API_KEY;
 if(!key)return Response.json({error:'No key'},{status:503});
 try{
  const facts=JSON.stringify(await req.json()).slice(0,2500);
  const prompt=`You help a transportation network planner. Using ONLY the numbers in the JSON below, write 4 short plain-language sentences: what happened, what the chosen responses do, what they cost, and what the planner gives up. Do not invent any numbers. Mention this is a simulation with invented data.\n${facts}`;
  const model=process.env.GEMINI_MODEL||'gemini-2.5-flash';
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})});
  if(!r.ok)throw new Error('gemini');
  const j=await r.json(),text=(j.candidates?.[0]?.content?.parts||[]).map(p=>p.text).join('').trim();
  if(!text)throw new Error('empty');
  return Response.json({text});
 }catch(e){return Response.json({error:'Explain failed'},{status:502})}
}
