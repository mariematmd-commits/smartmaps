import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate } from '../format.js';

// Shows how many patients are due each upcoming week vs. capacity, with a
// one-click "Level the load" to smooth overloaded weeks.
export default function WorkloadView({ onChanged }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [projected, setProjected] = useState(false);

  async function load() {
    try {
      setData(await api.getWorkload(10, projected));
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    load();
  }, [projected]); // eslint-disable-line react-hooks/exhaustive-deps

  async function level() {
    if (
      !window.confirm(
        'Balance the weeks by moving patients out of over-full weeks into earlier, lighter weeks? (They’ll be seen a bit early — never late.)'
      )
    )
      return;
    setBusy(true);
    setMsg('');
    try {
      const r = await api.levelLoad();
      setMsg(r.moved ? `Moved ${r.moved} patient${r.moved === 1 ? '' : 's'} earlier.` : 'Already balanced — nothing to move.');
      await load();
      onChanged?.();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  const anyOver = data.weeks.some((w) => w.over > 0);

  return (
    <div className="card workload">
      <button className="workload-head" onClick={() => setOpen((o) => !o)}>
        <span>📊 Workload — next {data.weeks.length} weeks</span>
        <span className="chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="workload-body">
          <div className="workload-controls">
            <span className="workload-cap">Capacity ≈ {data.capacity} / week</span>
            <label className="proj-toggle">
              <input
                type="checkbox"
                checked={projected}
                onChange={(e) => setProjected(e.target.checked)}
              />
              Projected (assume the cycle repeats)
            </label>
          </div>
          <ul className="workload-bars">
            {data.weeks.map((w) => {
              const pct = Math.min(100, Math.round((w.count / data.capacity) * 100));
              const over = w.over > 0;
              return (
                <li key={w.weekStart}>
                  <span className="wl-label">{formatDate(w.weekStart)}</span>
                  <span className="wl-bar">
                    <span className={`wl-fill ${over ? 'over' : ''}`} style={{ width: `${over ? 100 : pct}%` }} />
                  </span>
                  <span className={`wl-count ${over ? 'over' : ''}`}>
                    {w.count}{over ? ` (+${w.over})` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
          {data.laterCount > 0 && (
            <p className="hint">+ {data.laterCount} more due beyond these weeks.</p>
          )}
          <div className="actions">
            <button className="seg" onClick={level} disabled={busy}>
              {busy ? 'Leveling…' : 'Level the load'}
            </button>
            {msg ? (
              <span className="save-msg">{msg}</span>
            ) : anyOver ? (
              <span className="field-hint">Some weeks are over capacity — leveling pulls patients earlier.</span>
            ) : (
              <span className="field-hint">All weeks within capacity 👍</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
