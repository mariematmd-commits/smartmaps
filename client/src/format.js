// Small display helpers for durations, distances, and due dates.

// Each patient should be visited within ±this many days of their due date.
export const VISIT_WINDOW_DAYS = 5;

// Whole days from today until a YYYY-MM-DD date (negative = past).
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// A friendly due-date label + severity level for coloring, based on the ±5-day
// visit window: green = window not open yet, orange = in the window (visit now),
// red = past the window (missed).
export function dueStatus(dateStr) {
  const n = daysUntil(dateStr);
  const W = VISIT_WINDOW_DAYS;
  if (n === null) return { label: 'no due date', level: 'none' };
  if (n < -W) return { label: `${-n}d overdue`, level: 'overdue' };
  if (n < 0) return { label: `${-n}d past due`, level: 'soon' };
  if (n === 0) return { label: 'due today', level: 'soon' };
  if (n <= W) return { label: `due in ${n}d`, level: 'soon' };
  return { label: `due in ${n}d`, level: 'ok' };
}

// The visit window [due-5, due+5] as a short "Aug 20 – Aug 30" string.
export function visitWindow(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d - VISIT_WINDOW_DAYS);
  const end = new Date(y, m - 1, d + VISIT_WINDOW_DAYS);
  const f = (dt) => dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${f(start)} – ${f(end)}`;
}

// "Jul 20, 2026" from a YYYY-MM-DD string.
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}


export function formatDuration(sec) {
  if (!sec) return '0 min';
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function formatMiles(meters) {
  if (!meters) return '0 mi';
  const miles = meters / 1609.344;
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

// Build a Google Maps directions link for a planned day: start & end at the
// home base (an address string) with the confirmed stops as ordered waypoints.
// Falls back to first/last stop if no home base is set. Opens with the order we
// planned (Google keeps waypoint order for api=1 links).
export function dayRouteUrl(homeBase, stops) {
  if (!stops?.length) return null;
  const ll = (p) => `${p.lat},${p.lng}`;
  const home = homeBase && homeBase.trim();
  const origin = home || ll(stops[0]);
  const destination = home || ll(stops[stops.length - 1]);
  // With a home base every stop is an intermediate waypoint; without one, the
  // first stop is the origin and the last is the destination, so only the
  // middle stops are waypoints (otherwise the first/last get visited twice).
  const waypoints = (home ? stops : stops.slice(1, -1)).map(ll);
  const params = new URLSearchParams({ api: '1', travelmode: 'driving', origin, destination });
  if (waypoints.length) params.set('waypoints', waypoints.join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// Build a Google Maps directions deep link for turn-by-turn navigation.
// start = {lat,lng}, stops = [{lat,lng}] in visit order, returnHome bool.
export function googleMapsDirectionsUrl(start, stops, returnHome) {
  if (!start || !stops?.length) return '#';
  const ll = (p) => `${p.lat},${p.lng}`;
  const origin = ll(start);
  const destination = returnHome ? ll(start) : ll(stops[stops.length - 1]);
  const waypointStops = returnHome ? stops : stops.slice(0, -1);
  const waypoints = waypointStops.map(ll).join('|');
  const params = new URLSearchParams({
    api: '1',
    travelmode: 'driving',
    origin,
    destination,
  });
  if (waypoints) params.set('waypoints', waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
