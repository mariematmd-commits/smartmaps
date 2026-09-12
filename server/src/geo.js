// Geographic + drive-time helpers.

const EARTH_KM = 6371;

export function distKm(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

// Rough drive-time estimate from straight-line distance until we wire the Routes
// API: inflate for real roads (~1.3x) at ~35 km/h suburban average, + a few
// minutes of parking/getting-in overhead. Swap this out for real times later.
export function estDriveMin(a, b) {
  if (a?.lat == null || b?.lat == null) return 15;
  const roadKm = distKm(a, b) * 1.3;
  return Math.max(5, Math.round((roadKm / 35) * 60) + 3);
}
