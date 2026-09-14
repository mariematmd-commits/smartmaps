// Storage durability + backups.
//
// Browsers hand out two grades of storage. The default is "best effort", which
// the browser is free to delete when disk space runs low — fine for a cache,
// wrong for the only copy of a nurse's patient list. Asking for "persistent"
// tells the browser this data is not disposable.

// Ask the browser to protect this app's data. Safe to call on every load.
export async function requestPersistence() {
  if (!navigator.storage?.persist) return { supported: false, persisted: false };
  try {
    if (await navigator.storage.persisted()) return { supported: true, persisted: true };
    return { supported: true, persisted: await navigator.storage.persist() };
  } catch {
    return { supported: true, persisted: false };
  }
}

export async function storageStatus() {
  if (!navigator.storage?.estimate) return { supported: false };
  try {
    const [persisted, est] = await Promise.all([
      navigator.storage.persisted?.() ?? false,
      navigator.storage.estimate(),
    ]);
    return { supported: true, persisted, usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return { supported: false };
  }
}

export function formatBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const backupName = () => `smartmaps-backup-${new Date().toISOString().slice(0, 10)}.json`;

// True when the browser can show a real "save as" dialog (Chrome/Edge desktop).
export const canChooseLocation = () => typeof window.showSaveFilePicker === 'function';

// Save a backup to a folder the nurse picks. Falls back to a normal download
// on browsers without the File System Access API (Firefox, Safari, most phones).
// Returns { method, name } or null if she cancelled.
export async function saveBackup(json) {
  if (canChooseLocation()) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: backupName(),
        types: [{ description: 'SmartMaps backup', accept: { 'application/json': ['.json'] } }],
      });
    } catch (err) {
      if (err?.name === 'AbortError') return null; // she closed the dialog
      throw err;
    }
    const w = await handle.createWritable();
    await w.write(json);
    await w.close();
    return { method: 'picked', name: handle.name };
  }

  const name = backupName();
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return { method: 'download', name };
}
