import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import patientsRouter from './routes/patients.js';
import routeRouter from './routes/route.js';
import settingsRouter from './routes/settings.js';
import planRouter from './routes/plan.js';
import visitsRouter from './routes/visits.js';
import { getGoogleKey } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, geocoding: Boolean(getGoogleKey()) });
});

app.use('/api/patients', patientsRouter);
app.use('/api/route', routeRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/plan', planRouter);
app.use('/api/visits', visitsRouter);

// In production, serve the built client (client/dist) if it exists.
const clientDist = join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(join(clientDist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`SmartMaps server listening on http://localhost:${PORT}`);
  if (!getGoogleKey()) {
    console.log('  Note: no Google Maps key yet — add it in the app under Settings.');
  }
});
