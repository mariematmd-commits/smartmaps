import { dueStatus, formatDate, visitWindow } from '../format.js';

// List of patients with deadline status and edit / delete / geocode / log-visit actions.
export default function PatientList({
  patients,
  selectedId,
  geocodingEnabled,
  onEdit,
  onDelete,
  onGeocode,
  onLogVisit,
  onSelect,
}) {
  if (patients.length === 0) {
    return (
      <div className="card empty">
        <p>No patients yet. Add your first one on the left.</p>
      </div>
    );
  }

  // Sort most-urgent first so "who's coming due" is obvious.
  const sorted = [...patients].sort((a, b) => {
    if (!a.due_by) return 1;
    if (!b.due_by) return -1;
    return a.due_by.localeCompare(b.due_by);
  });

  return (
    <div className="card list">
      <h2>Patients ({patients.length})</h2>
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
