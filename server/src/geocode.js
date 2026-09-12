// Server-side geocoding via Google Geocoding API.
// Reads the key from Settings (see config.js). Gracefully reports when unset.

import { getGoogleKey } from './config.js';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export function hasGeocoding() {
  return Boolean(getGoogleKey());
}

/**
 * Geocode a free-form address string.
 * @returns {Promise<{lat:number,lng:number,formatted:string}>}
 * @throws Error with a human-readable message on failure.
 */
export async function geocode(address) {
  const key = getGoogleKey();
  if (!key) {
    const err = new Error('Google Maps key not set. Add it in Settings.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (!address || !address.trim()) {
    const err = new Error('Address is empty.');
    err.code = 'EMPTY_ADDRESS';
    throw err;
  }

  const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status === 'OK' && data.results?.length) {
    const best = data.results[0];
    return {
      lat: best.geometry.location.lat,
      lng: best.geometry.location.lng,
      formatted: best.formatted_address,
    };
  }
  if (data.status === 'ZERO_RESULTS') {
    const err = new Error('No location found for that address.');
    err.code = 'ZERO_RESULTS';
    throw err;
  }
  const err = new Error(data.error_message || `Geocoding failed (${data.status}).`);
  err.code = data.status || 'GEOCODE_ERROR';
  throw err;
}
