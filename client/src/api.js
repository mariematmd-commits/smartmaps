// Browser-only data layer. All patient data lives in this browser, encrypted at
// rest (see lib/vault.js). The method names match what the UI already calls, so
// the screens didn't change — only the plumbing underneath.

import * as vault from './lib/vault.js';
import { geocodeAddress, hasKey } from './lib/gmaps.js';
import { planWeek } from './lib/planWeek.js';
import { buildDayState } from './lib/dayPlan.js';
import { computeWorkload, levelLoad } from './lib/workload.js';
import { parseCsv } from './lib/csv.js';
import { requestPersistence } from './lib/storage.js';
import { todayStr, addDaysStr, isDateStr } from './lib/dates.js';

const DEFAULT_SETTINGS = {
  work_days: [1, 2, 3, 4, 5],
  home_base: '',
  max_per_day: 4,
  day_start: '08:00',
  day_end: '17:00',
  google_api_key: '',
  email: '',
  default_cadence_days: 60,
};

function freshData() {
  return { patients: [], visits: [], settings: { ...DEFAULT_SETTINGS }, patientSeq: 1, visitSeq: 1 };
}

// --- in-memory session state (only present while open) ---
// KEY is null in 'open' (no-passcode) mode — persistVault then writes plaintext.
let DATA = null;
let KEY = null;
let MODE = null;

const ensure = () => {
  if (!DATA) throw new Error('App is locked.');
};
const save = () => vault.persistVault(KEY, DATA);
const apiKey = () => DATA.settings.google_api_key || '';

// --- duplicate matching for imports -------------------------------------
// Caseloads arrive in pieces: one file per agency, a corrected list a week
// later. Importing the second file should top up the first, not produce two
// of everyone.
const normName = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9 ]/g, ' ')     // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim();
const normPhone = (s) => String(s || '').replace(/\D/g, '');

const normText = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const sameText = (a, b) => normText(a) === normText(b);
const samePhone = (a, b) => normPhone(a) === normPhone(b);

// Addresses need a little latitude in one direction only: geocoding rewrites
// "255 N Washington St, Rockville, MD" into "…, MD 20850, USA", so a re-import
// of the very same file would otherwise look different. One being the start of
// the other counts as the same address; anything else does not.
function sameAddress(a, b) {
  const na = normText(a).replace(/[.,]/g, '');
  const nb = normText(b).replace(/[.,]/g, '');
  if (na === nb) return true;
  if (!na || !nb) return false;
  return na.startsWith(nb) || nb.startsWith(na);
}

// Two records are the same patient only when every piece of information
// matches. Anything different — a second address, another phone number — and
// they stay two separate patients.
function isSamePatient(a, b, { compareDue = true } = {}) {
  if (!sameText(a.name, b.name)) return false;
  if (!samePhone(a.phone, b.phone)) return false;
  if (!samePhone(a.phone2, b.phone2)) return false;
  if (!sameText(a.email, b.email)) return false;
  if (!sameAddress(a.address, b.address)) return false;
  if (!sameText(a.notes, b.notes)) return false;
  if (Number(a.visit_minutes) !== Number(b.visit_minutes)) return false;
  if (Number(a.cadence_days) !== Number(b.cadence_days)) return false;
  if (compareDue && (a.due_by || '') !== (b.due_by || '')) return false;
  return true;
}

// An imported row is a duplicate only if an identical patient already exists.
// Due dates are compared only when the file actually stated one — a blank
// column gets an auto-assigned date that would differ between imports.
function findDuplicate(rec) {
  if (!normText(rec.name)) return null;
  const compareDue = Boolean(rec.explicitDue);
  return DATA.patients.find((p) => isSamePatient(p, rec, { compareDue })) || null;
}

// Group the list into sets of records that are identical in every field.
// Returns only groups with more than one member, each ordered oldest first.
function duplicateGroups() {
  const byName = new Map(); // cheap pre-filter before the full comparison
  for (const p of DATA.patients) {
    const n = normText(p.name);
    if (!n) continue;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(p);
  }
  const groups = [];
  for (const sameName of byName.values()) {
    if (sameName.length < 2) continue;
    const buckets = [];
    for (const p of sameName) {
      const bucket = buckets.find((b) => isSamePatient(b[0], p));
      if (bucket) bucket.push(p);
      else buckets.push([p]);
    }
    for (const b of buckets) {
      if (b.length > 1) groups.push(b.sort((a, z) => a.id - z.id));
    }
  }
  return groups;
}

