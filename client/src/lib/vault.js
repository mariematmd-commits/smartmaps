// Local vault: patient data lives ONLY in this browser (IndexedDB on the
// nurse's own disk — never a server). Two modes:
//
//   'open'     — stored as plain JSON. No passcode, app opens straight up.
//                Convenient, but anyone using this computer can read it.
//   'passcode' — encrypted with AES-GCM under a key derived from her passcode
//                (PBKDF2, 150k iterations). Unreadable without it, no recovery.
//
// A nurse starts in 'open' mode and can switch to 'passcode' from Settings at
// any time; the existing data is re-written in the new mode either way.

const DB_NAME = 'smartmaps';
const STORE = 'vault';
const SALT_KEY = 'salt';
const BLOB_KEY = 'blob';
const MODE_KEY = 'mode';
const PLAIN_KEY = 'plain';

export const MODE_OPEN = 'open';
export const MODE_PASSCODE = 'passcode';

// --- base64 helpers ---
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// --- IndexedDB (tiny key/value wrapper) ---
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}
async function idbDel(...keys) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const k of keys) store.delete(k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- crypto ---
async function deriveKey(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(obj))
  );
  return { iv: b64(iv), ct: b64(ct) };
}
async function decryptJSON(key, blob) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) },
    key,
    fromB64(blob.ct)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

// --- public API ---

// What's on this device: 'open', 'passcode', or null if nothing yet.
export async function getMode() {
  const mode = await idbGet(MODE_KEY);
  if (mode === MODE_OPEN || mode === MODE_PASSCODE) return mode;
  // Vaults created before modes existed are always encrypted.
  if (await idbGet(BLOB_KEY)) return MODE_PASSCODE;
  if (await idbGet(PLAIN_KEY)) return MODE_OPEN;
  return null;
}

export async function vaultExists() {
  return (await getMode()) != null;
}

// Start a no-passcode vault (first run, and the default).
export async function createOpenVault(initialData) {
  await idbSet(PLAIN_KEY, initialData);
  await idbSet(MODE_KEY, MODE_OPEN);
}

// Read a no-passcode vault. Throws if this device is passcode-protected.
export async function loadOpenVault() {
  const data = await idbGet(PLAIN_KEY);
  if (!data) throw new Error('No data found on this device.');
  return data;
}

// Unlock a passcode-protected vault. Throws if the passcode is wrong.
export async function unlockVault(passphrase) {
  const saltB64 = await idbGet(SALT_KEY);
  const blob = await idbGet(BLOB_KEY);
  if (!saltB64 || !blob) throw new Error('No data found on this device.');
  const key = await deriveKey(passphrase, fromB64(saltB64));
  let data;
  try {
    data = await decryptJSON(key, blob);
  } catch {
    const e = new Error('Incorrect passcode.');
    e.code = 'BAD_PASSCODE';
    throw e;
  }
  return { key, data };
}

// Save the dataset in whichever mode this device is in. A null key means the
// vault is open (plain); otherwise re-encrypt under the session key.
export async function persistVault(key, data) {
  if (key) await idbSet(BLOB_KEY, await encryptJSON(key, data));
  else await idbSet(PLAIN_KEY, data);
}

// Turn ON passcode protection for an open vault (or change an existing
// passcode): derive a fresh key, encrypt, and drop the plaintext copy.
export async function setPasscode(passphrase, data) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  await idbSet(SALT_KEY, b64(salt));
  await idbSet(BLOB_KEY, await encryptJSON(key, data));
  await idbSet(MODE_KEY, MODE_PASSCODE);
  await idbDel(PLAIN_KEY);
  return key;
}

// Turn OFF passcode protection: write the data back as plaintext and remove
// the encrypted copy + salt.
export async function removePasscode(data) {
  await idbSet(PLAIN_KEY, data);
  await idbSet(MODE_KEY, MODE_OPEN);
  await idbDel(BLOB_KEY, SALT_KEY);
}

// Wipe everything from this device.
export async function clearVault() {
  await idbDel(SALT_KEY, BLOB_KEY, PLAIN_KEY, MODE_KEY);
}
