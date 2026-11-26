'use client';

import { useState } from 'react';
import { Loader2, Lock, ShieldAlert } from 'lucide-react';

/**
 * Sign-in screen.
 *
 * The `?next=` parameter is read from `window.location` at submit time rather
 * than with `useSearchParams`. That hook forces the component into a Suspense
 * boundary, and with it the whole form drops out of the server-rendered HTML --
 * leaving a blank page until hydration, and no form at all if scripts fail.
 * Reading it in the event handler keeps the markup fully server-rendered.
 *
 * The value is only ever echoed back by the server after `safeRedirectPath`
 * has rejected anything that is not a same-origin path.
 */
export default function LoginPage() {
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const next = new URLSearchParams(window.location.search).get('next');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, next }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error || `Sign in failed (${res.status})`);
        return;
      }

      setPassword('');
      // A full navigation rather than a client transition: the session cookie
      // was just set, and every RSC payload cached in this tab was fetched
      // while unauthenticated.
      window.location.assign(json.redirectTo || '/');
    } catch {
      setError('Could not reach the dashboard. Is it still running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    // Full-screen overlay: the root layout wraps every route in the sidebar,
    // and framing the sign-in screen with navigation the visitor cannot use
    // would be noise. Those links all bounce back here anyway.
    <div className="fixed inset-0 z-50 bg-slate-950 flex items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm">
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Lock size={16} className="text-blue-400" />
            <h1 className="text-sm font-semibold text-white">
              eBay Auto Parts Dashboard
            </h1>
          </div>
          <p className="text-xs text-slate-500 mb-5 leading-relaxed">
            This dashboard is private. Sign in to continue.
          </p>

          <label htmlFor="username" className="block text-xs text-slate-400 mb-1.5">Username</label>
          <input id="username" name="username" autoComplete="username" value={username}
            onChange={event => setUsername(event.target.value)} required
            className="w-full mb-4 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
          <label
            htmlFor="password"
            className="block text-xs text-slate-400 mb-1.5"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
            placeholder="••••••••••••"
          />

          {error && (
            <div
              role="alert"
              className="mt-4 flex gap-2 text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded-lg p-3"
            >
              <ShieldAlert size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || password.length === 0}
            className="mt-5 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
