import { Router } from 'express';
import db from '../db.js';

const router = Router();

// Keys the client is allowed to write, with light validation/normalization.
const WRITABLE = {
  work_days: (v) => JSON.stringify(Array.isArray(v) ? v.map(Number).filter((n) => n >= 0 && n <= 6) : []),
  home_base: (v) => String(v ?? ''),
  max_per_day: (v) => String(Math.max(1, parseInt(v, 10) || 8)),
  day_start: (v) => String(v ?? '08:00'),
  day_end: (v) => String(v ?? '17:00'),
  google_api_key: (v) => String(v ?? '').trim(),
  email: (v) => String(v ?? '').trim(),
};

function readAll() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const { key, value } of rows) out[key] = value;
  // Parse the JSON-encoded work_days for convenience.
  try {
    out.work_days = JSON.parse(out.work_days ?? '[]');
  } catch {
    out.work_days = [];
  }
  out.max_per_day = parseInt(out.max_per_day, 10) || 8;
  out.default_cadence_days = parseInt(out.default_cadence_days, 10) || 60;
  return out;
}

// GET /api/settings
router.get('/', (req, res) => {
  res.json(readAll());
});

// PUT /api/settings — upsert any subset of writable keys
router.put('/', (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const tx = db.transaction(() => {
    for (const [key, normalize] of Object.entries(WRITABLE)) {
      if (body[key] !== undefined) upsert.run(key, normalize(body[key]));
    }
  });
  tx();
  res.json(readAll());
});

export default router;
