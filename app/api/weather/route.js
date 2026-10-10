
import { COORD } from '../../../lib/network';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ids = Object.keys(COORD);

    const results = await Promise.all(
      ids.map(async (id) => {
        const [latitude, longitude] = COORD[id];

        const params = new URLSearchParams({
          latitude: String(latitude),
          longitude: String(longitude),
          current: 'wind_speed_10m,wind_gusts_10m,precipitation,rain,snowfall',
          hourly: 'precipitation,rain,snowfall',
          forecast_days: '1',
          wind_speed_unit: 'mph',
          precipitation_unit: 'mm',
          timezone: 'auto'
        });

        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?${params}`,
          { cache: 'no-store' }
        );

        if (!response.ok) {
          throw new Error(`Weather request failed for ${id}`);
        }

        const data = await response.json();
        const current = data.current;

        if (
          !current ||
          current.wind_gusts_10m == null ||
          current.precipitation == null
        ) {
          throw new Error(`Incomplete weather data for ${id}`);
        }

        return [
          id,
          {
            wind: current.wind_speed_10m ?? 0,
            gust: current.wind_gusts_10m,
            rain: current.rain ?? 0,
            precipitation: current.precipitation,
            snow: current.snowfall ?? 0,
            time: current.time,
            timezone: data.timezone,
            source: 'Open-Meteo'
          }
        ];
      })
    );

    return Response.json({
      nodes: Object.fromEntries(results),
      fetchedAt: new Date().toISOString(),
      source: 'Open-Meteo'
    });
  } catch (error) {
    console.error('Live weather fetch failed:', error);

    return Response.json(
      { error: 'Live weather unavailable. Please retry.' },
      { status: 502 }
    );
  }
}
