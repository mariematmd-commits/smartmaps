import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'smartmaps.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Patients table. Includes scheduling columns (deadline/cadence) used by the
// weekly planner.
db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    address       TEXT,
    lat           REAL,
    lng           REAL,
    phone         TEXT,
    phone2        TEXT,
    email         TEXT,
    notes         TEXT,
    visit_minutes INTEGER NOT NULL DEFAULT 45,
    -- "visit by" deadline (YYYY-MM-DD) and how often the patient cycles.
    due_by        TEXT,
    cadence_days  INTEGER NOT NULL DEFAULT 60,
    last_visited  TEXT,
    -- Reserved for later phases (per-day availability is captured on calls).
    availability  TEXT,
    status        TEXT NOT NULL DEFAULT 'unscheduled',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- A scheduled visit on a specific date, with the nurse's call outcome.
  CREATE TABLE IF NOT EXISTS visits (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,                     -- YYYY-MM-DD
    status       TEXT NOT NULL DEFAULT 'proposed',  -- proposed|confirmed|declined|callback
    win_start    TEXT,                              -- HH:MM available-from (the patient's window)
    win_end      TEXT,                              -- HH:MM available-to
    slot_time    TEXT,                              -- HH:MM assigned appointment time
    is_emergency INTEGER NOT NULL DEFAULT 0,
    notes        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(date);
`);

// --- Lightweight migration for databases created before these columns existed.
function ensureColumn(table, name, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}
ensureColumn('patients', 'due_by', 'TEXT');
ensureColumn('patients', 'cadence_days', 'INTEGER NOT NULL DEFAULT 60');
ensureColumn('patients', 'last_visited', 'TEXT');
ensureColumn('visits', 'slot_time', 'TEXT'); // assigned appointment time (HH:MM)

// --- Seed default settings (only inserts missing keys, never overwrites).
const seedDefaults = {
  work_days: JSON.stringify([1, 2, 3, 4, 5]), // 0=Sun … 6=Sat -> Mon–Fri
  home_base: '',
  max_per_day: '4',
  day_start: '08:00',
  day_end: '17:00',
  google_api_key: '',
  email: '',
  default_cadence_days: '60', // the standard revisit cycle for all patients
};
const seedStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(seedDefaults)) seedStmt.run(k, v);

export default db;
