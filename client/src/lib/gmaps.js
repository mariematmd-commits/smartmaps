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

// Traffic-aware drive minutes for every origin→destination pair, or null on
// failure (caller falls back to distance estimates).
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
