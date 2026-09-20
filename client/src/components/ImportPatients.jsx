import { useState } from 'react';
import { api } from '../api.js';

// Bulk import, deliberately sitting next to "Add patient" rather than buried in
// Settings — importing a list is how most nurses start, not a configuration step.
// Rows without an address still import; she fills those in afterwards.
export default function ImportPatients({ onImported }) {
  const [open, setOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvName, setCsvName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  function onFile(e) {
    const file = e.target.files?.[0];
    setMsg('');
    if (!file) {
      setCsvText('');
      setCsvName('');
      return;
    }
    setCsvName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.onerror = () => setMsg('Could not read that file.');
    reader.readAsText(file);
  }

  async function run() {
    if (!csvText) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await api.importCsv(csvText);
      const bits = [`Imported ${r.imported} patient${r.imported === 1 ? '' : 's'}`];
      if (r.located) bits.push(`${r.located} placed on the map`);
      if (r.failed) bits.push(`${r.failed} address${r.failed === 1 ? '' : 'es'} not found`);
      if (r.skipped) bits.push(`${r.skipped} row${r.skipped === 1 ? '' : 's'} skipped (no name)`);
      if (!r.geocoded) bits.push('add your Google Maps key to place them on the map');
      setMsg(`${bits.join(' · ')}.`);
      setCsvText('');
      setCsvName('');
      onImported?.();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card import-card">
      <button className="card-toggle" onClick={() => setOpen((o) => !o)}>
        <span>📋 Import a list of patients</span>
        <span className="chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="import-body">
          <p className="field-hint">
            Bring in a whole caseload from a spreadsheet. Only <strong>name</strong> is required —
            patients without an address import fine, and you can add addresses afterwards from the
            Patients page.
          </p>

          <div className="import-controls">
            <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />
            <button className="primary" onClick={run} disabled={busy || !csvText}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>

          {csvName && !msg && <p className="field-hint">Selected: {csvName}</p>}
          {msg && <p className="field-hint import-result">{msg}</p>}

          <details className="import-help">
            <summary>What should the file look like?</summary>
            <p className="field-hint">
              A CSV (save as “CSV” from Excel or Google Sheets) with a header row. Columns can be in
              any order, and any you don’t have can be left out entirely:
            </p>
            <pre className="csv-sample">
{`name,phone,address,due_by,visit_minutes,notes
Eleanor Whitfield,(301) 555-0112,"255 N Washington St, Rockville, MD",2026-09-15,45,Prefers mornings
Harold Simmons,,,2026-09-21,45,Address to follow`}
            </pre>
            <p className="field-hint">
              Recognised: <strong>name</strong> (required), address, phone, phone2, email,
              visit_minutes, cadence_days, due_by, notes. Leave <strong>due_by</strong> out and due
              dates are spread evenly over the next 60 days so they don’t all fall in one week.
            </p>
            <p className="field-hint">
              One catch: names must be in a single <strong>name</strong> column. A file with
              separate first-name and last-name columns won’t import yet.
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
