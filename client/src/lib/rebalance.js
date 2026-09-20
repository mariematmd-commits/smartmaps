import { distKm } from './geo.js';

// Re-spread the week after she has moved somebody.
//
// The rules come from how the week is actually worked: days she has already
// dealt with are history, anyone she has spoken to keeps the day they agreed,
// and the patient she just moved stays where she put them. Everything still
// unspoken-for is fair game and gets re-clustered so the remaining days stay
// geographically tight.
//
// `pivotDate` is the earliest day the change touched — nothing before it moves.
// Moving someone to an earlier day therefore just slots them into that day and
// re-tidies from there; moving them later re-tidies from the day they left.

// A patient this far from every existing cluster is better off starting a new
// day than being tacked onto a distant one.
const NEW_DAY_KM = 9;

const located = (p) => p && p.lat != null && p.lng != null;

// Distance from a patient to the nearest member of a day, not to its centre —
// a day covering one town shouldn't look "far" because of its average point.
function nearestKm(patient, list) {
  let best = Infinity;
  for (const q of list) {
    if (!located(q)) continue;
    const d = distKm(patient, q);
    if (d < best) best = d;
  }
  return best;
}

export function rebalanceFrom({ days, pivotDate, pinnedIds, maxPerDay = 8 }) {
  const pinned = pinnedIds instanceof Set ? pinnedIds : new Set(pinnedIds || []);
  const before = days.filter((d) => d.date < pivotDate);
  const inScope = days.filter((d) => d.date >= pivotDate);
  if (inScope.length === 0) return { days, moved: 0 };

  // Each in-scope day starts with only the people who are staying put.
  const kept = new Map(
    inScope.map((d) => [d.date, d.patients.filter((p) => pinned.has(p.id))])
  );
  const whereWas = new Map();
  for (const d of inScope) for (const p of d.patients) whereWas.set(p.id, d.date);

  const free = inScope
    .flatMap((d) => d.patients.filter((p) => !pinned.has(p.id)))
    // Most urgent first, so if capacity runs out it's the least pressing that
    // spills to the end of the week.
    .sort((a, b) => (a.due_by || '').localeCompare(b.due_by || ''));

  for (const p of free) {
    let bestDate = null;
    let bestCost = Infinity;
    for (const d of inScope) {
      const list = kept.get(d.date);
      if (list.length >= maxPerDay) continue;
      // An empty day costs a flat amount: worth opening for someone far away,
      // not worth it for someone who sits inside an existing cluster.
      const cost = list.length === 0 || !located(p) ? NEW_DAY_KM : nearestKm(p, list);
      // Ties go to the earlier day so the week fills front to back.
      if (cost < bestCost - 0.001) {
        bestCost = cost;
        bestDate = d.date;
      }
    }
    // Every day full: keep them where they were rather than dropping them.
    if (!bestDate) bestDate = whereWas.get(p.id) ?? inScope[inScope.length - 1].date;
    kept.get(bestDate).push(p);
  }

  let moved = 0;
  const rebuilt = inScope.map((d) => {
    const patients = kept
      .get(d.date)
      .slice()
      .sort((a, b) => (a.due_by || '').localeCompare(b.due_by || ''));
    for (const p of patients) if (whereWas.get(p.id) !== d.date) moved++;
    return { ...d, patients };
  });

  return { days: [...before, ...rebuilt], moved };
}
