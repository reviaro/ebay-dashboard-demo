'use client';
import { useState } from 'react';
export default function JoinPage() {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
      const response = await fetch('/api/auth/accept-invitation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.history.replaceState(null, '', '/join');
      setPassword(''); setDone(true); setMessage(`Account ready. Your username is ${data.username}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to set password.'); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 bg-slate-950 flex items-center justify-center p-6"><form className="w-full max-w-sm space-y-4" onSubmit={submit}>
    <h1 className="text-xl text-white font-semibold">Set up your account</h1>
    {!done && <><label className="block text-sm text-slate-300" htmlFor="new-password">New password</label><input id="new-password" autoComplete="new-password" type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white" /><button disabled={busy} className="px-4 py-2 bg-blue-600 rounded-lg text-white">{busy ? 'Saving…' : 'Set password'}</button></>}
    {message && <p role="status" className="text-sm text-slate-300">{message}</p>}
    {done && <a href="/login" className="block text-blue-400">Sign in</a>}
  </form></div>;
}
