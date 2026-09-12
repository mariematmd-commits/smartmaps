// Interactive day planner: given a date, returns the timed schedule built so far
// and the single best "who to call next" suggestion.

import db from './db.js';
import { estDriveMin } from './geo.js';
import { driveMinutesMatrix } from './routesApi.js';

function readTimes() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const { key, value } of rows) s[key] = value;
  return { dayStart: s.day_start || '08:00', dayEnd: s.day_end || '17:00' };
}

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

const pub = (v) => ({
  id: v.id,
  patient_id: v.patient_id,
  name: v.name,
  phone: v.phone,
  address: v.address,
  lat: v.lat,
  lng: v.lng,
  due_by: v.due_by,
  visit_minutes: v.visit_minutes || 45,
  status: v.status,
  win_start: v.win_start,
  win_end: v.win_end,
  slot_time: v.slot_time,
  is_emergency: v.is_emergency,
});

export async function buildDayState(date) {
  const { dayStart, dayEnd } = readTimes();
  const visits = db
    .prepare(
      `SELECT v.*, p.name, p.phone, p.address, p.lat, p.lng, p.due_by, p.visit_minutes
       FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.date = ?`
    )
    .all(date);

  const confirmed = visits
    .filter((v) => v.status === 'confirmed')
    .sort((a, b) => (toMin(a.slot_time) ?? 0) - (toMin(b.slot_time) ?? 0));
  // "pool" = still to handle (shown to the nurse). Only 'proposed' feed the
  // next-call suggestion; 'callback' are deferred until she comes back to them.
  const pool = visits
    .filter((v) => v.status === 'proposed' || v.status === 'callback')
    .sort((a, b) => (a.due_by || '').localeCompare(b.due_by || ''));
  const declinedCount = visits.filter((v) => v.status === 'declined').length;

  // Real drive times (traffic-aware) between consecutive confirmed stops,
  // falling back to distance estimates if the Routes API isn't available.
  let schedDrives = confirmed.map(() => 0);
  if (confirmed.length > 1) {
    const m = await driveMinutesMatrix(confirmed.slice(0, -1), confirmed.slice(1));
    for (let i = 1; i < confirmed.length; i++) {
      const real = m && m[i - 1] ? m[i - 1][i - 1] : null;
      schedDrives[i] = real != null ? real : estDriveMin(confirmed[i - 1], confirmed[i]);
    }
  }
  const schedule = confirmed.map((v, i) => ({ ...pub(v), driveFromPrev: schedDrives[i] }));

  const last = confirmed[confirmed.length - 1];
  const candidates = pool.filter(
    (v) => v.status === 'proposed' && v.lat != null && v.lng != null
  );
  // Real drive minutes from the last stop to each candidate (one API call).
  let candDrive = null;
  if (last && candidates.length) {
    const m = await driveMinutesMatrix([last], candidates);
    candDrive = m ? m[0] : null;
  }
  const driveTo = (c, idx) => {
    const real = candDrive ? candDrive[idx] : null;
    return real != null ? real : estDriveMin(last, c);
  };

  let suggestion = null;
  if (candidates.length) {
    if (!last) {
      // First call: the most urgent patient, earliest workable slot.
      const best = candidates
        .slice()
        .sort((a, b) => (a.due_by || '').localeCompare(b.due_by || ''))[0];
      const startMin = toMin(dayStart);
      const t = best.win_start ? Math.max(startMin, toMin(best.win_start)) : startMin;
      suggestion = { ...pub(best), driveMin: 0, suggested_time: toHHMM(t), reason: 'most urgent' };
    } else {
      const lastEnd = (toMin(last.slot_time) ?? toMin(dayStart)) + (last.visit_minutes || 45);
      let best = null;
      let bestScore = Infinity;
      let bestArrive = null;
      let bestDrive = 0;
      candidates.forEach((c, idx) => {
        const drive = driveTo(c, idx);
        let arrive = lastEnd + drive;
        if (c.win_start) arrive = Math.max(arrive, toMin(c.win_start));
        const windowMiss = c.win_end && arrive + (c.visit_minutes || 45) > toMin(c.win_end);
        const dd = daysUntil(c.due_by);
        const urgency = Math.max(0, 14 - (dd ?? 14)); // 0..14, higher = sooner
        let score = drive - urgency * 1.5; // nearest first, urgency pulls forward
        if (windowMiss) score += 1000; // can't fit their window right now → defer
        if (score < bestScore) {
          bestScore = score;
          best = c;
          bestArrive = arrive;
          bestDrive = drive;
        }
      });
      const reason =
        daysUntil(best.due_by) != null && daysUntil(best.due_by) <= 3
          ? `${bestDrive} min away · due soon`
          : `${bestDrive} min away`;
      suggestion = {
        ...pub(best),
        driveMin: bestDrive,
        suggested_time: toHHMM(bestArrive),
        reason,
      };
    }
  }

  return {
    date,
    dayStart,
    dayEnd,
    schedule,
    pool: pool.map(pub),
    poolCount: pool.length,
    declinedCount,
    suggestion,
  };
}
