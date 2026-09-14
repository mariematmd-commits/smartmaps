import { useState } from 'react';
import { api } from '../api.js';
import { dueStatus, formatDate } from '../format.js';
import { dayColor } from '../dayColors.js';
import DayPlanner from './DayPlanner.jsx';

// --- date helpers (local calendar) ---
function toInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function nextMonday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const offset = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + offset);
  return toInput(d);
}
function mondayOf(dateStr) {
  const [y, m, day] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  const diff = dt.getDay() === 0 ? -6 : 1 - dt.getDay();
  dt.setDate(dt.getDate() + diff);
  return toInput(dt);
}

export function activeDays(plan) {
  return plan ? plan.days.filter((d) => d.patients.length > 0) : [];
}

export default function WeekPlanner({ plan, onPlan, patients = [], homeBase = '', apiKey = '' }) {
  const [weekStart, setWeekStart] = useState(nextMonday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [committed, setCommitted] = useState(false);
  const [visits, setVisits] = useState([]); // week-level, for the day chips
  const [selectedDate, setSelectedDate] = useState(null);

  async function build() {
    setBusy(true);
    setError('');
    setCommitted(false);
    setVisits([]);
    try {
      const monday = mondayOf(weekStart);
      setWeekStart(monday);
      onPlan(await api.planWeek(monday));
    } catch (err) {
      setError(err.message);
      onPlan(null);
    } finally {
      setBusy(false);
    }
  }

  async function reloadVisits() {
    if (!plan) return;
    setVisits(await api.listVisits(plan.weekStart, plan.weekEnd));
  }

  async function commit() {
    setBusy(true);
    setError('');
    try {
      await api.commitPlan(plan.weekStart);
      const v = await api.listVisits(plan.weekStart, plan.weekEnd);
      setVisits(v);
      // Land on the first day that actually has patients.
      const firstDay = activeDays(plan)[0];
      setSelectedDate(firstDay ? firstDay.date : plan.days[0]?.date);
      setCommitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const days = activeDays(plan);
  const countsFor = (date) => {
    const forDay = visits.filter((v) => v.date === date);
    return {
      confirmed: forDay.filter((v) => v.status === 'confirmed').length,
      pending: forDay.filter((v) => v.status === 'proposed' || v.status === 'callback').length,
    };
  };

  return (
    <div className="week-planner">
      <div className="card">
        <h2>Plan a week</h2>
        <p className="hint">
          Pick the week you'll be visiting (usually next week). The app groups patients who are
          coming due into your work days by area.
        </p>
        <div className="week-controls">
          <label>
            Week of
            <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
          </label>
          <button className="primary" onClick={build} disabled={busy}>
            {busy && !committed ? 'Building…' : 'Build call list'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {/* ---- Proposal (before committing) ---- */}
      {plan && !committed && (
        <>
          <div className="plan-notices">
            {plan.scheduledCount === 0 && (
              <p className="notice-line warn">
                No patients are coming due this week (with a due date and a mapped location).
              </p>
            )}
            {plan.noDeadline.length > 0 && (
              <p className="notice-line">
                {plan.noDeadline.length} patient{plan.noDeadline.length === 1 ? '' : 's'} have no
                due date set — add one to include them.
              </p>
            )}
            {plan.needsLocation.length > 0 && (
              <p className="notice-line">
                {plan.needsLocation.length} coming-due patient
                {plan.needsLocation.length === 1 ? '' : 's'} have no map location.
              </p>
            )}
            {plan.overflow.length > 0 && (
              <p className="notice-line">
                {plan.overflow.length} more are due this week than fit — they'll roll over or serve
                as backups.
              </p>
            )}
          </div>

          {days.map((day, i) => (
            <div className="card day-card" key={day.date}>
              <div className="day-head" style={{ borderLeftColor: dayColor(i) }}>
                <span className="day-dot" style={{ background: dayColor(i) }} />
                <strong>{day.label}</strong>
                <span className="day-date">{formatDate(day.date)}</span>
                <span className="day-count">{day.patients.length} to call</span>
              </div>
              <ul className="call-list">
                {day.patients.map((p) => {
                  const due = dueStatus(p.due_by);
                  return (
                    <li key={p.id}>
                      <div className="call-main">
                        <span className="call-name">{p.name}</span>
                        <span className={`due-badge ${due.level}`}>{due.label}</span>
                      </div>
                      {p.address && <div className="call-sub">{p.address}</div>}
                      {p.phone && <a className="call-phone" href={`tel:${p.phone}`}>📞 {p.phone}</a>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {plan.scheduledCount > 0 && (
            <button className="primary full" onClick={commit} disabled={busy}>
              {busy ? 'Saving…' : 'Save & start calling →'}
            </button>
          )}
        </>
      )}

      {/* ---- Working the week (guided, day by day) ---- */}
      {plan && committed && (
        <>
          <div className="work-summary card">
            <strong>Working the week of {formatDate(plan.weekStart)}</strong>
            <button onClick={() => setCommitted(false)}>Back to proposal</button>
          </div>

          <div className="day-chips">
            {plan.days
              .filter((d) => d.patients.length > 0 || countsFor(d.date).confirmed > 0)
              .map((d, i) => {
                const c = countsFor(d.date);
                return (
                  <button
                    key={d.date}
                    className={`day-chip ${selectedDate === d.date ? 'active' : ''}`}
                    onClick={() => setSelectedDate(d.date)}
                  >
                    <span className="chip-dot" style={{ background: dayColor(i) }} />
                    <span className="chip-day">{d.label}</span>
                    <span className="chip-counts">{c.confirmed}✓ / {c.pending} left</span>
                  </button>
                );
              })}
          </div>

          {selectedDate && (
            <DayPlanner
              date={selectedDate}
              patients={patients}
              homeBase={homeBase}
              apiKey={apiKey}
              onChange={reloadVisits}
            />
          )}
        </>
      )}
    </div>
  );
}
