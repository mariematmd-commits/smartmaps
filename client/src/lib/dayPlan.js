// Interactive day planner (browser port): timed schedule + "who to call next"
// suggestion. Uses real drive times from the Maps API, falling back to estimates.

import { estDriveMin } from './geo.js';
import { driveMinutesMatrix } from './gmaps.js';

const toMin = (t) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (min) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

const pub = (v, p) => ({
  id: v.id,
  patient_id: v.patient_id,
  name: p.name,
  phone: p.phone,
  address: p.address,
  lat: p.lat,
  lng: p.lng,
  due_by: p.due_by,
  visit_minutes: p.visit_minutes || 45,
  status: v.status,
  win_start: v.win_start,
  win_end: v.win_end,
  slot_time: v.slot_time,
  is_emergency: v.is_emergency,
});

export async function buildDayState({ date, patients, visits, settings, apiKey }) {
  const dayStart = settings.day_start || '08:00';
  const dayEnd = settings.day_end || '17:00';
  const byId = new Map(patients.map((p) => [p.id, p]));

  const forDay = visits
    .filter((v) => v.date === date && byId.has(v.patient_id))
    .map((v) => ({ v, p: byId.get(v.patient_id) }));

  const confirmed = forDay
    .filter(({ v }) => v.status === 'confirmed')
    .sort((a, b) => (toMin(a.v.slot_time) ?? 0) - (toMin(b.v.slot_time) ?? 0));
  const pool = forDay
    .filter(({ v }) => v.status === 'proposed' || v.status === 'callback')
    .sort((a, b) => (a.p.due_by || '').localeCompare(b.p.due_by || ''));
  const declinedCount = forDay.filter(({ v }) => v.status === 'declined').length;

  // real drive times between consecutive confirmed stops
  let schedDrives = confirmed.map(() => 0);
  if (confirmed.length > 1) {
    const pts = confirmed.map(({ p }) => p);
    const m = await driveMinutesMatrix(apiKey, pts.slice(0, -1), pts.slice(1));
    for (let i = 1; i < confirmed.length; i++) {
      const real = m && m[i - 1] ? m[i - 1][i - 1] : null;
      schedDrives[i] = real != null ? real : estDriveMin(pts[i - 1], pts[i]);
    }
  }
  const schedule = confirmed.map(({ v, p }, i) => ({ ...pub(v, p), driveFromPrev: schedDrives[i] }));

  const last = confirmed[confirmed.length - 1];
  const candidates = pool.filter(({ v, p }) => v.status === 'proposed' && p.lat != null && p.lng != null);

  let candDrive = null;
  if (last && candidates.length) {
    const m = await driveMinutesMatrix(
      apiKey,
      [last.p],
      candidates.map(({ p }) => p)
    );
    candDrive = m ? m[0] : null;
  }
  const driveTo = (p, idx) => {
    const real = candDrive ? candDrive[idx] : null;
    return real != null ? real : estDriveMin(last.p, p);
  };

  let suggestion = null;
  if (candidates.length) {
    if (!last) {
      const best = candidates
        .slice()
        .sort((a, b) => (a.p.due_by || '').localeCompare(b.p.due_by || ''))[0];
      const startMin = toMin(dayStart);
      const t = best.v.win_start ? Math.max(startMin, toMin(best.v.win_start)) : startMin;
      suggestion = { ...pub(best.v, best.p), driveMin: 0, suggested_time: toHHMM(t), reason: 'most urgent' };
    } else {
      const lastEnd = (toMin(last.v.slot_time) ?? toMin(dayStart)) + (last.p.visit_minutes || 45);
      let best = null;
      let bestScore = Infinity;
      let bestArrive = null;
      let bestDrive = 0;
      candidates.forEach((c, idx) => {
        const drive = driveTo(c.p, idx);
        let arrive = lastEnd + drive;
        if (c.v.win_start) arrive = Math.max(arrive, toMin(c.v.win_start));
        const windowMiss = c.v.win_end && arrive + (c.p.visit_minutes || 45) > toMin(c.v.win_end);
        const dd = daysUntil(c.p.due_by);
        const urgency = Math.max(0, 14 - (dd ?? 14));
        let score = drive - urgency * 1.5;
        if (windowMiss) score += 1000;
        if (score < bestScore) {
          bestScore = score;
          best = c;
          bestArrive = arrive;
          bestDrive = drive;
        }
      });
      const dd = daysUntil(best.p.due_by);
      const reason = dd != null && dd <= 3 ? `${bestDrive} min away · due soon` : `${bestDrive} min away`;
      suggestion = { ...pub(best.v, best.p), driveMin: bestDrive, suggested_time: toHHMM(bestArrive), reason };
    }
  }

  return {
    date,
    dayStart,
    dayEnd,
    schedule,
    pool: pool.map(({ v, p }) => pub(v, p)),
    poolCount: pool.length,
    declinedCount,
    suggestion,
  };
}
