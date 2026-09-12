import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDuration, formatMiles, googleMapsDirectionsUrl } from '../format.js';

const START_KEY = 'smartmaps.startAddress';

// Plans the fastest visiting order for the mapped patients from a start location.
export default function RoutePlanner({ patients, route, onRoute, homeBase }) {
  const [startAddress, setStartAddress] = useState(
    () => localStorage.getItem(START_KEY) || ''
  );

  // Adopt the Settings home base as the start once it loads, unless the nurse
  // has already typed something.
  useEffect(() => {
    if (homeBase && !startAddress) setStartAddress(homeBase);
  }, [homeBase]); // eslint-disable-line react-hooks/exhaustive-deps
  const [returnHome, setReturnHome] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mapped = patients.filter((p) => p.lat != null && p.lng != null);

  async function handleOptimize() {
    setError('');
    if (!startAddress.trim()) {
      setError('Enter your start location first.');
      return;
    }
    setBusy(true);
    try {
      localStorage.setItem(START_KEY, startAddress.trim());
      const result = await api.optimizeRoute(
        startAddress.trim(),
        mapped.map((p) => p.id),
        returnHome
      );
      onRoute(result);
    } catch (err) {
      setError(err.message);
      onRoute(null);
    } finally {
      setBusy(false);
    }
  }

  function clearRoute() {
    onRoute(null);
    setError('');
  }

  return (
    <div className="card planner">
      <h2>Plan route</h2>

      <label>
        Start location (home / office)
        <input
          value={startAddress}
          onChange={(e) => setStartAddress(e.target.value)}
          placeholder="Where you start your day"
        />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={returnHome}
          onChange={(e) => setReturnHome(e.target.checked)}
        />
        Return to start at the end of the day
      </label>

      <button
        className="primary full"
        onClick={handleOptimize}
        disabled={busy || mapped.length === 0}
      >
        {busy ? 'Optimizing…' : `Optimize route (${mapped.length} stop${mapped.length === 1 ? '' : 's'})`}
      </button>

      {mapped.length === 0 && (
        <p className="hint">Add patients with addresses and locate them on the map first.</p>
      )}
      {error && <p className="error">{error}</p>}

      {route && (
        <div className="route-result">
          <div className="route-summary">
            <span><strong>{formatDuration(route.totalDurationSec)}</strong> driving</span>
            <span>{formatMiles(route.totalDistanceMeters)}</span>
          </div>

          <ol className="route-stops">
            <li className="start-stop">
              <span className="badge start">S</span>
              <span className="stop-name">Start — {route.start.address}</span>
            </li>
            {route.orderedStops.map((s, i) => (
              <li key={s.id}>
                <span className="badge">{i + 1}</span>
                <span className="stop-name">{s.name}</span>
                <span className="leg-time">{formatDuration(route.legs[i]?.durationSec)} drive</span>
              </li>
            ))}
            {route.returnHome && (
              <li className="start-stop">
                <span className="badge start">S</span>
                <span className="stop-name">Back to start</span>
                <span className="leg-time">
                  {formatDuration(route.legs[route.orderedStops.length]?.durationSec)} drive
                </span>
              </li>
            )}
          </ol>

          <div className="route-actions">
            <a
              className="button primary"
              href={googleMapsDirectionsUrl(route.start, route.orderedStops, route.returnHome)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Google Maps
            </a>
            <button onClick={clearRoute}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
