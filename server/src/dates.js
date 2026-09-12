// Date-only helpers (YYYY-MM-DD), using the server's local calendar day.

export function todayStr() {
  const d = new Date();
  return toStr(d);
}

export function toStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// Add (or subtract) whole days to a YYYY-MM-DD string, returning YYYY-MM-DD.
export function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toStr(dt);
}

// True if a string looks like YYYY-MM-DD.
export function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
