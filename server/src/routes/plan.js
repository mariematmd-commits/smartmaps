import { Router } from 'express';
import db from '../db.js';
import { planWeek } from '../planWeek.js';
import { buildDayState } from '../dayPlan.js';
import { computeWorkload, levelLoad } from '../workload.js';
import { isDateStr } from '../dates.js';

const router = Router();

function readSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const { key, value } of rows) s[key] = value;
  let workDays = [1, 2, 3, 4, 5];
  try {
    workDays = JSON.parse(s.work_days ?? '[1,2,3,4,5]');
  } catch {
    /* keep default */
  }
  return { workDays, maxPerDay: parseInt(s.max_per_day, 10) || 8 };
}

// POST /api/plan/week  body: { weekStart: 'YYYY-MM-DD' (Monday), maxPerDay?, workDays? }
router.post('/week', (req, res) => {
  const { weekStart } = req.body || {};
  if (!isDateStr(weekStart)) {
    return res.status(400).json({ error: 'weekStart (YYYY-MM-DD) is required.' });
  }

  const settings = readSettings();
  const maxPerDay = req.body.maxPerDay ?? settings.maxPerDay;
  const workDays = Array.isArray(req.body.workDays) ? req.body.workDays : settings.workDays;

  const patients = db
    .prepare('SELECT id, name, address, lat, lng, phone, phone2, due_by, cadence_days FROM patients')
    .all();

  const plan = planWeek({ weekStart, maxPerDay, workDays, patients });
  if (plan.error) return res.status(400).json(plan);
  res.json(plan);
});

// GET /api/plan/workload?weeks=10 — patients due per upcoming week + capacity
router.get('/workload', (req, res) => {
  const weeks = Math.min(26, Math.max(4, parseInt(req.query.weeks, 10) || 10));
  const projected = req.query.projected === '1' || req.query.projected === 'true';
  res.json(computeWorkload(weeks, projected));
});

// POST /api/plan/level — smooth overloaded weeks by pulling patients earlier
router.post('/level', (req, res) => {
  res.json(levelLoad(12));
});

// GET /api/plan/day?date=YYYY-MM-DD — timed schedule + next-call suggestion
router.get('/day', async (req, res) => {
  const { date } = req.query;
  if (!isDateStr(date)) return res.status(400).json({ error: 'date (YYYY-MM-DD) is required.' });
  res.json(await buildDayState(date));
});

// POST /api/plan/commit — save a week's plan as "proposed" visits so the nurse
// can work the call list. Idempotent: skips patients who already have a visit
// that week (preserves any calls already logged). body: { weekStart }
router.post('/commit', (req, res) => {
  const { weekStart } = req.body || {};
  if (!isDateStr(weekStart)) {
    return res.status(400).json({ error: 'weekStart (YYYY-MM-DD) is required.' });
  }
  const settings = readSettings();
  const maxPerDay = req.body.maxPerDay ?? settings.maxPerDay;
  const workDays = Array.isArray(req.body.workDays) ? req.body.workDays : settings.workDays;
  const patients = db
    .prepare('SELECT id, name, address, lat, lng, phone, phone2, due_by, cadence_days FROM patients')
    .all();

  const plan = planWeek({ weekStart, maxPerDay, workDays, patients });
  if (plan.error) return res.status(400).json(plan);

  const weekEnd = plan.weekEnd;
  const existing = db
    .prepare('SELECT DISTINCT patient_id FROM visits WHERE date BETWEEN ? AND ?')
    .all(weekStart, weekEnd);
  const already = new Set(existing.map((r) => r.patient_id));

  const insert = db.prepare(
    "INSERT INTO visits (patient_id, date, status) VALUES (?, ?, 'proposed')"
  );
  let created = 0;
  const tx = db.transaction(() => {
    for (const day of plan.days) {
      for (const p of day.patients) {
        if (already.has(p.id)) continue;
        insert.run(p.id, day.date);
        already.add(p.id);
        created++;
      }
    }
  });
  tx();

  res.json({ created, weekStart, weekEnd });
});

export default router;
