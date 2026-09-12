import { Router } from 'express';
import db from '../db.js';
import { geocode, hasGeocoding } from '../geocode.js';
import { todayStr, addDaysStr, isDateStr } from '../dates.js';

const router = Router();

// The global revisit cycle (default cadence) from Settings.
function defaultCadence() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'default_cadence_days'").get();
  const n = parseInt(r?.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

// Minimal CSV parser that handles double-quoted fields containing commas/newlines.
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // ignore
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const COLUMNS = [
  'name', 'address', 'lat', 'lng', 'phone', 'phone2',
  'email', 'notes', 'visit_minutes', 'due_by', 'cadence_days',
  'last_visited', 'availability', 'status',
];

// Whitelist + light validation of an incoming patient body.
function sanitize(body = {}) {
  const out = {};
  for (const col of COLUMNS) {
    if (body[col] !== undefined) out[col] = body[col];
  }
  if (out.name !== undefined) out.name = String(out.name).trim();
  if (out.visit_minutes !== undefined) {
    const n = parseInt(out.visit_minutes, 10);
    out.visit_minutes = Number.isFinite(n) && n > 0 ? n : 45;
  }
  if (out.cadence_days !== undefined) {
    const n = parseInt(out.cadence_days, 10);
    out.cadence_days = Number.isFinite(n) && n > 0 ? n : 60;
  }
  // Date fields: keep valid YYYY-MM-DD, otherwise null.
  for (const c of ['due_by', 'last_visited']) {
    if (out[c] !== undefined) out[c] = isDateStr(out[c]) ? out[c] : null;
  }
  for (const c of ['lat', 'lng']) {
    if (out[c] !== undefined && out[c] !== null && out[c] !== '') {
      out[c] = Number(out[c]);
    } else if (out[c] === '' ) {
      out[c] = null;
    }
  }
  return out;
}

// GET /api/patients — list all
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM patients ORDER BY name COLLATE NOCASE').all();
  res.json(rows);
});

// GET /api/patients/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Patient not found.' });
  res.json(row);
});

// POST /api/patients — create
router.post('/', (req, res) => {
  const data = sanitize(req.body);
  if (!data.name) return res.status(400).json({ error: 'Name is required.' });

  // Use the global revisit cycle when no cadence was provided.
  if (data.cadence_days === undefined) data.cadence_days = defaultCadence();

  // Every patient should have a deadline. If none was given, default it to
  // "today + cadence" so the planner can reason about when they're due.
  if (!data.due_by) {
    data.due_by = addDaysStr(todayStr(), data.cadence_days ?? defaultCadence());
  }

  const cols = Object.keys(data);
  const placeholders = cols.map(() => '?').join(', ');
  const stmt = db.prepare(
    `INSERT INTO patients (${cols.join(', ')}) VALUES (${placeholders})`
  );
  const info = stmt.run(...cols.map((c) => data[c]));
  const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

// PUT /api/patients/:id — update
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Patient not found.' });

  const data = sanitize(req.body);
  if (data.name !== undefined && !data.name) {
    return res.status(400).json({ error: 'Name cannot be empty.' });
  }
  const cols = Object.keys(data);
  if (cols.length === 0) return res.json(existing);

  const assignments = cols.map((c) => `${c} = ?`).join(', ');
  db.prepare(
    `UPDATE patients SET ${assignments}, updated_at = datetime('now') WHERE id = ?`
  ).run(...cols.map((c) => data[c]), req.params.id);

  const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  res.json(row);
});

// DELETE /api/patients/:id
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM patients WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Patient not found.' });
  res.status(204).end();
});

