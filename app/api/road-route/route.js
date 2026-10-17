import { HUBS } from '../../../lib/network';
import { getRoadRoute } from '../../../lib/road-routing';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const originId = searchParams.get('origin') || 'DEL';
  const destinationId = searchParams.get('destination') || 'JAI';

  if (!HUBS[originId] || !HUBS[destinationId]) {
    return Response.json({ error: 'Unknown origin or destination' }, { status: 400 });
  }

  try {
    const route = await getRoadRoute(originId, destinationId);
    return Response.json(route, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      source: 'unavailable',
      error: 'Real road routing is temporarily unavailable.',
      detail: error.message,
    }, { status: 502 });
  }
}
