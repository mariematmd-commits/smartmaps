// Workload view + "level the load" (browser port). Operates on the in-memory
// patients array; levelLoad mutates due_by in place and returns how many moved.

import { toStr, addDaysStr, mondayOf, daysBetween } from './dates.js';

function capacityOf(settings) {
  const workDays = settings.work_days || [1, 2, 3, 4, 5];
  const maxPerDay = settings.max_per_day || 4;
  return workDays.length * maxPerDay;
}

function bucketize(patients, settings, weeks, projected) {
  const capacity = capacityOf(settings);
  const thisMonday = mondayOf(toStr(new Date()));
  const located = patients.filter((p) => p.due_by && p.lat != null && p.lng != null);

  const buckets = Array.from({ length: weeks }, () => []);
  let laterCount = 0;
  const idxOf = (date) => Math.floor(daysBetween(thisMonday, date) / 7);

  for (const p of located) {
    if (projected) {
      const cad = p.cadence_days > 0 ? p.cadence_days : 60;
      const firstIdx = Math.max(0, idxOf(p.due_by));
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
      if (idx < 0) idx = 0;
      if (idx >= weeks) {
        laterCount++;
        continue;
      }
      buckets[idx].push(p);
    }
  }
  return { buckets, capacity, thisMonday, laterCount };
}

export function computeWorkload(patients, settings, weeks = 10, projected = false) {
  const { buckets, capacity, thisMonday, laterCount } = bucketize(patients, settings, weeks, projected);
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

// Pull patients from over-capacity weeks into the nearest earlier week with room
// (moves due_by earlier). Mutates patient objects; returns { moved }.
export function levelLoad(patients, settings, weeks = 12) {
  const { buckets, capacity, thisMonday } = bucketize(patients, settings, weeks, false);
  const moves = [];
  for (let w = 1; w < weeks; w++) {
    while (buckets[w].length > capacity) {
      let target = -1;
      for (let e = w - 1; e >= 0; e--) {
        if (buckets[e].length < capacity) {
          target = e;
          break;
        }
      }
      if (target === -1) break;
      const patient = buckets[w].pop();
      buckets[target].push(patient);
      moves.push({ patient, toWeek: target });
    }
  }
  for (const m of moves) {
    m.patient.due_by = addDaysStr(addDaysStr(thisMonday, m.toWeek * 7), 4); // Friday of target week
  }
  return { moved: moves.length };
}
