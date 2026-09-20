import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { storageStatus, formatBytes, canChooseLocation } from '../lib/storage.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The Settings page: work days, home base, daily cap, key/email, and data &
// security (backup / passcode / erase). Patient import lives next to "Add
// patient" instead — importing a caseload is a task, not a configuration step.
export default function SettingsPanel({
  settings,
  onSaved,
  onExport,
  onImportBackup,
  onClearAll,
  hasPasscode,
  onPasscodeChanged,
}) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  // passcode sub-form
  const [pcOpen, setPcOpen] = useState(false);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [pcBusy, setPcBusy] = useState(false);
  const [pcMsg, setPcMsg] = useState('');
  const [storage, setStorage] = useState(null);

  useEffect(() => {
    storageStatus().then(setStorage);
  }, []);

  useEffect(() => {
    if (settings) {
      setForm({
        work_days: settings.work_days ?? [1, 2, 3, 4, 5],
        home_base: settings.home_base ?? '',
        max_per_day: settings.max_per_day ?? 8,
        day_start: settings.day_start ?? '08:00',
        day_end: settings.day_end ?? '17:00',
        google_api_key: settings.google_api_key ?? '',
        email: settings.email ?? '',
      });
    }
  }, [settings]);

  if (!form) return null;

  async function savePasscode() {
    setPcMsg('');
    if (p1.length < 4) return setPcMsg('Use at least 4 characters.');
    if (p1 !== p2) return setPcMsg('Passcodes do not match.');
    setPcBusy(true);
    try {
      await api.setPasscode(p1);
      setPcOpen(false);
      setP1('');
      setP2('');
      setPcMsg('Passcode protection is on. Your data is now encrypted on this computer.');
      onPasscodeChanged?.();
    } catch (err) {
      setPcMsg(err.message);
    } finally {
      setPcBusy(false);
    }
  }

  async function removePasscode() {
    setPcBusy(true);
    setPcMsg('');
    try {
      await api.removePasscode();
      setPcMsg('Passcode removed. Your data stays on this computer but is no longer encrypted.');
      onPasscodeChanged?.();
    } catch (err) {
      setPcMsg(err.message);
    } finally {
      setPcBusy(false);
    }
  }

  const toggleDay = (d) =>
    setForm((f) => ({
      ...f,
      work_days: f.work_days.includes(d)
        ? f.work_days.filter((x) => x !== d)
        : [...f.work_days, d].sort((a, b) => a - b),
    }));

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      const saved = await api.updateSettings(form);
      onSaved(saved);
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2500);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="card settings">
        <div className="settings-body">
          <label className="field">
            <span className="field-label">Google Maps API key</span>
            <input
              type="text"
              value={form.google_api_key}
              onChange={(e) => setForm((f) => ({ ...f, google_api_key: e.target.value }))}
              placeholder="Paste your Google Maps key"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="field-hint">Required for the map, address lookup, and routing.</span>
          </label>

          <label className="field">
            <span className="field-label">Email for routes</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="you@example.com"
              autoComplete="off"
            />
            <span className="field-hint">Where a day's route can be sent so you can open it on your phone.</span>
          </label>

          <div className="field">
            <span className="field-label">Work days</span>
            <div className="day-toggles">
              {DAY_LABELS.map((label, d) => (
                <button
                  key={d}
                  type="button"
                  className={form.work_days.includes(d) ? 'day on' : 'day'}
                  onClick={() => toggleDay(d)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">Home base (start &amp; end of day)</span>
            <input
              value={form.home_base}
              onChange={(e) => setForm((f) => ({ ...f, home_base: e.target.value }))}
              placeholder="Your home or office address"
            />
          </label>

          <div className="row">
            <label className="field">
              <span className="field-label">Max visits / day</span>
              <input
                type="number"
                min="1"
                value={form.max_per_day}
                onChange={(e) => setForm((f) => ({ ...f, max_per_day: e.target.value }))}
              />
            </label>
            <label className="field">
              <span className="field-label">Day start</span>
              <input
                type="time"
                value={form.day_start}
                onChange={(e) => setForm((f) => ({ ...f, day_start: e.target.value }))}
              />
            </label>
            <label className="field">
              <span className="field-label">Day end</span>
              <input
                type="time"
                value={form.day_end}
                onChange={(e) => setForm((f) => ({ ...f, day_end: e.target.value }))}
              />
            </label>
          </div>

          <div className="actions">
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            {msg && <span className="save-msg">{msg}</span>}
          </div>

          <div className="import-section">
            <span className="field-label">Data &amp; security</span>
            <span className="field-hint">
              Everything is stored only on this computer, in this browser — never on a server. Back
              up regularly: clearing this browser's data would erase it.
            </span>

            {storage?.supported && (
              <span className="field-hint">
                {storage.persisted ? '🔒 Protected — ' : '⚠️ Not protected — '}
                {storage.persisted
                  ? 'this browser will not delete your data to free up space.'
                  : 'the browser may delete your data if this computer runs low on disk space. Keep a backup.'}
                {' '}Using {formatBytes(storage.usage)}.
              </span>
            )}

            <div className="import-controls">
              <button onClick={onExport}>
                {canChooseLocation() ? 'Save backup…' : 'Export backup'}
              </button>
              <label className="button-like">
                Import backup
                <input
                  type="file"
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={(e) => { if (e.target.files?.[0]) onImportBackup(e.target.files[0]); e.target.value = ''; }}
                />
              </label>
            </div>
            <span className="field-hint">
              {canChooseLocation()
                ? 'You choose where the file goes — a USB stick, Dropbox, or any folder.'
                : 'The file goes to your Downloads folder; move it somewhere safe.'}{' '}
              It contains your patient records <strong>and your Google Maps key</strong>, unencrypted
              — treat it like the records themselves.
            </span>
          </div>

          <div className="import-section">
            <span className="field-label">Passcode protection {hasPasscode ? '· ON' : '· OFF'}</span>
            <span className="field-hint">
              {hasPasscode
                ? 'Your data is encrypted on this computer. It cannot be opened without your passcode.'
                : 'Optional. Without a passcode your patient list stays on this computer but is not encrypted — anyone using this computer could open the app and read it. Adding one encrypts it.'}
            </span>

            {!pcOpen ? (
              <div className="import-controls">
                <button onClick={() => { setPcOpen(true); setPcMsg(''); setP1(''); setP2(''); }}>
                  {hasPasscode ? 'Change passcode' : 'Add a passcode'}
                </button>
                {hasPasscode && (
                  <button onClick={removePasscode} disabled={pcBusy}>
                    Remove passcode
                  </button>
                )}
                <button className="danger" onClick={onClearAll}>Erase all data</button>
              </div>
            ) : (
              <div className="passcode-form">
                <label className="field">
                  <span className="field-label">{hasPasscode ? 'New passcode' : 'Passcode'}</span>
                  <input
                    type="password"
                    value={p1}
                    onChange={(e) => setP1(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Confirm passcode</span>
                  <input
                    type="password"
                    value={p2}
                    onChange={(e) => setP2(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <span className="field-hint">
                  ⚠️ There is no password reset. If you forget it, the data on this computer cannot
                  be recovered — keep it somewhere safe and export a backup first.
                </span>
                <div className="import-controls">
                  <button className="primary" onClick={savePasscode} disabled={pcBusy}>
                    {pcBusy ? 'Please wait…' : hasPasscode ? 'Change passcode' : 'Turn on protection'}
                  </button>
                  <button onClick={() => { setPcOpen(false); setPcMsg(''); }} disabled={pcBusy}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {pcMsg && <span className="field-hint">{pcMsg}</span>}
          </div>
        </div>
    </div>
  );
}
