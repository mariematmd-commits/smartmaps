import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { dueStatus, formatDate } from '../format.js';
import { rebalanceFrom } from '../lib/rebalance.js';
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
  // Pointer-based dragging, so a finger works exactly like a mouse. HTML5
  // drag-and-drop fires no events on touch at all, which left the phone with
  // only the Move button.
  const [dragging, setDragging] = useState(null);   // { patientId, from, name } — set once
  const [dropTarget, setDropTarget] = useState(null);
  const [moveOpen, setMoveOpen] = useState(null);   // patient id whose day picker is open
  const dragRef = useRef(null);                     // live copy for the window listeners
  const ghostRef = useRef(null);                    // moved directly, not through React
  const autoScroll = useRef(0);
  const [movedIds, setMovedIds] = useState(() => new Set()); // placed by hand — never re-spread
  const [pivot, setPivot] = useState(null);         // earliest day a move touched
  const [rebalanced, setRebalanced] = useState('');
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

  // Which day is under the finger right now. elementsFromPoint (plural) is used
  // so the fixed bottom navigation — which sits exactly where a finger ends up
  // when dragging downwards — doesn't mask the day card beneath it.
  const dayUnder = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      // The pinned bar wins, since it sits over the page by design.
      const slot = el.closest?.('.drop-slot');
      if (slot) return slot.dataset.date;
      const card = el.closest?.('.day-card');
      if (card) return card.dataset.date;
    }
    return null;
  };

  function startDrag(e, patientId, fromDate, name) {
    if (e.button != null && e.button !== 0) return; // ignore right-click
    e.preventDefault();
    dragRef.current = { patientId, from: fromDate, name, x: e.clientX, y: e.clientY };
    setDragging({ patientId, from: fromDate, name });
    setDropTarget(fromDate);
    setMoveOpen(null);
  }

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e) => {
      const x = e.clientX;
      const y = e.clientY;
      dragRef.current = { ...dragRef.current, x, y };
      // Move the floating card by touching the DOM directly. Doing this through
      // state would re-render every day and every patient on each pointer
      // event, which is enough to make the drag stutter.
      const ghost = ghostRef.current;
      if (ghost) ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -140%)`;
      // Only a change of day is worth a render.
      const over = dayUnder(x, y);
      setDropTarget((prev) => (prev === over ? prev : over));
      // Days can sit off-screen on a phone, so creep the page when she drags
      // towards an edge instead of stranding her mid-gesture.
      // Reach further up from the bottom than the top, because the fixed nav
      // eats the last ~60px there. Speed scales with how close to the edge she is.
      const TOP_EDGE = 90;
      const BOTTOM_EDGE = 150;
      const h = window.innerHeight;
      if (y < TOP_EDGE) autoScroll.current = -Math.ceil(((TOP_EDGE - y) / TOP_EDGE) * 28);
      else if (y > h - BOTTOM_EDGE) autoScroll.current = Math.ceil(((y - (h - BOTTOM_EDGE)) / BOTTOM_EDGE) * 28);
      else autoScroll.current = 0;
    };

    const finish = () => {
      const d = dragRef.current;
      const target = d ? dayUnder(d.x, d.y) : null;
      if (d && target && target !== d.from) movePatient(d.patientId, d.from, target);
      dragRef.current = null;
      autoScroll.current = 0;
      setDragging(null);
      setDropTarget(null);
    };

    const timer = setInterval(() => {
      if (!autoScroll.current) return;
      const before = window.scrollY;
      window.scrollBy(0, autoScroll.current);
      if (window.scrollY === before) return; // already at the end of the page
      // The page moved under a stationary finger, so re-check what's beneath it.
      const d = dragRef.current;
      if (d) setDropTarget((prev) => { const o = dayUnder(d.x, d.y); return prev === o ? prev : o; });
    }, 30);

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [dragging?.patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reassign a patient to a different day in the proposal. The plan is still
  // just a suggestion at this point, so this only edits what's on screen —
  // "Save & start calling" is what writes it down.
  // Re-spread the days from the change onward, keeping anyone she has moved by
  // hand or already spoken to exactly where they are.
  async function rebalance() {
    if (!plan || !pivot) return;
    setBusy(true);
    setError('');
    try {
      let spokenFor = new Set();
      try {
        const vs = await api.listVisits(plan.weekStart, plan.weekEnd);
        spokenFor = new Set(vs.filter((v) => v.status !== 'proposed').map((v) => v.patient_id));
      } catch {
        /* nothing committed yet — nobody has been called */
      }
      const pinnedIds = new Set([...movedIds, ...spokenFor]);
      const { days: next, moved } = rebalanceFrom({
        days: plan.days,
        pivotDate: pivot,
        pinnedIds,
        maxPerDay: plan.maxPerDay || 8,
      });
      onPlan({ ...plan, days: next });
      setRebalanced(
        moved
          ? `Re-spread ${moved} patient${moved === 1 ? '' : 's'} across the rest of the week.`
          : 'Nothing needed moving — the rest of the week already fits.'
      );
      setTimeout(() => setRebalanced(''), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function movePatient(patientId, fromDate, toDate) {
    if (!plan || fromDate === toDate) return;
    // Remember who she placed by hand, and how far back the change reaches.
    setMovedIds((s) => new Set(s).add(patientId));
    setPivot((p) => {
      const earliest = fromDate < toDate ? fromDate : toDate;
      return !p || earliest < p ? earliest : p;
    });
    setRebalanced('');
    const next = {
      ...plan,
      days: plan.days.map((d) => ({ ...d, patients: [...d.patients] })),
    };
    const from = next.days.find((d) => d.date === fromDate);
    const to = next.days.find((d) => d.date === toDate);
    if (!from || !to) return;
    const idx = from.patients.findIndex((p) => p.id === patientId);
    if (idx < 0) return;
    const [moved] = from.patients.splice(idx, 1);
    // Keep each day most-urgent-first, the order the builder uses.
    to.patients.push(moved);
    to.patients.sort((a, b) => (a.due_by || '').localeCompare(b.due_by || ''));
    onPlan(next);
  }

  async function reloadVisits() {
    if (!plan) return;
    setVisits(await api.listVisits(plan.weekStart, plan.weekEnd));
  }

  async function commit() {
    setBusy(true);
    setError('');
    try {
      // Send the days as shown so any moves she made are what gets written.
      await api.commitPlan(plan.weekStart, plan.days);
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

          <p className="field-hint drag-hint">
            Not happy with a day? Press the <strong>⠿</strong> handle and drag a patient onto
            another day — on a phone or a laptop. The <strong>Move</strong> button does the same if
            you prefer tapping. Nothing is saved until you start calling.
          </p>

          {pivot && (
            <div className="rebalance-bar">
              <span>
                You’ve moved {movedIds.size} patient{movedIds.size === 1 ? '' : 's'}. Want the rest
                of the week re-spread around {movedIds.size === 1 ? 'them' : 'those changes'}?
              </span>
              <button className="primary" onClick={rebalance} disabled={busy}>
                {busy ? 'Working…' : 'Re-fit the rest of the week'}
              </button>
              <span className="field-hint rebalance-note">
                Days before {formatDate(pivot)} are left alone, and so is anyone you’ve moved by
                hand or already spoken to.
              </span>
            </div>
          )}
          {rebalanced && <p className="notice-line rebalance-done">{rebalanced}</p>}

          {/* While dragging, every day is reachable without scrolling: this bar
              stays pinned at the top, so the target is never off-screen. */}
          {dragging && (
            <>
              <div className="drop-bar" aria-hidden="true">
                <span className="drop-bar-label">Drop {dragging.name} on…</span>
                <div className="drop-bar-days">
                  {(plan.days || []).map((d) => (
                    <span
                      key={d.date}
                      data-date={d.date}
                      className={`drop-slot${dropTarget === d.date ? ' on' : ''}${d.date === dragging.from ? ' current' : ''}`}
                    >
                      {d.label}
                    </span>
                  ))}
                </div>
              </div>
              <div ref={ghostRef} className="drag-ghost" aria-hidden="true">
                {dragging.name}
              </div>
            </>
          )}

          {/* Every work day is shown, not only the ones with patients, so an
              empty day is still somewhere you can drop someone. */}
          {(plan.days || []).map((day, i) => (
            <div
              className={`card day-card${dropTarget === day.date && dragging ? ' drop-over' : ''}`}
              key={day.date}
              data-date={day.date}
            >
              <div className="day-head" style={{ borderLeftColor: dayColor(i) }}>
                <span className="day-dot" style={{ background: dayColor(i) }} />
                <strong>{day.label}</strong>
                <span className="day-date">{formatDate(day.date)}</span>
                <span className="day-count">
                  {day.patients.length ? `${day.patients.length} to call` : 'empty'}
                </span>
              </div>
              <ul className="call-list">
                {day.patients.map((p) => {
                  const due = dueStatus(p.due_by);
                  return (
                    <li
                      key={p.id}
                      className={`draggable${dragging?.patientId === p.id ? ' dragging' : ''}`}
                      onPointerDown={(e) => {
                        // A finger needs to be able to scroll the list, so on
                        // touch only the grip starts a drag. A mouse can grab
                        // anywhere on the row.
                        if (e.pointerType !== 'mouse') return;
                        startDrag(e, p.id, day.date, p.name);
                      }}
                    >
                      <div className="call-main">
                        <span
                          className="drag-grip"
                          title="Drag to another day"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            startDrag(e, p.id, day.date, p.name);
                          }}
                        >
                          ⠿
                        </span>
                        <span className="call-name">{p.name}</span>
                        <span className={`due-badge ${due.level}`}>{due.label}</span>
                      </div>
                      {p.address && <div className="call-sub">{p.address}</div>}
                      {p.phone && <a className="call-phone" href={`tel:${p.phone}`}>📞 {p.phone}</a>}

                      {moveOpen === p.id ? (
                        <div className="move-row">
                          {(plan.days || [])
                            .filter((d) => d.date !== day.date)
                            .map((d) => (
                              <button
                                key={d.date}
                                className="seg"
                                onClick={() => {
                                  movePatient(p.id, day.date, d.date);
                                  setMoveOpen(null);
                                }}
                              >
                                {d.label}
                              </button>
                            ))}
                          <button className="seg" onClick={() => setMoveOpen(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="move-btn" onClick={() => setMoveOpen(p.id)}>
                          Move →
                        </button>
                      )}
                    </li>
                  );
                })}
                {day.patients.length === 0 && (
                  <li className="empty-day">Drop a patient here to move them to {day.label}.</li>
                )}
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
              weekDays={(plan?.days || []).map((d) => ({ date: d.date, label: d.label }))}
              onChange={reloadVisits}
            />
          )}
        </>
      )}
    </div>
  );
}
