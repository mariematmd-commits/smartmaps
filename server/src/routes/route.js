import { Router } from 'express';
import db from '../db.js';
import { optimizeRoute } from '../optimizeRoute.js';

const router = Router();

// POST /api/route/optimize
// body: { startAddress: string, patientIds?: number[], returnHome?: boolean }
// If patientIds is omitted/empty, uses every mapped patient.
router.post('/optimize', async (req, res) => {
  const { startAddress, patientIds, returnHome = true } = req.body || {};

  let rows;
  if (Array.isArray(patientIds) && patientIds.length) {
    const placeholders = patientIds.map(() => '?').join(',');
    rows = db
      .prepare(`SELECT id, name, lat, lng FROM patients WHERE id IN (${placeholders})`)
      .all(...patientIds);
  } else {
    rows = db.prepare('SELECT id, name, lat, lng FROM patients').all();
  }

  const stops = rows.filter((r) => r.lat != null && r.lng != null);
  if (stops.length === 0) {
    return res
      .status(400)
      .json({ error: 'None of the selected patients have a mapped location yet. Add addresses and locate them first.' });
  }

  try {
    const result = await optimizeRoute({ startAddress, stops, returnHome });
    res.json(result);
  } catch (err) {
    const status =
      err.code === 'NO_API_KEY' ? 503
      : err.code === 'NO_START' || err.code === 'NO_STOPS' ? 400
      : 422;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

export default router;