function defaultCadence() {
  const n = parseInt(DATA.settings.default_cadence_days, 10);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

// Whitelist + coerce a patient body.
function sanitizePatient(body = {}) {
  const cols = ['name', 'address', 'lat', 'lng', 'phone', 'phone2', 'email', 'notes', 'visit_minutes', 'due_by', 'cadence_days'];
  const out = {};
  for (const c of cols) if (body[c] !== undefined) out[c] = body[c];
  if (out.name !== undefined) out.name = String(out.name).trim();
  if (out.visit_minutes !== undefined) {
    const n = parseInt(out.visit_minutes, 10);
    out.visit_minutes = Number.isFinite(n) && n > 0 ? n : 45;
  }
  if (out.cadence_days !== undefined) {
    const n = parseInt(out.cadence_days, 10);
    out.cadence_days = Number.isFinite(n) && n > 0 ? n : 60;
  }
  for (const c of ['lat', 'lng']) {
    if (out[c] === '' || out[c] == null) out[c] = null;
    else out[c] = Number(out[c]);
  }
  for (const c of ['due_by', 'last_visited']) {
    if (out[c] !== undefined) out[c] = isDateStr(out[c]) ? out[c] : null;
  }
  return out;
}

// Visit joined with the patient fields the UI needs.
function joinVisit(v) {
  const p = DATA.patients.find((x) => x.id === v.patient_id) || {};
  return {
    id: v.id, patient_id: v.patient_id, date: v.date, status: v.status,
    win_start: v.win_start ?? null, win_end: v.win_end ?? null, slot_time: v.slot_time ?? null,
    is_emergency: v.is_emergency ? 1 : 0, notes: v.notes ?? null,
    name: p.name, phone: p.phone, phone2: p.phone2, address: p.address,
    lat: p.lat, lng: p.lng, due_by: p.due_by, visit_minutes: p.visit_minutes,
  };
}

export const api = {
  // ---- passcode / vault ----
  vaultExists: () => vault.vaultExists(),
  isUnlocked: () => DATA != null,
  // 'open' = no passcode on this device, 'passcode' = encrypted.
  hasPasscode: () => MODE === vault.MODE_PASSCODE,

  // Called once on load. Opens the app without prompting unless this device is
  // passcode-protected; returns whether the UI still needs to ask for one.
  async init() {
    // Ask the browser not to evict this data. Never blocks startup.
    requestPersistence().catch(() => {});
    MODE = await vault.getMode();
    if (MODE === vault.MODE_PASSCODE) return { needsPasscode: true };
    if (MODE === vault.MODE_OPEN) {
      DATA = await vault.loadOpenVault();
      DATA.settings = { ...DEFAULT_SETTINGS, ...DATA.settings };
    } else {
      // First ever visit: start an unprotected vault so she can just use it.
      DATA = freshData();
      await vault.createOpenVault(DATA);
      MODE = vault.MODE_OPEN;
    }
    KEY = null;
    return { needsPasscode: false };
  },

  async unlock(passphrase) {
    const { key, data } = await vault.unlockVault(passphrase);
    KEY = key;
    DATA = data;
    MODE = vault.MODE_PASSCODE;
    // forward-compat: fill any missing settings defaults
    DATA.settings = { ...DEFAULT_SETTINGS, ...DATA.settings };
  },
  lock() {
    DATA = null;
    KEY = null;
  },

  // Turn protection on, or change an existing passcode. Data is preserved.
  async setPasscode(newPassphrase) {
    ensure();
    KEY = await vault.setPasscode(newPassphrase, DATA);
    MODE = vault.MODE_PASSCODE;
  },
  // Turn protection off — data stays on this device, no longer encrypted.
  async removePasscode() {
    ensure();
    await vault.removePasscode(DATA);
    KEY = null;
    MODE = vault.MODE_OPEN;
  },

  async clearAll() {
    await vault.clearVault();
    DATA = null;
    KEY = null;
    MODE = null;
  },
  exportData() {
    ensure();
    return DATA;
  },
  async importData(obj) {
    ensure();
    if (!obj || !Array.isArray(obj.patients)) throw new Error('That file is not a SmartMaps backup.');
    DATA = {
      patients: obj.patients || [],
      visits: obj.visits || [],
      settings: { ...DEFAULT_SETTINGS, ...(obj.settings || {}) },
      patientSeq: obj.patientSeq || (Math.max(0, ...(obj.patients || []).map((p) => p.id || 0)) + 1),
      visitSeq: obj.visitSeq || (Math.max(0, ...(obj.visits || []).map((v) => v.id || 0)) + 1),
    };
    await save();
  },

  // ---- patients ----
  async listPatients() {
    ensure();
    return [...DATA.patients].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },
  async createPatient(body) {
    ensure();
    const data = sanitizePatient(body);
    if (!data.name) throw new Error('Name is required.');
    if (data.cadence_days === undefined) data.cadence_days = defaultCadence();
    if (!data.due_by) data.due_by = addDaysStr(todayStr(), data.cadence_days ?? defaultCadence());
    const patient = {
      id: DATA.patientSeq++,
      name: data.name, address: data.address ?? null, lat: data.lat ?? null, lng: data.lng ?? null,
      phone: data.phone ?? null, phone2: data.phone2 ?? null, email: data.email ?? null,
      notes: data.notes ?? null, visit_minutes: data.visit_minutes ?? 45,
      due_by: data.due_by, cadence_days: data.cadence_days, last_visited: null,
    };
    DATA.patients.push(patient);
    await save();
    return patient;
  },
  async updatePatient(id, body) {
    ensure();
    const p = DATA.patients.find((x) => x.id === Number(id));
    if (!p) throw new Error('Patient not found.');
    const data = sanitizePatient(body);
    if (data.name !== undefined && !data.name) throw new Error('Name cannot be empty.');
    Object.assign(p, data);
    await save();
    return p;
  },
  async deletePatient(id) {
    ensure();
    DATA.patients = DATA.patients.filter((x) => x.id !== Number(id));
    DATA.visits = DATA.visits.filter((v) => v.patient_id !== Number(id)); // cascade
    await save();
  },
  async geocodePatient(id) {
    ensure();
    const p = DATA.patients.find((x) => x.id === Number(id));
    if (!p) throw new Error('Patient not found.');
    if (!p.address) throw new Error('Patient has no address to geocode.');
    const g = await geocodeAddress(apiKey(), p.address);
    p.lat = g.lat;
    p.lng = g.lng;
    p.address = g.formatted;
    await save();
    return p;
  },
  async logVisit(id, date) {
    ensure();
    const p = DATA.patients.find((x) => x.id === Number(id));
    if (!p) throw new Error('Patient not found.');
    const visitDate = isDateStr(date) ? date : todayStr();
    p.last_visited = visitDate;
    p.due_by = addDaysStr(visitDate, p.cadence_days || 60);
    await save();
    return p;
  },
  geocodingStatus() {
    return Promise.resolve({ enabled: DATA ? hasKey(apiKey()) : false });
  },

  // ---- settings ----
  async getSettings() {
    ensure();
    return { ...DATA.settings };
  },
  async updateSettings(patch) {
    ensure();
    const allowed = ['work_days', 'home_base', 'max_per_day', 'day_start', 'day_end', 'google_api_key', 'email'];
    for (const k of allowed) {
      if (patch[k] === undefined) continue;
      if (k === 'work_days') DATA.settings.work_days = Array.isArray(patch[k]) ? patch[k].map(Number) : [];
      else if (k === 'max_per_day') DATA.settings.max_per_day = Math.max(1, parseInt(patch[k], 10) || 4);
      else DATA.settings[k] = String(patch[k] ?? '');
    }
    await save();
    return { ...DATA.settings };
  },

  // ---- planning ----
  async planWeek(weekStart) {
    ensure();
    return planWeek({
      weekStart,
      maxPerDay: DATA.settings.max_per_day,
      workDays: DATA.settings.work_days,
      patients: DATA.patients,
    });
  },
  async commitPlan(weekStart) {
    ensure();
    const plan = planWeek({
      weekStart,
      maxPerDay: DATA.settings.max_per_day,
      workDays: DATA.settings.work_days,
      patients: DATA.patients,
    });
    if (plan.error) throw new Error(plan.error);
    const already = new Set(
      DATA.visits.filter((v) => v.date >= plan.weekStart && v.date <= plan.weekEnd).map((v) => v.patient_id)
    );
    let created = 0;
    for (const day of plan.days) {
      for (const p of day.patients) {
        if (already.has(p.id)) continue;
        DATA.visits.push({
          id: DATA.visitSeq++, patient_id: p.id, date: day.date, status: 'proposed',
          win_start: null, win_end: null, slot_time: null, is_emergency: 0, notes: null,
        });
        already.add(p.id);
        created++;
      }
    }
    await save();
    return { created, weekStart: plan.weekStart, weekEnd: plan.weekEnd };
  },
  async dayPlan(date) {
    ensure();
    return buildDayState({
      date,
      patients: DATA.patients,
      visits: DATA.visits,
      settings: DATA.settings,
      apiKey: apiKey(),
    });
  },
  async getWorkload(weeks = 10, projected = false) {
    ensure();
    return computeWorkload(DATA.patients, DATA.settings, weeks, projected);
  },
  async levelLoad() {
    ensure();
    const r = levelLoad(DATA.patients, DATA.settings, 12);
    await save();
    return r;
  },

  // ---- visits ----
  async listVisits(from, to) {
    ensure();
    return DATA.visits
      .filter((v) => (!from || v.date >= from) && (!to || v.date <= to))
      .map(joinVisit);
  },
  async addVisit(v) {
    ensure();
    if (!DATA.patients.find((p) => p.id === Number(v.patient_id))) throw new Error('Unknown patient.');
    if (!isDateStr(v.date)) throw new Error('A valid date is required.');
    const visit = {
      id: DATA.visitSeq++, patient_id: Number(v.patient_id), date: v.date,
      status: v.status || 'proposed', win_start: v.win_start || null, win_end: v.win_end || null,
      slot_time: v.slot_time || null, is_emergency: v.is_emergency ? 1 : 0, notes: v.notes || null,
    };
    DATA.visits.push(visit);
    await save();
    return joinVisit(visit);
  },
  async updateVisit(id, patch) {
    ensure();
    const v = DATA.visits.find((x) => x.id === Number(id));
    if (!v) throw new Error('Visit not found.');
    if (patch.status !== undefined) {
      if (!['proposed', 'confirmed', 'declined', 'callback'].includes(patch.status)) throw new Error('Invalid status.');
      v.status = patch.status;
    }
    for (const k of ['win_start', 'win_end', 'slot_time', 'notes']) {
      if (patch[k] !== undefined) v[k] = patch[k] || null;
    }
    if (patch.is_emergency !== undefined) v.is_emergency = patch.is_emergency ? 1 : 0;
    if (patch.date !== undefined && isDateStr(patch.date)) v.date = patch.date;
    await save();
    return joinVisit(v);
  },
  async deleteVisit(id) {
    ensure();
    DATA.visits = DATA.visits.filter((x) => x.id !== Number(id));
    await save();
  },

  // ---- CSV import (with staggered deadlines) ----
  // How many extra copies are sitting in the list right now.
  countDuplicates() {
    ensure();
    return duplicateGroups().reduce((n, g) => n + g.length - 1, 0);
  },

  // Collapse each set of duplicates into the earliest record: fill its blanks
  // from the copies, move any visits across, then delete the copies.
  async mergeDuplicates() {
    ensure();
    const groups = duplicateGroups();
    let removed = 0;
    const doomed = new Set();

    for (const group of groups) {
      const [keep, ...copies] = group;
      for (const dup of copies) {
        // The records are identical, so there is nothing to copy over except a
        // location one of them happens to have already looked up.
        if (keep.lat == null && dup.lat != null) {
          keep.lat = dup.lat;
          keep.lng = dup.lng;
          if (dup.address) keep.address = dup.address;
        }
        if (!keep.last_visited && dup.last_visited) keep.last_visited = dup.last_visited;

        // Re-point this copy's visits at the record we're keeping, dropping any
        // that would collide with one the keeper already has that day.
        for (const v of DATA.visits) {
          if (v.patient_id !== dup.id) continue;
          const clash = DATA.visits.some(
            (o) => o.patient_id === keep.id && o.date === v.date && o.id !== v.id
          );
          if (clash) doomed.add(v.id);
          else v.patient_id = keep.id;
        }
        doomed.add(`p${dup.id}`);
        removed++;
      }
    }

    if (removed) {
      DATA.patients = DATA.patients.filter((p) => !doomed.has(`p${p.id}`));
      DATA.visits = DATA.visits.filter((v) => !doomed.has(v.id));
      await save();
    }
    return { removed, groups: groups.length };
  },

  async importCsv(csv) {
    ensure();
    if (typeof csv !== 'string' || !csv.trim()) throw new Error('No CSV content provided.');
    const rows = parseCsv(csv);
    if (rows.length < 2) throw new Error('CSV has a header but no data rows.');
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (n) => header.indexOf(n);
    if (col('name') < 0) throw new Error('CSV must have a "name" column.');
    const idx = {
      name: col('name'), address: col('address'), phone: col('phone'), phone2: col('phone2'),
      email: col('email'), visit_minutes: col('visit_minutes'), cadence_days: col('cadence_days'),
      due_by: col('due_by'), notes: col('notes'),
    };

    let skipped = 0;
    const records = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length === 1 && row[0].trim() === '') continue;
      const get = (c) => (c >= 0 && c < row.length ? String(row[c]).trim() : '');
      const name = get(idx.name);
      if (!name) { skipped++; continue; }
      const cadRaw = parseInt(get(idx.cadence_days), 10);
      const cadence_days = Number.isFinite(cadRaw) && cadRaw > 0 ? cadRaw : defaultCadence();
      const explicitDue = isDateStr(get(idx.due_by)) ? get(idx.due_by) : null;
      const vm = parseInt(get(idx.visit_minutes), 10);
      records.push({
        name, address: get(idx.address) || null, phone: get(idx.phone) || null,
        phone2: get(idx.phone2) || null, email: get(idx.email) || null,
        visit_minutes: Number.isFinite(vm) && vm > 0 ? vm : 45,
        cadence_days, notes: get(idx.notes) || null, explicitDue,
      });
    }

    // stagger auto deadlines across a 60-day window
    const today = todayStr();
    const SPREAD = 60;
    const autos = records.filter((rec) => !rec.explicitDue);
    autos.forEach((rec, k) => {
      const offset = autos.length <= 1 ? SPREAD : 1 + Math.round((k * (SPREAD - 1)) / (autos.length - 1));
      rec.due_by = addDaysStr(today, offset);
    });
    records.forEach((rec) => { if (rec.explicitDue) rec.due_by = rec.explicitDue; });

    const canGeocode = hasKey(apiKey());
    let imported = 0;
    let merged = 0;
    let located = 0;
    let failed = 0;
    for (const rec of records) {
      // Matching runs against the live list, so duplicates are caught both
      // across files and within a single file.
      const existing = findDuplicate(rec);
      let target;
      let needsGeocode;

      if (existing) {
        // Identical to a patient already on the list: nothing to copy across,
        // just don't add a second copy.
        merged++;
        target = existing;
        needsGeocode = Boolean(existing.address) && existing.lat == null;
      } else {
        target = {
          id: DATA.patientSeq++, name: rec.name, address: rec.address, lat: null, lng: null,
          phone: rec.phone, phone2: rec.phone2, email: rec.email, notes: rec.notes,
          visit_minutes: rec.visit_minutes, cadence_days: rec.cadence_days, due_by: rec.due_by, last_visited: null,
        };
        DATA.patients.push(target);
        imported++;
        needsGeocode = Boolean(target.address);
      }

      if (canGeocode && needsGeocode && target.address) {
        try {
          const g = await geocodeAddress(apiKey(), target.address);
          target.lat = g.lat; target.lng = g.lng; target.address = g.formatted;
          located++;
        } catch {
          failed++;
        }
      }
    }
    await save();
    return { imported, merged, located, failed, skipped, geocoded: canGeocode };
  },
};
