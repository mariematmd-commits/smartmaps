// Route optimization via the Google Routes API (directions v2:computeRoutes).
// Given a start address and a set of located patients, returns the fastest
// visiting order (traffic-aware), per-leg drive times, and an encoded polyline.

import { geocode } from './geocode.js';
import { getGoogleKey } from './config.js';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

function waypoint(lat, lng) {
  return { location: { latLng: { latitude: lat, longitude: lng } } };
}

// Routes API returns durations like "1234s".
function parseSeconds(d) {
  if (!d) return 0;
  const m = String(d).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * @param {object} args
 * @param {string} args.startAddress - free-form home/office address to start & end at
 * @param {Array<{id:number,name:string,lat:number,lng:number}>} args.stops - located patients
 * @param {boolean} [args.returnHome=true] - end the route back at the start location
 */
export async function optimizeRoute({ startAddress, stops, returnHome = true }) {
  const key = getGoogleKey();
  if (!key) {
    const e = new Error('Google Maps key not set. Add it in Settings.'); e.code = 'NO_API_KEY'; throw e;
  }
  if (!startAddress || !startAddress.trim()) {
    const e = new Error('A start location is required.'); e.code = 'NO_START'; throw e;
  }
  if (!stops || stops.length === 0) {
    const e = new Error('Add at least one mapped patient to the route.'); e.code = 'NO_STOPS'; throw e;
  }

  // Where the day starts (and, if returnHome, ends).
  const start = await geocode(startAddress);

  const body = {
    origin: waypoint(start.lat, start.lng),
    destination: returnHome
      ? waypoint(start.lat, start.lng)
      : waypoint(stops[stops.length - 1].lat, stops[stops.length - 1].lng),
    intermediates: (returnHome ? stops : stops.slice(0, -1)).map((s) => waypoint(s.lat, s.lng)),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    optimizeWaypointOrder: true,
  };

  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': [
        'routes.optimizedIntermediateWaypointIndex',
        'routes.duration',
        'routes.distanceMeters',
        'routes.legs.duration',
        'routes.legs.distanceMeters',
        'routes.polyline.encodedPolyline',
      ].join(','),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `Route optimization failed (${res.status}).`;
    const e = new Error(msg);
    e.code = data.error?.status || 'ROUTE_ERROR';
    // Surface the common "API not enabled" case with a friendlier hint.
    if (/Routes API has not been used|is disabled/i.test(msg)) {
      e.message = 'The Routes API is not enabled yet. Enable "Routes API" in your Google Cloud project, then try again.';
      e.code = 'ROUTES_API_DISABLED';
    }
    throw e;
  }

  const route = data.routes?.[0];
  if (!route) {
    const e = new Error('No route could be computed for these stops.'); e.code = 'NO_ROUTE'; throw e;
  }

  // Map Google's optimized order back onto our stops (the intermediates order).
  const intermediates = returnHome ? stops : stops.slice(0, -1);
  const order = route.optimizedIntermediateWaypointIndex || intermediates.map((_, i) => i);
  const orderedStops = order.map((i) => intermediates[i]);
  if (!returnHome) orderedStops.push(stops[stops.length - 1]);

  const legs = (route.legs || []).map((l) => ({
    durationSec: parseSeconds(l.duration),
    distanceMeters: l.distanceMeters || 0,
  }));

  return {
    start: { address: start.formatted, lat: start.lat, lng: start.lng },
    returnHome,
    orderedStops,                 // [{id,name,lat,lng}] in visit order
    legs,                         // leg[0]=start→stop1 … last=lastStop→(home or nothing)
    totalDurationSec: parseSeconds(route.duration),
    totalDistanceMeters: route.distanceMeters || 0,
    polyline: route.polyline?.encodedPolyline || null,
  };
}
