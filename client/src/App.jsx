import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import PatientForm from './components/PatientForm.jsx';
import PatientList from './components/PatientList.jsx';
import MapView from './components/MapView.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import WeekPlanner, { activeDays } from './components/WeekPlanner.jsx';
import WorkloadView from './components/WorkloadView.jsx';
import LockScreen from './components/LockScreen.jsx';
import { dayColor } from './dayColors.js';

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [hasPasscode, setHasPasscode] = useState(false);
  const [patients, setPatients] = useState([]);
  const [editing, setEditing] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [geocodingEnabled, setGeocodingEnabled] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('patients');
  const [plan, setPlan] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setPatients(await api.listPatients());
      setLoadError('');
    } catch (err) {
      setLoadError(`Could not load your data: ${err.message}`);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await refresh();
    api.getSettings().then(setSettings).catch(() => {});
    api.geocodingStatus().then((s) => setGeocodingEnabled(s.enabled)).catch(() => {});
  }, [refresh]);

  // First load: open straight into the app unless this computer is passcode-protected.
  useEffect(() => {
    api
      .init()
      .then(({ needsPasscode }) => {
        setHasPasscode(needsPasscode);
        setUnlocked(!needsPasscode);
      })
      .catch((err) => setLoadError(`Could not open your data: ${err.message}`))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (unlocked) loadAll();
  }, [unlocked, loadAll]);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  async function handleSave(form) {
    if (editing) {
      await api.updatePatient(editing.id, form);
      setEditing(null);
      flash('Patient updated.');
    } else {
      const created = await api.createPatient(form);
      if (created.address && geocodingEnabled) {
        try {
          await api.geocodePatient(created.id);
        } catch {
          flash('Patient added, but the address could not be located.');
        }
      }
      flash('Patient added.');
    }
    await refresh();
  }

  async function handleDelete(p) {
    if (!window.confirm(`Delete ${p.name}? This cannot be undone.`)) return;
    await api.deletePatient(p.id);
    if (editing?.id === p.id) setEditing(null);
    if (selectedId === p.id) setSelectedId(null);
    await refresh();
    flash('Patient deleted.');
  }

  async function handleGeocode(p) {
    try {
      await api.geocodePatient(p.id);
      await refresh();
      flash(`Located ${p.name} on the map.`);
    } catch (err) {
      flash(err.message);
    }
  }

  async function handleLogVisit(p) {
    if (!window.confirm(`Log a visit for ${p.name} today? Their next due date will roll forward.`)) return;
    try {
      const updated = await api.logVisit(p.id);
      await refresh();
      flash(`Visit logged. ${p.name} is next due ${updated.due_by}.`);
    } catch (err) {
      flash(err.message);
    }
  }

  const mapsKey = settings?.google_api_key || '';

  function handleSettingsSaved(saved) {
    setSettings(saved);
    api.geocodingStatus().then((s) => setGeocodingEnabled(s.enabled)).catch(() => {});
  }

  function lock() {
    api.lock();
    setUnlocked(false);
    setPatients([]);
    setSettings(null);
    setPlan(null);
  }

  function handleExport() {
    try {
      const data = api.exportData();
      download(`smartmaps-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
      flash('Backup downloaded.');
    } catch (err) {
      flash(err.message);
    }
  }

  async function handleImport(file) {
    if (!window.confirm('Importing a backup replaces all data currently in this browser. Continue?')) return;
    try {
      const obj = JSON.parse(await file.text());
      await api.importData(obj);
      await loadAll();
      flash('Backup imported.');
    } catch (err) {
      flash(`Import failed: ${err.message}`);
    }
  }

  async function handleClearAll() {
    if (!window.confirm('Permanently erase ALL patients, plans, and settings from this browser? This cannot be undone.')) return;
    await api.clearAll();
    // Start over with a fresh unprotected vault rather than stranding her on a lock screen.
    const { needsPasscode } = await api.init();
    setHasPasscode(needsPasscode);
    setPatients([]);
    setPlan(null);
    await loadAll();
    flash('All data erased.');
  }

  const planGroups = activeDays(plan).map((d, i) => ({
    color: dayColor(i),
    label: `${d.label} ${d.date.slice(5)}`,
    patients: d.patients,
  }));

  if (booting) return null;
  if (!unlocked) return <LockScreen onUnlocked={() => setUnlocked(true)} />;

  return (
    <div className="app">
      <header className="topbar">
        <h1>SmartMaps</h1>
        <span className="tagline">Visit planner</span>
        <nav className="tabs">
          <button className={tab === 'patients' ? 'tab active' : 'tab'} onClick={() => setTab('patients')}>
            Patients
          </button>
          <button className={tab === 'plan' ? 'tab active' : 'tab'} onClick={() => setTab('plan')}>
            Plan Week
          </button>
          {hasPasscode && (
            <button className="tab" onClick={lock} title="Lock the app">🔒 Lock</button>
          )}
        </nav>
      </header>

      {loadError && <div className="banner error">{loadError}</div>}
      {notice && <div className="banner notice">{notice}</div>}
      {!geocodingEnabled && !loadError && (
        <div className="banner warn">
          Add your Google Maps key in <strong>Settings</strong> to place addresses on the map and plan routes.
        </div>
      )}

      {tab === 'patients' ? (
        <main className="layout">
          <section className="col col-form">
            <PatientForm
              patient={editing}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
              defaultCadence={settings?.default_cadence_days || 60}
            />
          </section>

          <section className="col col-list">
            <SettingsPanel
              settings={settings}
              onSaved={handleSettingsSaved}
              onImported={refresh}
              onExport={handleExport}
              onImportBackup={handleImport}
              onClearAll={handleClearAll}
              hasPasscode={hasPasscode}
              onPasscodeChanged={() => setHasPasscode(api.hasPasscode())}
            />
            <PatientList
              patients={patients}
              selectedId={selectedId}
              geocodingEnabled={geocodingEnabled}
              onEdit={(p) => setEditing(p)}
              onDelete={handleDelete}
              onGeocode={handleGeocode}
              onLogVisit={handleLogVisit}
              onSelect={(p) => setSelectedId(p.id)}
            />
          </section>

          <section className="col col-map">
            <MapView
              patients={patients}
              selectedId={selectedId}
              apiKey={mapsKey}
              onSelect={(p) => setSelectedId(p.id)}
            />
          </section>
        </main>
      ) : (
        <main className="layout layout-plan">
          <section className="col col-plan">
            <WorkloadView onChanged={refresh} />
            <WeekPlanner plan={plan} onPlan={setPlan} patients={patients} homeBase={settings?.home_base || ''} />
          </section>
          <section className="col col-map">
            <MapView patients={patients} groups={planGroups} apiKey={mapsKey} onSelect={() => {}} />
          </section>
        </main>
      )}
    </div>
  );
}
