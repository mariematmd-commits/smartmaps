import db from './db.js';

// The Google Maps key now lives in Settings (so users paste it in-app). We fall
// back to the GOOGLE_MAPS_API_KEY env var for local dev convenience.
export function getGoogleKey() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('google_api_key');
  const fromSettings = row?.value?.trim();
  return fromSettings || process.env.GOOGLE_MAPS_API_KEY || '';
}
