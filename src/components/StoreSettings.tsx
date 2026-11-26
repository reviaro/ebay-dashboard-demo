'use client';
import { useEffect, useState } from 'react';
import { useStore } from './StoreProvider';
import { storeJson } from '@/lib/stores/browser';

type Member = { id: string; username: string; role: string; isOwner: boolean; disabledAt: string | null };
type Agent = { id: string; name: string; canEditTasks: boolean; revokedAt: string | null };
const input = 'w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm';
const button = 'rounded-lg bg-blue-600 px-3 py-2 text-sm disabled:opacity-50';
const roles = ['viewer', 'editor', 'publisher', 'admin'];

export default function StoreSettings() {
  const state = useStore()!;
  const [name, setName] = useState(state.store.name);
  const [template, setTemplate] = useState(state.store.descriptionTemplate);
  const [write, setWrite] = useState(state.store.writeEnabled);
  const [newStore, setNewStore] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('viewer');
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<Member[]>([]);
  const [keys, setKeys] = useState<Agent[]>([]);
  const [keyName, setKeyName] = useState('');
  const [taskEdit, setTaskEdit] = useState(false);
  const [message, setMessage] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [m, k] = await Promise.all([storeJson<{ members: Member[] }>('/api/stores/members'), storeJson<{ keys: Agent[] }>('/api/stores/agent-keys')]);
    setMembers(m.members); setKeys(k.keys);
    if (state.isOwner) setUsers((await storeJson<{ users: Member[] }>('/api/users')).users);
  }
  useEffect(() => { if (state.store.role === 'admin') void refresh().catch(e => setMessage(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (state.store.role !== 'admin') return <p className="mb-5 text-sm text-slate-400">Store administrators manage connections and permissions. Your role: {state.store.role}.</p>;

  async function act(path: string, method: string, body?: unknown) {
    setBusy(true); setMessage(''); setSecret('');
    try {
      const result = await storeJson<{ token?: string; setupPath?: string; store?: { id: string } }>(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (result.setupPath) setSecret(new URL(result.setupPath, window.location.origin).href);
      if (result.token) setSecret(result.token);
      if (path === '/api/stores') {
        const url = new URL(window.location.href);
        url.searchParams.set('store', result.store!.id);
        window.location.assign(url.href);
      } else { await refresh(); setMessage('Saved.'); }
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-5 space-y-5">
    <h2 className="font-semibold">Store and access</h2>
    <label className="block text-sm">Store name<input className={input} value={name} onChange={e => setName(e.target.value)} maxLength={100} /></label>
    <label className="block text-sm">Description template (plain text)<textarea className={input} rows={4} value={template} onChange={e => setTemplate(e.target.value)} maxLength={20000} /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={write} onChange={e => setWrite(e.target.checked)} />Allow publishers to create and revise listings for {state.store.name}</label>
    <p className="text-xs text-slate-400">Keep this off for a store that only needs reporting. Enabling it does not publish anything.</p>
    <button className={button} disabled={busy} onClick={() => act('/api/stores', 'PATCH', { name, descriptionTemplate: template, writeEnabled: write })}>Save store settings</button>
    <div className="border-t border-slate-700 pt-4 space-y-3">
      <h3 className="font-medium">People with access</h3>
      <p className="text-xs text-slate-400">Viewers read reports. Editors manage data and drafts. Publishers also publish listings. Administrators manage connections and access.</p>
      {members.map(member => <div key={member.id} className="flex items-center justify-between gap-3 text-sm"><span>{member.username}{member.disabledAt ? ' (disabled)' : ''}</span><select aria-label={`Role for ${member.username}`} className="bg-slate-900 rounded p-2" value={member.role} disabled={busy || member.isOwner} onChange={e => act('/api/stores/members', 'PATCH', { userId: member.id, role: e.target.value })}>{[...roles, 'remove'].map(r => <option key={r}>{r}</option>)}</select></div>)}
      <div className="flex flex-wrap gap-2"><input aria-label="New or existing username" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} className={input} /><select aria-label="New member role" className="bg-slate-900 rounded p-2" value={role} onChange={e => setRole(e.target.value)}>{roles.map(r => <option key={r}>{r}</option>)}</select><button className={button} disabled={busy || !username} onClick={() => act('/api/stores/members', 'POST', { username, role })}>Add person</button></div>
      <p className="text-xs text-slate-400">New users receive a one-use setup link, valid for 24 hours. Share it privately.</p>
    </div>
    {state.isOwner && <details className="border-t border-slate-700 pt-4"><summary className="cursor-pointer">Owner: users and new stores</summary><div className="space-y-3 mt-3">
      <input aria-label="New store name" placeholder="Second store name" className={input} value={newStore} onChange={e => setNewStore(e.target.value)} /><button className={button} disabled={busy || !newStore.trim()} onClick={() => act('/api/stores', 'POST', { name: newStore })}>Add store</button>
      {users.filter(u => !u.isOwner).map(user => <div key={user.id} className="flex flex-wrap gap-3 text-sm items-center"><span>{user.username}</span><button className="text-blue-300" disabled={busy} onClick={() => act('/api/users', 'PATCH', { userId: user.id, action: 'reset-password' })}>Reset password</button><button className="text-amber-300" disabled={busy} onClick={() => act('/api/users', 'PATCH', { userId: user.id, action: user.disabledAt ? 'enable' : 'disable' })}>{user.disabledAt ? 'Enable' : 'Disable'}</button></div>)}
    </div></details>}
    <details className="border-t border-slate-700 pt-4"><summary className="cursor-pointer">Agent API keys</summary><div className="mt-3 space-y-3 text-sm">
      <p className="text-slate-400">Keys only access this store. Include <code>?store={state.store.id}</code> in agent requests.</p>
      {keys.map(k => <div key={k.id} className="flex gap-3"><span>{k.name} · {k.revokedAt ? 'revoked' : k.canEditTasks ? 'reports and tasks' : 'reports'}</span>{!k.revokedAt && <button disabled={busy} className="text-red-300" onClick={() => act(`/api/stores/agent-keys?id=${k.id}`, 'DELETE')}>Revoke</button>}</div>)}
      <input aria-label="Agent key name" className={input} placeholder="Key name" value={keyName} onChange={e => setKeyName(e.target.value)} /><label className="block"><input type="checkbox" checked={taskEdit} onChange={e => setTaskEdit(e.target.checked)} /> Allow task edits</label><button className={button} disabled={busy || !keyName} onClick={() => act('/api/stores/agent-keys', 'POST', { name: keyName, canEditTasks: taskEdit })}>Create key</button>
    </div></details>
    {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
    {secret && <div className="rounded-lg border border-blue-700 p-3"><p className="text-sm mb-2">Copy this now; it is only shown once.</p><textarea aria-label="One-time credential" readOnly value={secret} className={input} rows={3} /></div>}
  </section>;
}
