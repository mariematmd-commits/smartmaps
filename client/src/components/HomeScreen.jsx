import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { todayStr } from '../lib/dates.js';
import { daysUntil, formatDate } from '../format.js';
import { atRisk, WINDOW_DAYS } from '../lib/windowWatch.js';

// Home has two faces. The very first time the app is opened it explains what
// this is and what needs setting up; after that it gets out of the way and
// becomes a "today" summary with the three things she actually does.
const SEEN_KEY = 'smartmaps.introSeen';

function introAlreadySeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false; // private window / blocked storage: just show the intro
  }
}
function markIntroSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* nothing to do — worst case she sees the intro again */
  }
}

export default function HomeScreen({ patients, settings, geocodingEnabled, onGo }) {
  const [showIntro, setShowIntro] = useState(() => !introAlreadySeen());
  const [today, setToday] = useState(null);

  const date = todayStr();

  useEffect(() => {
    if (showIntro) return;
    let cancelled = false;
    api
      .listVisits(date, date)
      .then((v) => !cancelled && setToday(v))
      .catch(() => !cancelled && setToday([]));
    return () => {
      cancelled = true;
    };
  }, [showIntro, date, patients]);

  function dismissIntro(destination) {
    markIntroSeen();
    setShowIntro(false);
    if (destination) onGo(destination);
  }

  if (showIntro) {
    return (
      <div className="home intro">
        <div className="card intro-card">
          <h2>Welcome to SmartMaps</h2>
          <p className="intro-lead">
            A visit planner for one traveling nurse. Add your patients, and it groups the ones
            coming due by area so each work day is one neighbourhood instead of a zigzag.
          </p>
          <ol className="intro-steps">
            <li>
              <strong>Add your patients</strong> — one at a time, or import a list and fill in
              addresses after.
            </li>
            <li>
              <strong>Plan the week</strong> — it builds a call list per day, grouped by area and
              sorted by who is most overdue.
            </li>
            <li>
              <strong>Call to confirm</strong> — it suggests who to ring next and builds a timed
              schedule as you go.
            </li>
            <li>
              <strong>Drive</strong> — open the finished day in Google Maps, or scan a QR code to
              send it to your phone.
            </li>
          </ol>
          <p className="intro-privacy">
            🔒 Everything you enter stays on this device. There is no server and no account — your
            patient list is never uploaded anywhere.
          </p>
          <div className="intro-actions">
            <button className="primary full" onClick={() => dismissIntro('settings')}>
              Set up — add your Google Maps key
            </button>
            <button className="full" onClick={() => dismissIntro(null)}>
              Skip for now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Same definition the Patients page uses: no address typed yet.
  const needsAddress = patients.filter((p) => !p.address).length;
  const risk = atRisk(patients);
  const missed = risk.filter((r) => r.level === 'missed');
  const closing = risk.filter((r) => r.level === 'closing');
  const overdue = patients.filter((p) => p.due_by && daysUntil(p.due_by) < 0).length;
  const dueSoon = patients.filter((p) => {
    if (!p.due_by) return false;
    const d = daysUntil(p.due_by);
    return d >= 0 && d <= 7;
  }).length;

  const confirmedToday = (today ?? []).filter((v) => v.status === 'confirmed');
  const toCallToday = (today ?? []).filter((v) => v.status === 'proposed' || v.status === 'callback');

  return (
    <div className="home">
      <div className="card home-today">
        <h2>Today</h2>
        <p className="home-date">{formatDate(date)}</p>

        {today === null ? (
          <p className="hint">Loading…</p>
        ) : confirmedToday.length || toCallToday.length ? (
          <div className="home-stats">
            <div className="stat">
              <span className="stat-num">{confirmedToday.length}</span>
              <span className="stat-label">visit{confirmedToday.length === 1 ? '' : 's'} booked</span>
            </div>
            {toCallToday.length > 0 && (
              <div className="stat">
                <span className="stat-num">{toCallToday.length}</span>
                <span className="stat-label">still to call</span>
              </div>
            )}
          </div>
        ) : (
          <p className="hint">Nothing scheduled today. Plan a week to build a call list.</p>
        )}
      </div>

      <div className="card home-caseload">
        <h2>Your caseload</h2>
        <div className="home-stats">
          <button className="stat" onClick={() => onGo('patients', 'all')}>
            <span className="stat-num">{patients.length}</span>
            <span className="stat-label">patient{patients.length === 1 ? '' : 's'}</span>
          </button>
          <button
            className={`stat ${overdue ? 'warn' : ''}`}
            onClick={() => overdue && onGo('patients', 'overdue')}
            disabled={!overdue}
          >
            <span className="stat-num">{overdue}</span>
            <span className="stat-label">overdue{overdue ? ' — see who' : ''}</span>
          </button>
          <button
            className="stat"
            onClick={() => dueSoon && onGo('patients', 'due-week')}
            disabled={!dueSoon}
          >
            <span className="stat-num">{dueSoon}</span>
            <span className="stat-label">due this week</span>
          </button>
        </div>

        {missed.length > 0 && (
          <button className="home-alert danger" onClick={() => onGo('patients', 'missed')}>
            🚨 {missed.length} patient{missed.length === 1 ? ' is' : 's are'} more than{' '}
            {WINDOW_DAYS} days past their due date — the visit window has closed. Tap to see who and
            book them →
          </button>
        )}
        {closing.length > 0 && (
          <button className="home-alert" onClick={() => onGo('plan')}>
            ⏳ {closing.length} patient{closing.length === 1 ? "'s window closes" : "s' windows close"}{' '}
            within a week. Plan them in before they run out of time →
          </button>
        )}

        {needsAddress > 0 && (
          <button className="home-alert" onClick={() => onGo('patients')}>
            ⚠️ {needsAddress} patient{needsAddress === 1 ? '' : 's'} still need
            {needsAddress === 1 ? 's' : ''} an address before they can be scheduled →
          </button>
        )}
        {!geocodingEnabled && (
          <button className="home-alert" onClick={() => onGo('settings')}>
            ⚠️ Add your Google Maps key to place patients on the map →
          </button>
        )}
      </div>

      <div className="home-actions">
        <button className="home-action" onClick={() => onGo('plan')}>
          <span className="ha-icon">🗓</span>
          <span className="ha-text">
            <strong>Plan the week</strong>
            <small>Group patients by area into call lists</small>
          </span>
          <span className="ha-arrow">→</span>
        </button>
        <button className="home-action" onClick={() => onGo('add')}>
          <span className="ha-icon">➕</span>
          <span className="ha-text">
            <strong>Add a patient</strong>
            <small>One at a time, or import a list</small>
          </span>
          <span className="ha-arrow">→</span>
        </button>
        <button className="home-action" onClick={() => onGo('patients')}>
          <span className="ha-icon">👥</span>
          <span className="ha-text">
            <strong>All patients</strong>
            <small>{patients.length} on your list</small>
          </span>
          <span className="ha-arrow">→</span>
        </button>
      </div>

      <button className="intro-replay" onClick={() => setShowIntro(true)}>
        Show the introduction again
      </button>
    </div>
  );
}
