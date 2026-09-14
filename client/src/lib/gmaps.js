// Google Maps, entirely in the browser. Geocoding + drive times use the Maps
// JavaScript API services with the nurse's own key — no server, no shared key.

import { Loader } from '@googlemaps/js-api-loader';

let loaderPromise = null;
let loadedKey = null;

// Load (once) the Maps libraries we need. Same options as MapView so the
// js-api-loader singleton is happy.
export function loadGoogle(apiKey) {
  if (!apiKey) return Promise.reject(new Error('No Google Maps key set.'));
  if (loaderPromise && loadedKey === apiKey) return loaderPromise;
  loadedKey = apiKey;
  const loader = new Loader({ apiKey, version: 'weekly' });
  loaderPromise = Promise.all([
    loader.importLibrary('maps'),
    loader.importLibrary('geometry'),
    loader.importLibrary('geocoding'),
    loader.importLibrary('routes'),
  ]).then(([maps, geometry, geocoding, routes]) => ({ maps, geometry, geocoding, routes }));
  return loaderPromise;
}

export function hasKey(apiKey) {
  return Boolean(apiKey && apiKey.trim());
}

// Geocode a free-form address to { lat, lng, formatted }.
export async function geocodeAddress(apiKey, address) {
  if (!hasKey(apiKey)) {
    const e = new Error('Google Maps key not set. Add it in Settings.');
    e.code = 'NO_API_KEY';
    throw e;
  }
  const { geocoding } = await loadGoogle(apiKey);
  const geocoder = new geocoding.Geocoder();
  let results;
  try {
    ({ results } = await geocoder.geocode({ address }));
  } catch (err) {
    const e = new Error(err?.message || 'Address could not be located.');
    e.code = 'GEOCODE_ERROR';
    throw e;
  }
  if (!results?.length) {
    const e = new Error('No location found for that address.');
    e.code = 'ZERO_RESULTS';
    throw e;
  }
  const best = results[0];
  return {
    lat: best.geometry.location.lat(),
    lng: best.geometry.location.lng(),
    formatted: best.formatted_address,
  };
}

// Road-following geometry for an ordered run of stops, via Routes API v2.
//
// Why this one: the browser's legacy DirectionsService and DistanceMatrix are
// both REQUEST_DENIED on this project (they're legacy APIs), but computeRoutes
// answers straight from the browser over CORS. One request returns the encoded
// polyline that follows actual streets AND traffic-aware per-leg durations, so
// a day's route costs a single call.
//
// points: [{lat,lng}] in visit order. `loop` repeats the first point as the
// destination (used when a home base starts and ends the day).
// Returns { polyline, legMinutes[], totalMinutes, totalMeters } or null.
export async function routeGeometry(apiKey, points, loop = false) {
  if (!hasKey(apiKey) || !points || points.length < 2) return null;
  if (points.some((p) => p?.lat == null)) return null;

  const at = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const origin = points[0];
  const destination = loop ? points[0] : points[points.length - 1];
  const middle = loop ? points.slice(1) : points.slice(1, -1);

  try {
    const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'routes.polyline.encodedPolyline,routes.duration,routes.distanceMeters,routes.legs.duration',
      },
      body: JSON.stringify({
        origin: at(origin),
        destination: at(destination),
        intermediates: middle.map(at),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        polylineQuality: 'OVERVIEW',
      }),
    });
    if (!resp.ok) return null;
    const route = (await resp.json())?.routes?.[0];
    const encoded = route?.polyline?.encodedPolyline;
    if (!encoded) return null;
    const secs = (s) => (s ? Math.max(1, Math.round(parseInt(s, 10) / 60)) : null);
    return {
      polyline: encoded,
      legMinutes: (route.legs || []).map((l) => secs(l.duration)),
      totalMinutes: secs(route.duration),
      totalMeters: route.distanceMeters ?? null,
    };
  } catch {
    return null;
  }
}

// Traffic-aware drive minutes for consecutive legs along an ordered route:
// points[0]→[1], [1]→[2], … Returns one value per leg (length points.length-1),
// with null where a leg couldn't be resolved, or null if the whole lookup fails.
//
// Distance Matrix bills per ELEMENT (one origin×destination pair), so asking for
// the full cross-product of an 8-stop day would bill 49 elements to use the 7 on
// the diagonal. Issuing one 1×1 request per leg bills exactly the 7 needed.
// They run in parallel, so it is no slower in wall-clock terms.
export async function driveMinutesLegs(apiKey, points) {
  if (!hasKey(apiKey) || !points || points.length < 2) return null;
  if (points.some((p) => p?.lat == null)) return null;
  const legs = await Promise.all(
    points.slice(0, -1).map(async (from, i) => {
      const m = await driveMinutesMatrix(apiKey, [from], [points[i + 1]]);
      return m?.[0]?.[0] ?? null;
    })
  );
  return legs.every((v) => v == null) ? null : legs;
}

// Traffic-aware drive minutes for every origin→destination pair, or null on
// failure (caller falls back to distance estimates). Bills origins×destinations
// elements — prefer driveMinutesLegs for consecutive stops along a route.
export async function driveMinutesMatrix(apiKey, origins, destinations) {
  if (!hasKey(apiKey) || !origins.length || !destinations.length) return null;
  if (origins.some((p) => p.lat == null) || destinations.some((p) => p.lat == null)) return null;
  try {
    const { routes } = await loadGoogle(apiKey);
    const svc = new routes.DistanceMatrixService();
    const resp = await svc.getDistanceMatrix({
      origins: origins.map((o) => ({ lat: o.lat, lng: o.lng })),
      destinations: destinations.map((d) => ({ lat: d.lat, lng: d.lng })),
      travelMode: 'DRIVING',
      drivingOptions: { departureTime: new Date(Date.now() + 60000) },
    });
    return origins.map((_, i) =>
      destinations.map((_, j) => {
        const el = resp.rows[i]?.elements[j];
        if (el?.status === 'OK') {
          const sec = (el.duration_in_traffic || el.duration).value;
          return Math.max(1, Math.round(sec / 60));
        }
        return null;
      })
    );
  } catch {
    return null;
  }
}
