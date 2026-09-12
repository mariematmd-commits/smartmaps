// Workload view + "level the load": show how many patients are due each upcoming
// week, and smooth overloaded weeks by pulling patients EARLIER (visiting a bit
// early is fine; visiting late risks missing a deadline).

import db from './db.js';
import { toStr, addDaysStr } from './dates.js';

function settings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const { key, value } of rows) s[key] = value;
  let workDays = [1, 2, 3, 4, 5];
  try {
    workDays = JSON.parse(s.work_days ?? '[1,2,3,4,5]');
  } catch {
    /* default */
  }
  return { workDays, maxPerDay: parseInt(s.max_per_day, 10) || 8 };
}

function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const diff = dt.getDay() === 0 ? -6 : 1 - dt.getDay();
  dt.setDate(dt.getDate() + diff);
  return toStr(dt);
}
function todayLocal() {
  return toStr(new Date());
}
function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}

// Bucket patients (that have a deadline + location) into the next `weeks` weeks.
// Overdue patients land in week 0. With `projected`, each patient is also placed
// in their FUTURE cycles (due_by + cadence, +2·cadence, …) so the ongoing rhythm
// shows past their single current deadline. Returns weeks[], capacity, buckets.
function bucketize(weeks, projected = false) {
  const { workDays, maxPerDay } = settings();
  const capacity = workDays.length * maxPerDay;
  const thisMonday = mondayOf(todayLocal());

  const patients = db
    .prepare('SELECT id, name, due_by, cadence_days, lat, lng FROM patients WHERE due_by IS NOT NULL')
    .all()
    .filter((p) => p.lat != null && p.lng != null);

  const buckets = Array.from({ length: weeks }, () => []);
  let laterCount = 0;
  const idxOf = (date) => Math.floor(daysBetween(thisMonday, date) / 7);

  for (const p of patients) {
    if (projected) {
      const cad = p.cadence_days > 0 ? p.cadence_days : 60;
      const firstIdx = Math.max(0, idxOf(p.due_by)); // current deadline (overdue -> week 0)
      if (firstIdx < weeks) buckets[firstIdx].push(p);
      let date = addDaysStr(p.due_by, cad);
      for (let guard = 0; guard < 500; guard++) {
        const idx = idxOf(date);
        if (idx >= weeks) break;
        if (idx > firstIdx) buckets[idx].push(p);
        date = addDaysStr(date, cad);
      }
    } else {
      let idx = idxOf(p.due_by);
      if (idx < 0) idx = 0; // overdue -> this week
      if (idx >= weeks) {
        laterCount++;
        continue;
      }
      buckets[idx].push(p);
    }
  }
  return { buckets, capacity, thisMonday, laterCount };
}

export function computeWorkload(weeks = 10, projected = false) {
  const { buckets, capacity, thisMonday, laterCount } = bucketize(weeks, projected);
  return {
    capacity,
    laterCount,
    weeks: buckets.map((b, i) => ({
      weekStart: addDaysStr(thisMonday, i * 7),
      count: b.length,
      over: Math.max(0, b.length - capacity),
    })),
  };
}

// Pull patients out of over-capacity weeks into the nearest EARLIER week that
// has room (moving their deadline earlier). Returns how many moved.
export function levelLoad(weeks = 12) {
  const { buckets, capacity, thisMonday } = bucketize(weeks);
  const moves = []; // { id, toWeek }

  for (let w = 1; w < weeks; w++) {
    while (buckets[w].length > capacity) {
      // nearest earlier week with spare room
      let target = -1;
      for (let e = w - 1; e >= 0; e--) {
        if (buckets[e].length < capacity) {
          target = e;
          break;
        }
      }
      if (target === -1) break; // everything earlier is full; can't level this week
      const patient = buckets[w].pop();
      buckets[target].push(patient);
      moves.push({ id: patient.id, toWeek: target });
    }
  }

  // Apply: set each moved patient's deadline to the Friday of its new week.
  const upd = db.prepare("UPDATE patients SET due_by = ?, updated_at = datetime('now') WHERE id = ?");
  const tx = db.transaction(() => {
    for (const m of moves) {
      const friday = addDaysStr(addDaysStr(thisMonday, m.toWeek * 7), 4);
      upd.run(friday, m.id);
    }
  });
  tx();

  return { moved: moves.length };
}
