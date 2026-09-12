import { useState } from 'react';
import { api } from '../api.js';

// Shown only when this computer has passcode protection turned on (Settings →
// Passcode protection). Without a passcode the app opens straight up and this
// screen never appears.
export default function LockScreen({ onUnlocked }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!pass) return setError('Enter your passcode.');
    setBusy(true);
    try {
      await api.unlock(pass);
      onUnlocked();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (
      !window.confirm(
        'Forgotten passcodes cannot be recovered — the encrypted data on this computer will be permanently erased so you can start over. Continue?'
      )
    )
      return;
    await api.clearAll();
    await api.init(); // fresh, unprotected vault
    onUnlocked();
  }

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={submit}>
        <h1>SmartMaps</h1>
        <p className="lock-sub">Enter your passcode to unlock your data on this computer.</p>

        <label>
          Passcode
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoFocus
            autoComplete="off"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="primary full" disabled={busy}>
          {busy ? 'Please wait…' : 'Unlock'}
        </button>

        <button type="button" className="lock-link" onClick={forgot}>
          Forgot passcode? Erase and start over
        </button>
      </form>
    </div>
  );
}
