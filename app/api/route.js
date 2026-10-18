export const dynamic = 'force-dynamic';

// Server-side proxy for TomTom live traffic tiles. Keeps TOMTOM_API_KEY off the browser.
export async function GET(_request, { params }) {
  const key = process.env.TOMTOM_API_KEY;
  const z = Number(params.z), x = Number(params.x), yFile = String(params.y || '');
  const y = Number(yFile.replace(/\.png$/, ''));
  if (!key) return new Response('TOMTOM_API_KEY is not configured', { status: 503 });
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    return new Response('Invalid tile coordinates', { status: 400 });
  }
  try {
    const url = `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.png?key=${encodeURIComponent(key)}&tileSize=256`;
    const upstream = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return new Response('Traffic tile unavailable', { status: upstream.status });
    return new Response(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'image/png',
        'Cache-Control': 'public, max-age=60, s-maxage=60',
        'X-Traffic-Source': 'TomTom',
      },
    });
  } catch {
    return new Response('Traffic tile request failed', { status: 502 });
  }
}
