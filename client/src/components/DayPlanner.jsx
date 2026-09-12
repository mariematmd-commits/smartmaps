import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api.js';
import { dueStatus, dayRouteUrl } from '../format.js';

const toMin = (t) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (min) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fmtTime = (t) => {
  const m = toMin(t);
  if (m == null) return '';
  let h = Math.floor(m / 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m % 60).padStart(2, '0')} ${ap}`;
};

// The Confirm / window / not-available / later controls, shared by the
// suggestion card and the "others" list.
function CallActions({ visit, defaultTime, onConfirm, onDecline, onLater, busy }) {
  const [time, setTime] = useState(defaultTime || '');
  const [showWin, setShowWin] = useState(!!(visit.win_start || visit.win_end));
  const [ws, setWs] = useState(visit.win_start || '');
  const [we, setWe] = useState(visit.win_end || '');
  return (
    <div className="call-actions-box">
      <div className="ca-row">
        <label className="ca-time">
          Time <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <button className="seg" onClick={() => setShowWin((s) => !s)}>
          {showWin ? '– window' : '+ availability window'}
        </button>
      </div>
      {showWin && (
        <div className="ca-row">
          <span>Free</span>
          <input type="time" value={ws} onChange={(e) => setWs(e.target.value)} />
          <span>to</span>
          <input type="time" value={we} onChange={(e) => setWe(e.target.value)} />
        </div>
      )}
      <div className="ca-row">
        <button className="seg on" disabled={busy} onClick={() => onConfirm(visit.id, time, ws, we)}>
          Confirm{time ? ` · ${fmtTime(time)}` : ''}
        </button>
        <button className="seg danger" disabled={busy} onClick={() => onDecline(visit.id)}>
          Not available today
        </button>
        <button className="seg" disabled={busy} onClick={() => onLater(visit.id)}>
          Call back later
        </button>
      </div>
    </div>
  );
}

export default function DayPlanner({ date, patients = [], homeBase = '', onChange }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [addQuery, setAddQuery] = useState('');
  const [addId, setAddId] = useState(null);
  const [showList, setShowList] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrImg, setQrImg] = useState('');

  async function load() {
    try {
      setState(await api.dayPlan(date));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    setOpenId(null);
    load();
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the QR image in sync with the current route when it's shown.
  useEffect(() => {
    if (!showQr) return;
    const stops = state?.schedule || [];
    if (!stops.length) {
      setQrImg('');
      return;
    }
    QRCode.toDataURL(dayRouteUrl(homeBase, stops), { width: 200, margin: 1 })
      .then(setQrImg)
      .catch(() => setQrImg(''));
  }, [showQr, state, homeBase]);

  async function act(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      onChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setOpenId(null);
    }
  }
  const confirm = (id, time, ws, we) =>
    act(() =>
      api.updateVisit(id, {
        status: 'confirmed',
        slot_time: time || null,
        win_start: ws || null,
        win_end: we || null,
      })
    );
  const decline = (id) => act(() => api.updateVisit(id, { status: 'declined' }));
  const later = (id) => act(() => api.updateVisit(id, { status: 'callback' }));
  const remove = (id) => act(() => api.deleteVisit(id));
  const addManual = (pid, emg) =>
    act(() => api.addVisit({ patient_id: pid, date, is_emergency: emg, status: 'proposed' }));

  if (!state) return <div className="card"><p className="hint">Loading…</p></div>;

  const sug = state.suggestion;
  const others = state.pool.filter((p) => !sug || p.id !== sug.id);
  const last = state.schedule[state.schedule.length - 1];
  const nextDefault = last
    ? toHHMM((toMin(last.slot_time) || toMin(state.dayStart)) + (last.visit_minutes || 45) + 15)
    : state.dayStart;
  const endOfLast = last ? toHHMM((toMin(last.slot_time) || 0) + (last.visit_minutes || 45)) : null;
  const routeUrl = state.schedule.length > 0 ? dayRouteUrl(homeBase, state.schedule) : null;

  // When empty, show the whole list (browse like a dropdown); when typing, filter.
  const addMatches = addQuery.trim()
    ? patients.filter((p) => p.name.toLowerCase().includes(addQuery.trim().toLowerCase()))
    : patients;

  return (
    <div className="day-planner">
      <div className="card">
        <h3>Schedule</h3>
        {state.schedule.length === 0 ? (
          <p className="hint">No appointments yet — start with the suggested call below.</p>
        ) : (
          <ol className="timeline">
            {state.schedule.map((s) => (
              <li key={s.id}>
                <span className="tl-time">{fmtTime(s.slot_time)}</span>
                <span className="tl-body">
                  <span className="call-name">
                    {s.name}
                    {s.is_emergency ? <span className="emg-tag">urgent</span> : null}
                  </span>
                  <span className="tl-meta">
                    {s.driveFromPrev > 0 && <span>{s.driveFromPrev} min drive</span>}
                    {s.win_start && <span>free {fmtTime(s.win_start)}–{fmtTime(s.win_end)}</span>}
                  </span>
                </span>
                <button className="remove-x" title="Remove" onClick={() => remove(s.id)}>×</button>
              </li>
            ))}
          </ol>
        )}

        {state.schedule.length > 0 && (
          <div className="route-launch">
            <div className="route-summary-line">
              {state.schedule.length} stop{state.schedule.length === 1 ? '' : 's'} · first {fmtTime(state.schedule[0].slot_time)}
              {endOfLast && ` · last visit ends ${fmtTime(endOfLast)}`}
            </div>
            <a className="button primary full" href={routeUrl} target="_blank" rel="noopener noreferrer">
              Open route in Google Maps →
            </a>
            <button className="seg" onClick={() => setShowQr((s) => !s)}>
              {showQr ? 'Hide QR code' : '📱 Show QR code for phone'}
            </button>
            {showQr && qrImg && (
              <div className="qr-box">
                <img src={qrImg} alt="Route QR code" width="200" height="200" />
                <span className="field-hint">
                  Scan with your phone's camera to open this route in Google Maps.
                </span>
              </div>
            )}
            {!homeBase && (
              <span className="field-hint">
                Tip: set a Home base in Settings so the route starts and ends there.
              </span>
            )}
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {sug ? (
        <div className="card suggestion-card">
          <div className="sug-head">📞 Call next</div>
          <div className="sug-name">{sug.name}</div>
          <div className="sug-reason">{sug.reason} · suggested {fmtTime(sug.suggested_time)}</div>
          {sug.phone && <a className="call-phone" href={`tel:${sug.phone}`}>📞 {sug.phone}</a>}
          <CallActions
            key={`sug-${sug.id}-${sug.suggested_time}`}
            visit={sug}
            defaultTime={sug.suggested_time}
            onConfirm={confirm}
            onDecline={decline}
            onLater={later}
            busy={busy}
          />
        </div>
      ) : (
        <div className="card">
          <p className="hint">
            {state.poolCount === 0
              ? '🎉 Every patient for this day has been handled.'
              : 'No more suggestions — remaining patients are deferred or need a location.'}
          </p>
        </div>
      )}

      {others.length > 0 && (
        <div className="card">
          <h3>Others to call ({others.length})</h3>
          <ul className="call-list">
            {others.map((p) => {
              const due = dueStatus(p.due_by);
              return (
                <li key={p.id}>
                  <div className="call-main">
                    <span className="call-name">
                      {p.name}
                      {p.status === 'callback' ? (
                        <span className="status-badge callback">call back</span>
                      ) : null}
                    </span>
                    <span className={`due-badge ${due.level}`}>{due.label}</span>
                  </div>
                  {p.phone && <a className="call-phone" href={`tel:${p.phone}`}>📞 {p.phone}</a>}
                  {openId === p.id ? (
                    <CallActions
                      visit={p}
                      defaultTime={nextDefault}
                      onConfirm={confirm}
                      onDecline={decline}
                      onLater={later}
                      busy={busy}
                    />
                  ) : (
                    <div className="visit-actions">
                      <button className="seg" onClick={() => setOpenId(p.id)}>Log call…</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="manual-add">
          <div className="combobox">
            <input
              type="text"
              value={addQuery}
              placeholder="Add a patient — type a name…"
              onChange={(e) => { setAddQuery(e.target.value); setAddId(null); setShowList(true); }}
              onFocus={() => setShowList(true)}
              onBlur={() => setTimeout(() => setShowList(false), 150)}
            />
            <span className="combo-caret" onMouseDown={(e) => { e.preventDefault(); setShowList((s) => !s); }}>▾</span>
            {showList && addMatches.length > 0 && (
              <ul className="combo-list">
                {addMatches.map((p) => (
                  <li
                    key={p.id}
                    onMouseDown={() => { setAddId(p.id); setAddQuery(p.name); setShowList(false); }}
                  >
                    {p.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            className="seg"
            disabled={!addId || busy}
            onClick={() => { addManual(addId, false); setAddQuery(''); setAddId(null); }}
          >
            Add
          </button>
          <button
            className="seg danger"
            disabled={!addId || busy}
            title="Add as urgent"
            onClick={() => { addManual(addId, true); setAddQuery(''); setAddId(null); }}
          >
            Urgent
          </button>
        </div>
      </div>
    </div>
  );
}
