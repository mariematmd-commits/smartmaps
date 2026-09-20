import { distKm } from './geo.js';
import { addDaysStr, todayStr } from './dates.js';

// Every patient is meant to be seen within ±5 days of their due date. The late
// half of that is the one that matters: once due + 5 has passed, the visit is
// genuinely missed rather than merely pending. This works out who is heading
// that way and where they could go instead.

export const WINDOW_DAYS = 5;

// The last date a visit still counts as on time.
export const lastAcceptableDay = (dueBy) => (dueBy ? addDaysStr(dueBy, WINDOW_DAYS) : null);

const dayDiff = (a, b) => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(ay, am - 1, ad) - new Date(by, bm - 1, bd)) / 86400000);
};

// 'missed'  — due + 5 is already behind us
// 'closing' — still inside the window, but it shuts within a week
// 'ok'      — plenty of room
// 'none'    — no due date set, so there's nothing to miss
export function windowState(patient, today = todayStr()) {
  if (!patient?.due_by) return { level: 'none' };
  const lastDay = lastAcceptableDay(patient.due_by);
  const daysLeft = dayDiff(lastDay, today);
  if (daysLeft < 0) return { level: 'missed', lastDay, daysLeft, daysOver: -daysLeft };
  if (daysLeft <= 7) return { level: 'closing', lastDay, daysLeft };
  return { level: 'ok', lastDay, daysLeft };
}

// Everyone whose window has shut or is about to, worst first, so the nurse can
// deal with the most overdue before the merely urgent.
export function atRisk(patients, today = todayStr()) {
  return patients
    .map((p) => ({ patient: p, ...windowState(p, today) }))
    .filter((r) => r.level === 'missed' || r.level === 'closing')
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

const located = (p) => p && p.lat != null && p.lng != null;

// Where should this patient go? Prefer a day still inside their window, and
// among those the one already visiting nearby, so slotting them in doesn't add
// a detour. Falls back to the soonest day with room when the window has closed.
export function suggestDay(patient, days, { maxPerDay = 8, today = todayStr() } = {}) {
  const state = windowState(patient, today);
  if (state.level === 'none') return null;

  const open = days.filter(
    (d) => d.date >= today && (d.patients?.length ?? 0) < maxPerDay
  );
  if (!open.length) return null;

  const inWindow = open.filter((d) => d.date <= state.lastDay);
  const pool = inWindow.length ? inWindow : open;

  let best = pool[0];
  let bestKm = Infinity;
  if (located(patient)) {
    for (const d of pool) {
      let km = Infinity;
      for (const q of d.patients || []) {
        if (!located(q)) continue;
        const km2 = distKm(patient, q);
        if (km2 < km) km = km2;
      }
      // An empty day is workable but not preferred over a nearby one.
      if (km === Infinity) km = 12;
      if (km < bestKm - 0.001) {
        bestKm = km;
        best = d;
      }
    }
  }

  return {
    date: best.date,
    label: best.label,
    inWindow: inWindow.length > 0,
    nearestKm: bestKm === Infinity ? null : bestKm,
    state,
  };
}