// POST /api/patients/:id/geocode — geocode this patient's address and store lat/lng
router.post('/:id/geocode', async (req, res) => {
  const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Patient not found.' });
  if (!row.address) return res.status(400).json({ error: 'Patient has no address to geocode.' });

  try {
    const { lat, lng, formatted } = await geocode(row.address);
    db.prepare(
      "UPDATE patients SET lat = ?, lng = ?, address = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(lat, lng, formatted, req.params.id);
    const updated = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    const status = err.code === 'NO_API_KEY' ? 503 : 422;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

// POST /api/patients/:id/log-visit — record a completed visit and roll the
// deadline forward by the patient's cadence. body: { date?: 'YYYY-MM-DD' }
router.post('/:id/log-visit', (req, res) => {
  const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Patient not found.' });

  const visitDate = isDateStr(req.body?.date) ? req.body.date : todayStr();
  const cadence = row.cadence_days || 30;
  const nextDue = addDaysStr(visitDate, cadence);

  db.prepare(
    "UPDATE patients SET last_visited = ?, due_by = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(visitDate, nextDue, req.params.id);

  res.json(db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id));
});

// POST /api/patients/import — bulk-create patients from CSV text, geocoding
// addresses as they're imported. body: { csv: string, geocode?: boolean }
router.post('/import', async (req, res) => {
  const csv = req.body?.csv;
  if (typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'No CSV content provided.' });
  }

  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return res.status(400).json({ error: 'CSV has a header but no data rows.' });
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const nameIdx = col('name');
  if (nameIdx < 0) {
    return res.status(400).json({ error: 'CSV must have a "name" column.' });
  }
  const idx = {
    name: nameIdx,
    address: col('address'),
    phone: col('phone'),
    phone2: col('phone2'),
    email: col('email'),
    visit_minutes: col('visit_minutes'),
    cadence_days: col('cadence_days'),
    due_by: col('due_by'),
    notes: col('notes'),
  };

  const insert = db.prepare(
    `INSERT INTO patients (name, address, phone, phone2, email, visit_minutes, cadence_days, due_by, notes)
     VALUES (@name, @address, @phone, @phone2, @email, @visit_minutes, @cadence_days, @due_by, @notes)`
  );
  const canGeocode = req.body.geocode !== false && hasGeocoding();

  let imported = 0;
  let located = 0;
  let failed = 0;
  let skipped = 0;

  // Pass 1: parse rows into records (note which need an auto deadline).
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0].trim() === '') continue; // blank line
    const get = (c) => (c >= 0 && c < row.length ? String(row[c]).trim() : '');

    const name = get(idx.name);
    if (!name) { skipped++; continue; }

    const cadenceRaw = parseInt(get(idx.cadence_days), 10);
    const cadence_days = Number.isFinite(cadenceRaw) && cadenceRaw > 0 ? cadenceRaw : defaultCadence();
    const explicitDue = isDateStr(get(idx.due_by)) ? get(idx.due_by) : null;
    const vm = parseInt(get(idx.visit_minutes), 10);

    records.push({
      name,
      address: get(idx.address) || null,
      phone: get(idx.phone) || null,
      phone2: get(idx.phone2) || null,
      email: get(idx.email) || null,
      visit_minutes: Number.isFinite(vm) && vm > 0 ? vm : 45,
      cadence_days,
      notes: get(idx.notes) || null,
      explicitDue,
    });
  }

  // Stagger the auto-assigned deadlines EVENLY across one 60-day cycle so a bulk
  // import doesn't dump everyone onto the same date (which would crowd one week).
  const today = todayStr();
  const SPREAD = 60;
  const autos = records.filter((rec) => !rec.explicitDue);
  autos.forEach((rec, k) => {
    const offset = autos.length <= 1 ? SPREAD : 1 + Math.round((k * (SPREAD - 1)) / (autos.length - 1));
    rec.due_by = addDaysStr(today, offset);
  });
  records.forEach((rec) => { if (rec.explicitDue) rec.due_by = rec.explicitDue; });

  // Pass 2: insert + geocode.
  for (const rec of records) {
    const info = insert.run({
      name: rec.name,
      address: rec.address,
      phone: rec.phone,
      phone2: rec.phone2,
      email: rec.email,
      visit_minutes: rec.visit_minutes,
      cadence_days: rec.cadence_days,
      due_by: rec.due_by,
      notes: rec.notes,
    });
    imported++;

    if (canGeocode && rec.address) {
      try {
        const g = await geocode(rec.address);
        db.prepare('UPDATE patients SET lat = ?, lng = ?, address = ? WHERE id = ?')
          .run(g.lat, g.lng, g.formatted, info.lastInsertRowid);
        located++;
      } catch {
        failed++;
      }
    }
  }

  res.json({ imported, located, failed, skipped, geocoded: canGeocode });
});

// GET /api/geocoding-status — does the server have a key configured?
router.get('/meta/geocoding-status', (req, res) => {
  res.json({ enabled: hasGeocoding() });
});

export default router;
