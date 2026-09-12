import { useEffect, useState } from 'react';

const EMPTY = {
  name: '',
  address: '',
  phone: '',
  phone2: '',
  email: '',
  visit_minutes: 45,
  due_by: '',
  cadence_days: 60,
  notes: '',
};

// Add / edit form. `patient` null => add mode; otherwise edit mode.
export default function PatientForm({ patient, onSave, onCancel, defaultCadence = 60 }) {
  const emptyForm = { ...EMPTY, cadence_days: defaultCadence };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (patient) {
      setForm({
        name: patient.name ?? '',
        address: patient.address ?? '',
        phone: patient.phone ?? '',
        phone2: patient.phone2 ?? '',
        email: patient.email ?? '',
        visit_minutes: patient.visit_minutes ?? 45,
        due_by: patient.due_by ?? '',
        cadence_days: patient.cadence_days ?? defaultCadence,
        notes: patient.notes ?? '',
      });
    } else {
      setForm({ ...EMPTY, cadence_days: defaultCadence });
    }
    setError('');
  }, [patient, defaultCadence]);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(form);
      if (!patient) setForm({ ...EMPTY, cadence_days: defaultCadence }); // clear after a fresh add
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card form" onSubmit={handleSubmit}>
      <h2>{patient ? 'Edit patient' : 'Add patient'}</h2>

      <label>
        Name *
        <input value={form.name} onChange={update('name')} placeholder="Jane Doe" />
      </label>

      <label>
        Address
        <input
          value={form.address}
          onChange={update('address')}
          placeholder="123 Main St, Springfield, IL"
        />
      </label>

      <div className="row">
        <label>
          Phone
          <input value={form.phone} onChange={update('phone')} placeholder="(555) 123-4567" />
        </label>
        <label>
          Alt. phone
          <input value={form.phone2} onChange={update('phone2')} placeholder="optional" />
        </label>
      </div>

      <div className="row">
        <label>
          Email
          <input value={form.email} onChange={update('email')} placeholder="optional" />
        </label>
        <label>
          Visit length (min)
          <input
            type="number"
            min="5"
            step="5"
            value={form.visit_minutes}
            onChange={update('visit_minutes')}
          />
        </label>
      </div>

      <div className="row">
        <label>
          Due date
          <input type="date" value={form.due_by} onChange={update('due_by')} />
        </label>
        <label>
          Revisit cycle (days)
          <input
            type="number"
            min="1"
            value={form.cadence_days}
            onChange={update('cadence_days')}
          />
        </label>
      </div>
      <p className="form-hint">
        Visit within <strong>±5 days</strong> of the due date. Each patient has their own revisit
        cycle — after a visit is logged, the due date moves forward by that many days.
        {!patient && ' Leave the due date blank to auto-set it to today + the cycle.'}
      </p>

      <label>
        Notes
        <textarea value={form.notes} onChange={update('notes')} rows={3} placeholder="Anything to remember" />
      </label>

      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : patient ? 'Save changes' : 'Add patient'}
        </button>
        {patient && (
          <button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
