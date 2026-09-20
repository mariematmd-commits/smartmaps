import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import PatientForm from './components/PatientForm.jsx';
import PatientList from './components/PatientList.jsx';
import MapView from './components/MapView.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import WeekPlanner, { activeDays } from './components/WeekPlanner.jsx';
import WorkloadView from './components/WorkloadView.jsx';
import LockScreen from './components/LockScreen.jsx';
import HomeScreen from './components/HomeScreen.jsx';
import ImportPatients from './components/ImportPatients.jsx';
import { dayColor } from './dayColors.js';
import { saveBackup } from './lib/storage.js';

// One page at a time, so nothing is crowded on a phone.
const NAV = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'plan', label: 'Plan', icon: '🗓' },
  { id: 'add', label: 'Add', icon: '➕' },
  { id: 'patients', label: 'Patients', icon: '👥' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];
const PAGE_TITLES = {
  home: 'Visit planner',
  plan: 'Plan the week',
  add: 'Add a patient',
  patients: 'Your patients',
  settings: 'Settings',
};

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
  const [page, setPage] = useState('home');
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

  // Pages lay the shared map out differently, so nudge Google to re-measure.
  // MapView also watches its own box, this just makes the change prompt.
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    return () => clearTimeout(t);
  }, [page]);

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

  // Inline address entry from the patient list: save it, then locate it in one
  // step so she can work straight down a freshly imported list of names.
  async function handleSaveAddress(p, address) {
    await api.updatePatient(p.id, { address });
    if (geocodingEnabled) {
      try {
        await api.geocodePatient(p.id);
      } catch {
        await refresh();
        throw new Error(`Saved, but “${address}” could not be found on the map. Check the spelling.`);
      }
    }
    await refresh();
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

  async function handleExport() {
    try {
      const result = await saveBackup(JSON.stringify(api.exportData(), null, 2));
      if (!result) return; // cancelled the save dialog
      flash(
        result.method === 'picked'
          ? `Backup saved as ${result.name}.`
          : `Backup downloaded as ${result.name}.`
      );
    } catch (err) {
      flash(`Backup failed: ${err.message}`);
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

  const go = (p) => {
    setPage(p);
    window.scrollTo({ top: 0 });
  };
  // The map is only meaningful on pages that show locations.
  const mapPages = ['patients', 'add', 'plan'];
  const showMap = mapPages.includes(page);

  return (
    <div className="app">
      <header className="topbar">
        <h1 onClick={() => go('home')} role="button" tabIndex={0}>SmartMaps</h1>
        <span className="tagline">{PAGE_TITLES[page]}</span>
        {hasPasscode && (
          <button className="lock-btn" onClick={lock} title="Lock the app">🔒</button>
        )}
      </header>

      {loadError && <div className="banner error">{loadError}</div>}
      {notice && <div className="banner notice">{notice}</div>}
      {!geocodingEnabled && !loadError && page !== 'home' && page !== 'settings' && (
        <div className="banner warn">
          Add your Google Maps key in <strong>Settings</strong> to place addresses on the map.
        </div>
      )}

      {/* Every page renders inside ONE <main> and the pages that need a map share
          a single MapView. Switching pages only toggles visibility, so the Google
          map is never unmounted and rebuilt — each rebuild is a billable load. */}
      <main className={`page page-${page}`}>
        <section className="pane" hidden={page !== 'home'}>
          <HomeScreen
            patients={patients}
            settings={settings}
            geocodingEnabled={geocodingEnabled}
            onGo={go}
          />
        </section>

        <section className="pane" hidden={page !== 'add'}>
          <PatientForm
            patient={editing}
            onSave={handleSave}
            onCancel={() => { setEditing(null); go('patients'); }}
            defaultCadence={settings?.default_cadence_days || 60}
          />
          <ImportPatients onImported={refresh} />
        </section>

        <section className="pane" hidden={page !== 'patients'}>
          <PatientList
            patients={patients}
            selectedId={selectedId}
            geocodingEnabled={geocodingEnabled}
            onEdit={(p) => { setEditing(p); go('add'); }}
            onDelete={handleDelete}
            onGeocode={handleGeocode}
            onLogVisit={handleLogVisit}
            onSelect={(p) => setSelectedId(p.id)}
            onSaveAddress={handleSaveAddress}
          />
        </section>

        <section className="pane" hidden={page !== 'plan'}>
          <WorkloadView onChanged={refresh} />
          <WeekPlanner
            plan={plan}
            onPlan={setPlan}
            patients={patients}
            homeBase={settings?.home_base || ''}
            apiKey={mapsKey}
          />
        </section>

        <section className="pane" hidden={page !== 'settings'}>
          <SettingsPanel
            settings={settings}
            onSaved={handleSettingsSaved}
            onExport={handleExport}
            onImportBackup={handleImport}
            onClearAll={handleClearAll}
            hasPasscode={hasPasscode}
            onPasscodeChanged={() => setHasPasscode(api.hasPasscode())}
          />
        </section>

        <section className="pane pane-map" hidden={!showMap}>
          <MapView
            patients={patients}
            selectedId={page === 'plan' ? null : selectedId}
            groups={page === 'plan' ? planGroups : null}
            apiKey={mapsKey}
            onSelect={(p) => page !== 'plan' && setSelectedId(p.id)}
          />
        </section>
      </main>

      <nav className="bottom-nav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={page === n.id ? 'nav-item active' : 'nav-item'}
            onClick={() => go(n.id)}
          >
            <span className="nav-icon">{n.icon}</span>
            <span className="nav-label">{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}