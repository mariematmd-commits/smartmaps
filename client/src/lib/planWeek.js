// Weekly call-list builder (browser port). Groups coming-due patients by area
// into work days, ordered by urgency, with nearby backups.

import { addDaysStr } from './dates.js';
import { distKm } from './geo.js';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VISIT_WINDOW_DAYS = 5;

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
function centroid(list) {
  const lat = list.reduce((s, p) => s + p.lat, 0) / list.length;
  const lng = list.reduce((s, p) => s + p.lng, 0) / list.length;
  return { lat, lng };
}
function earliestDue(list) {
  return list.reduce((min, p) => (p.due_by < min ? p.due_by : min), list[0].due_by);
}
function medianNearestNeighbor(points) {
  if (points.length < 2) return 0;
  const nn = points.map((p, i) => {
    let md = Infinity;
    points.forEach((q, j) => {
      if (i !== j) md = Math.min(md, distKm(p, q));
    });
    return md;
  });
  nn.sort((a, b) => a - b);
  const mid = Math.floor(nn.length / 2);
  return nn.length % 2 ? nn[mid] : (nn[mid - 1] + nn[mid]) / 2;
}
function connectedComponents(points, epsilon) {
  const parent = points.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      if (distKm(points[i], points[j]) <= epsilon) parent[find(i)] = find(j);
  const groups = new Map();
  points.forEach((p, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p);
  });
  return [...groups.values()];
}
function seedCentroids(points, k) {
  const seeds = [{ lat: points[0].lat, lng: points[0].lng }];
  while (seeds.length < k) {
    let best = null;
    let bestDist = -1;
    for (const p of points) {
      let minD = Infinity;
      for (const s of seeds) minD = Math.min(minD, distKm(p, s));
      if (minD > bestDist) {
        bestDist = minD;
        best = p;
      }
    }
    if (!best) break;
    seeds.push({ lat: best.lat, lng: best.lng });
  }
  return seeds;
}
function kmeans(points, k) {
  let centroids = seedCentroids(points, k);
  let clusters = centroids.map(() => []);
  for (let iter = 0; iter < 12; iter++) {
    clusters = centroids.map(() => []);
    for (const p of points) {
      let bi = 0;
      let bd = Infinity;
      centroids.forEach((c, i) => {
        const d = distKm(p, c);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      clusters[bi].push(p);
    }
    const next = clusters.map((cl, i) => (cl.length ? centroid(cl) : centroids[i]));
    const moved = next.some((c, i) => distKm(c, centroids[i]) > 0.01);
    centroids = next;
    if (!moved) break;
  }
  return { clusters, centroids };
}
function enforceCapacity(clusters, centroids, cap) {
  for (let guard = 0; guard < 10000; guard++) {
    const over = clusters.findIndex((c) => c.length > cap);
    if (over < 0) break;
    const cl = clusters[over];
    let fi = 0;
    let fd = -1;
    cl.forEach((p, idx) => {
      const d = distKm(p, centroids[over]);
      if (d > fd) {
        fd = d;
        fi = idx;
      }
    });
    const patient = cl[fi];
    let bi = -1;
    let bd = Infinity;
    centroids.forEach((c, i) => {
      if (i !== over && clusters[i].length < cap) {
        const d = distKm(patient, c);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
    });
    if (bi < 0) break;
    cl.splice(fi, 1);
    clusters[bi].push(patient);
  }
  return clusters;
}
function splitByCap(cluster, cap) {
  if (cluster.length <= cap) return [cluster];
  const k = Math.ceil(cluster.length / cap);
  const { clusters, centroids } = kmeans(cluster, k);
  enforceCapacity(clusters, centroids, cap);
  return clusters.filter((c) => c.length > 0);
}

const publicFields = (p) => ({
  id: p.id,
  name: p.name,
  phone: p.phone,
  phone2: p.phone2,
  address: p.address,
  due_by: p.due_by,
  lat: p.lat,
  lng: p.lng,
});

export function planWeek({ weekStart, maxPerDay, workDays, patients, backupsPerDay = 3 }) {
  const weekDates = [];
  for (let i = 0; i < 7; i++) weekDates.push(addDaysStr(weekStart, i));
  const workDates = weekDates.filter((ds) => workDays.includes(weekdayOf(ds))).sort();
  if (workDates.length === 0) {
    return { error: 'No work days set. Pick your work days in Settings.' };
  }

  const weekEnd = workDates[workDates.length - 1];
  const capacity = workDates.length * maxPerDay;

  const noDeadline = patients.filter((p) => !p.due_by);
  const withDeadline = patients.filter((p) => p.due_by);
  const needsLocation = withDeadline.filter((p) => p.lat == null || p.lng == null);
  const located = withDeadline
    .filter((p) => p.lat != null && p.lng != null)
    .sort((a, b) => a.due_by.localeCompare(b.due_by));

  const reachBy = addDaysStr(weekEnd, VISIT_WINDOW_DAYS);
  const eligible = located.filter((p) => p.due_by <= reachBy);
  const scheduled = eligible.slice(0, capacity);
  const overflowRows = eligible.slice(capacity);

  let dayClusters = [];
  if (scheduled.length > 0) {
    const epsilon = Math.max(medianNearestNeighbor(scheduled) * 3, 0.5);
    const areas = connectedComponents(scheduled, epsilon);
    let clusters = [];
    for (const area of areas) clusters.push(...splitByCap(area, maxPerDay));
    clusters.sort((a, b) => earliestDue(a).localeCompare(earliestDue(b)));
    if (clusters.length > workDates.length) {
      for (const c of clusters.slice(workDates.length)) overflowRows.push(...c);
      clusters = clusters.slice(0, workDates.length);
    }
    dayClusters = clusters;
  }

  const scheduledIds = new Set(scheduled.map((p) => p.id));
  const backupPool = located.filter((p) => !scheduledIds.has(p.id));

  const days = workDates.map((date, idx) => {
    const cluster = dayClusters[idx] || [];
    let backups = [];
    if (cluster.length > 0 && backupPool.length > 0) {
      const c = centroid(cluster);
      backups = backupPool
        .map((p) => ({ p, d: distKm(p, c) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, backupsPerDay)
        .map(({ p, d }) => ({ ...publicFields(p), distanceKm: Math.round(d * 10) / 10 }));
    }
    return {
      date,
      weekday: weekdayOf(date),
      label: WEEKDAY_LABELS[weekdayOf(date)],
      patients: cluster.map(publicFields),
      backups,
    };
  });

  return {
    weekStart,
    weekEnd,
    maxPerDay,
    scheduledCount: scheduled.length,
    days,
    needsLocation: needsLocation.map(publicFields),
    noDeadline: noDeadline.map((p) => ({ id: p.id, name: p.name })),
    overflow: overflowRows.map(publicFields),
  };
}
