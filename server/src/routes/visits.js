import { Router } from 'express';
import db from '../db.js';
import { isDateStr } from '../dates.js';

const router = Router();

// Visit fields joined with the patient info the UI needs.
const SELECT_JOINED = `
  SELECT v.id, v.patient_id, v.date, v.status, v.win_start, v.win_end, v.slot_time,
         v.is_emergency, v.notes,
         p.name, p.phone, p.phone2, p.address, p.lat, p.lng, p.due_by, p.visit_minutes
  FROM visits v JOIN patients p ON p.id = v.patient_id
`;

// GET /api/visits?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (isDateStr(from) && isDateStr(to)) {
    rows = db
      .prepare(`${SELECT_JOINED} WHERE v.date BETWEEN ? AND ? ORDER BY v.date, v.win_start IS NULL, v.win_start`)
      .all(from, to);
  } else {
    rows = db.prepare(`${SELECT_JOINED} ORDER BY v.date`).all();
  }
  res.json(rows);
});

// POST /api/visits — manually add a patient to a day (or emergency insert)
// body: { patient_id, date, status?, is_emergency?, win_start?, win_end?, notes? }
router.post('/', (req, res) => {
  const b = req.body || {};
  const patient = db.prepare('SELECT id FROM patients WHERE id = ?').get(b.patient_id);
  if (!patient) return res.status(400).json({ error: 'Unknown patient.' });
  if (!isDateStr(b.date)) return res.status(400).json({ error: 'A valid date is required.' });

  const info = db
    .prepare(
      `INSERT INTO visits (patient_id, date, status, is_emergency, win_start, win_end, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.patient_id,
      b.date,
      b.status || 'proposed',
      b.is_emergency ? 1 : 0,
      b.win_start || null,
      b.win_end || null,
      b.notes || null
    );
  res.status(201).json(db.prepare(`${SELECT_JOINED} WHERE v.id = ?`).get(info.lastInsertRowid));
});

// PATCH /api/visits/:id — update status / time window / notes / emergency
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM visits WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Visit not found.' });

  const b = req.body || {};
  const fields = [];
  const values = [];
  const set = (col, val) => { fields.push(`${col} = ?`); values.push(val); };

  if (b.status !== undefined) {
    const allowed = ['proposed', 'confirmed', 'declined', 'callback'];
    if (!allowed.includes(b.status)) return res.status(400).json({ error: 'Invalid status.' });
    set('status', b.status);
  }
  if (b.win_start !== undefined) set('win_start', b.win_start || null);
  if (b.win_end !== undefined) set('win_end', b.win_end || null);
  if (b.slot_time !== undefined) set('slot_time', b.slot_time || null);
  if (b.notes !== undefined) set('notes', b.notes || null);
  if (b.is_emergency !== undefined) set('is_emergency', b.is_emergency ? 1 : 0);
  if (b.date !== undefined && isDateStr(b.date)) set('date', b.date);

  if (fields.length === 0) {
    return res.json(db.prepare(`${SELECT_JOINED} WHERE v.id = ?`).get(req.params.id));
  }
  db.prepare(`UPDATE visits SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...values, req.params.id);
  res.json(db.prepare(`${SELECT_JOINED} WHERE v.id = ?`).get(req.params.id));
});

// DELETE /api/visits/:id
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM visits WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Visit not found.' });
  res.status(204).end();
});

export default router;
