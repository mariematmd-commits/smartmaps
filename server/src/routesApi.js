// Real drive times via the Google Routes API (computeRouteMatrix). Falls back
// to null on any problem so callers can use distance estimates instead.

import { getGoogleKey } from './config.js';

const MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

const wp = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
const parseSec = (d) => {
  const m = String(d || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
};

/**
 * Traffic-aware drive minutes for every origin→destination pair.
 * @returns {Promise<number[][]|null>} minutes[originIdx][destIdx], or null if unavailable.
 */
export async function driveMinutesMatrix(origins, destinations) {
  const key = getGoogleKey();
  if (!key || !origins.length || !destinations.length) return null;
  if (origins.some((p) => p.lat == null) || destinations.some((p) => p.lat == null)) return null;

  const body = {
    origins: origins.map(wp),
    destinations: destinations.map(wp),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };

  try {
    const res = await fetch(MATRIX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;

    const m = origins.map(() => destinations.map(() => null));
    for (const el of data) {
      const sec = parseSec(el.duration);
      if (el.condition === 'ROUTE_EXISTS' && sec != null) {
        m[el.originIndex][el.destinationIndex] = Math.max(1, Math.round(sec / 60));
      }
    }
    return m;
  } catch {
    return null;
  }
}
