import { useState } from 'react';
import { api } from '../api.js';

// Bulk import, deliberately sitting next to "Add patient" rather than buried in
// Settings — importing a list is how most nurses start, not a configuration step.
// Rows without an address still import; she fills those in afterwards.
export default function ImportPatients({ onImported }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]); // [{ name, text }]
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const readFile = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result || '') });
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsText(file);
    });

  async function onFile(e) {
    const picked = [...(e.target.files || [])];
    e.target.value = ''; // let the same file be re-picked later
    if (!picked.length) return;
    setMsg('');
    try {
      const read = await Promise.all(picked.map(readFile));
      // Queue up, skipping anything already staged under the same name.
      setFiles((prev) => [...prev, ...read.filter((r) => !prev.some((p) => p.name === r.name))]);
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function run() {
    if (!files.length) return;
    setBusy(true);
    setMsg('');
    const total = { imported: 0, merged: 0, located: 0, failed: 0, skipped: 0 };
    let geocoded = true;
    try {
      // Sequentially, so the second file sees patients from the first and can
      // merge into them rather than duplicating.
      for (const f of files) {
        const r = await api.importCsv(f.text);
        total.imported += r.imported;
        total.merged += r.merged || 0;
        total.located += r.located;
        total.failed += r.failed;
        total.skipped += r.skipped;
        geocoded = r.geocoded;
      }
      const bits = [
        `Added ${total.imported} new patient${total.imported === 1 ? '' : 's'}`,
      ];
      if (total.merged)
        bits.push(`${total.merged} already on your list — details merged in, not duplicated`);
      if (total.located) bits.push(`${total.located} placed on the map`);
      if (total.failed) bits.push(`${total.failed} address${total.failed === 1 ? '' : 'es'} not found`);
      if (total.skipped) bits.push(`${total.skipped} row${total.skipped === 1 ? '' : 's'} skipped (no name)`);
      if (!geocoded) bits.push('add your Google Maps key to place them on the map');
      setMsg(`${bits.join(' · ')}.`);
      setFiles([]);
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
          <p className="field-hint">
            You can import <strong>as many files as you like</strong>, now or later — each one adds
            to your list. Anyone who appears in more than one file stays a single patient: details
            from the newer file fill in whatever was blank, and nothing you have already entered
            gets overwritten.
          </p>

          <div className="import-controls">
            <input type="file" accept=".csv,text/csv" multiple onChange={onFile} disabled={busy} />
            <button className="primary" onClick={run} disabled={busy || !files.length}>
              {busy ? 'Importing…' : `Import${files.length > 1 ? ` ${files.length} files` : ''}`}
            </button>
          </div>

          {files.length > 0 && (
            <ul className="file-queue">
              {files.map((f) => (
                <li key={f.name}>
                  <span>{f.name}</span>
                  <button
                    className="remove-x"
                    title="Remove"
                    disabled={busy}
                    onClick={() => setFiles((prev) => prev.filter((p) => p.name !== f.name))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
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
