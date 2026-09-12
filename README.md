# SmartMaps

A route/visit planner for a single traveling home-health nurse. Enter your patients,
place them on a map, and (in later phases) let the app pick the best day for each visit,
optimize your driving route with live traffic, help you confirm by phone, and
auto-substitute a nearby patient when someone can't make their slot.

Responsive web app — works on a laptop at your desk and a phone on the road.

## Status

- **Phase 1 (done):** patient management — add / edit / delete patients, store address,
  phones, email, visit length, notes; geocode addresses and see everyone on a Google Map.
- Phase 2: patient availability + your work settings (work days/hours, home base).
- Phase 3: scheduling engine — cluster patients into days + optimize each day's route.
- Phase 4: confirmation tracker — call list, mark confirmed / declined.
- Phase 5: auto-substitution + re-route.

## Tech

- **client/** — React + Vite (Google Maps JavaScript API for the map)
- **server/** — Node.js + Express + SQLite (`better-sqlite3`); keeps the Google key private

## Setup

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Add your Google Maps key(s)

Create a Google Cloud project with billing enabled and an API key. Enable these APIs:
**Geocoding API** and **Maps JavaScript API** (Routes/Distance Matrix come in Phase 3).

```bash
# server key (server-side geocoding) — restrict by IP
cp server/.env.example server/.env      # then paste your key into GOOGLE_MAPS_API_KEY

# browser key (draws the map) — restrict by HTTP referrer
cp client/.env.example client/.env      # then paste your key into VITE_GOOGLE_MAPS_API_KEY
```

The app runs without a key — you just won't get the map or automatic address lookup until
you add one.

### 3. Run

```bash
npm run dev
```

- Client: http://localhost:5173
- Server API: http://localhost:3001

## Data & privacy

Patient records are health information (PHI). The database lives at `server/data/smartmaps.db`
and is **git-ignored**. If this is ever used with real patients, HIPAA rules apply — you'd need
a signed BAA with Google Cloud and additional safeguards (auth, encryption at rest, access logs).
