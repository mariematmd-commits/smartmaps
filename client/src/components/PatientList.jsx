import { useState, useEffect } from 'react';
import { dueStatus, formatDate, visitWindow, daysUntil, VISIT_WINDOW_DAYS } from '../format.js';

// List of patients with deadline status and edit / delete / geocode / log-visit actions.
// Patients missing an address get an inline box right in the row: importing a
// list of names and then filling in fifty addresses is the normal way to start,
// and it should not mean fifty trips through the edit form.
export default function PatientList({
  patients,
  selectedId,
  geocodingEnabled,
  onEdit,
  onDelete,
  onGeocode,
  onLogVisit,
  onSelect,
  onSaveAddress,
  duplicateCount = 0,
  onMergeDuplicates,
  filter,
  filterNonce,
}) {
  const [drafts, setDrafts] = useState({}); // patientId -> typed address
  const [savingId, setSavingId] = useState(null);
  const [rowError, setRowError] = useState({});
  const [merging, setMerging] = useState(false);

  async function saveAddress(p) {
    const value = (drafts[p.id] ?? '').trim();
    if (!value) return;
    setSavingId(p.id);
    setRowError((e) => ({ ...e, [p.id]: '' }));
    try {
      await onSaveAddress(p, value);
      setDrafts((d) => {
        const next = { ...d };
        delete next[p.id];
        return next;
      });
      // Jump to the next patient still missing an address so she can keep
      // typing. A frame isn't enough — the list re-renders after the save.
      setTimeout(() => {
        const next = document.querySelector('.addr-input');
        if (next) next.focus();
      }, 60);
    } catch (err) {
      setRowError((e) => ({ ...e, [p.id]: err.message }));
    } finally {
      setSavingId(null);
    }
  }

  const [query, setQuery] = useState('');
  // Imports usually arrive without addresses, so make finding those one tap.
  const [onlyNeedsAddress, setOnlyNeedsAddress] = useState(false);
  // 'all' | 'overdue' | 'missed' | 'due-week' — driven from the Home screen too.
  const [dueFilter, setDueFilter] = useState(filter || 'all');

  useEffect(() => {
    if (filter) {
      setDueFilter(filter);
      setOnlyNeedsAddress(false);
      setQuery('');
    }
  }, [filter, filterNonce]);

  if (patients.length === 0) {
    return (
      <div className="card empty">
        <p>No patients yet. Use “Add patient” to enter your first one, or import a list.</p>
      </div>
    );
  }

  // "Needs an address" means no address typed yet — the thing she fixes by
  // typing. A patient whose address simply failed to geocode is a different
  // problem and already carries a "no location" badge.
  const needsAddressCount = patients.filter((p) => !p.address).length;

  const W = VISIT_WINDOW_DAYS;
  const matchesDue = (p) => {
    const n = daysUntil(p.due_by);
    if (dueFilter === 'overdue') return n !== null && n < 0;      // any day past due
    if (dueFilter === 'missed') return n !== null && n < -W;      // past the whole window
    if (dueFilter === 'due-week') return n !== null && n >= 0 && n <= 7;
    return true;
  };
  const counts = {
    overdue: patients.filter((p) => { const n = daysUntil(p.due_by); return n !== null && n < 0; }).length,
    missed: patients.filter((p) => { const n = daysUntil(p.due_by); return n !== null && n < -W; }).length,
  };

  const q = query.trim().toLowerCase();
  const shown = patients
    .filter(matchesDue)
    .filter((p) => (onlyNeedsAddress ? !p.address : true))
    .filter((p) => (q ? p.name.toLowerCase().includes(q) || (p.address || '').toLowerCase().includes(q) : true))
    // Sort most-urgent first so "who's coming due" is obvious.
    .sort((a, b) => {
      if (!a.due_by) return 1;
      if (!b.due_by) return -1;
      return a.due_by.localeCompare(b.due_by);
    });

  const sorted = shown;

  return (
    <div className="card list">
      <h2>Patients ({patients.length})</h2>

      <div className="list-tools">
        <input
          className="list-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or address"
        />
        {needsAddressCount > 0 && (
          <button
            className={onlyNeedsAddress ? 'filter-chip on' : 'filter-chip'}
            onClick={() => setOnlyNeedsAddress((v) => !v)}
          >
            Needs an address ({needsAddressCount})
          </button>
        )}
        {counts.overdue > 0 && (
          <button
            className={dueFilter === 'overdue' ? 'filter-chip on' : 'filter-chip'}
            onClick={() => setDueFilter((f) => (f === 'overdue' ? 'all' : 'overdue'))}
          >
            Overdue ({counts.overdue})
          </button>
        )}
        {counts.missed > 0 && (
          <button
            className={dueFilter === 'missed' ? 'filter-chip on danger' : 'filter-chip danger'}
            onClick={() => setDueFilter((f) => (f === 'missed' ? 'all' : 'missed'))}
          >
            Window closed ({counts.missed})
          </button>
        )}
        {dueFilter !== 'all' && (
          <button className="filter-chip" onClick={() => setDueFilter('all')}>
            Show all
          </button>
        )}
      </div>

      {duplicateCount > 0 && (
        <div className="dupe-banner">
          <span>
            <strong>
              {duplicateCount} duplicate patient{duplicateCount === 1 ? '' : 's'}
            </strong>{' '}
            — these records are identical in every field, usually from importing the same file
            twice. Merging keeps one copy of each. Patients whose details differ in any way are
            left alone.
          </span>
          <button
            className="primary"
            disabled={merging}
            onClick={async () => {
              setMerging(true);
              try {
                await onMergeDuplicates();
              } finally {
                setMerging(false);
              }
            }}
          >
            {merging ? 'Merging…' : `Merge ${duplicateCount}`}
          </button>
        </div>
      )}

      {needsAddressCount > 0 && !onlyNeedsAddress && (
        <p className="addr-nudge">
          {needsAddressCount} patient{needsAddressCount === 1 ? '' : 's'} can’t be scheduled without
          an address. Type them straight into the boxes below — press Enter and it jumps to the
          next one.
        </p>
      )}

      {shown.length === 0 && <p className="hint">No patients match that.</p>}

      <ul>
        {sorted.map((p) => {
          const located = p.lat != null && p.lng != null;
          const due = dueStatus(p.due_by);
          return (
            <li
              key={p.id}
              className={p.id === selectedId ? 'selected' : ''}
              onClick={() => onSelect(p)}
            >
              <div className="patient-main">
                <span className="patient-name">{p.name}</span>
                <span className={`pin ${located ? 'ok' : 'missing'}`}>
                  {located ? '📍 mapped' : '○ no location'}
                </span>
              </div>
              <div className="patient-badges">
                <span className={`due-badge ${due.level}`}>{due.label}</span>
                {p.due_by && (
                  <span className="due-date">
                    due {formatDate(p.due_by)} · visit {visitWindow(p.due_by)}
                  </span>
                )}
              </div>
              {p.address && <div className="patient-sub">{p.address}</div>}
              {p.phone && <div className="patient-sub">{p.phone}</div>}

              {!p.address && (
                <div className="addr-row" onClick={(e) => e.stopPropagation()}>
                  <input
                    className="addr-input"
                    type="text"
                    placeholder="Add their address…"
                    value={drafts[p.id] ?? ''}
                    disabled={savingId === p.id}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        saveAddress(p);
                      }
                    }}
                  />
                  <button
                    className="primary"
                    disabled={savingId === p.id || !(drafts[p.id] ?? '').trim()}
                    onClick={() => saveAddress(p)}
                  >
                    {savingId === p.id ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
              {rowError[p.id] && <div className="addr-error">{rowError[p.id]}</div>}
              <div className="patient-actions" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => onLogVisit(p)}>Log visit</button>
                <button onClick={() => onEdit(p)}>Edit</button>
                {p.address && geocodingEnabled && (
                  <button onClick={() => onGeocode(p)}>
                    {located ? 'Re-locate' : 'Find on map'}
                  </button>
                )}
                <button className="danger" onClick={() => onDelete(p)}>
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
