'use client';

import { useDemoMode } from './DemoProvider';
import { DEMO_STORE_NAME } from '@/lib/demo/config';

import { storeFetch } from '@/lib/stores/browser';

import { useStore } from './StoreProvider';
import { usePathname } from 'next/navigation';
import Link from '@/components/StoreLink';
import { useState } from 'react';
import { LayoutDashboard, TrendingUp, CheckSquare, MapPin, Upload, FolderOpen, Zap, Receipt, ShoppingBag, Package, BarChart2, Settings, Activity, BadgeDollarSign, Menu, X, LogOut } from 'lucide-react';
import useSWR from 'swr';

const sessionFetcher = (url: string) => storeFetch(url).then((r) => r.json());

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/market', label: 'Market Analysis', icon: TrendingUp },
  { href: '/expenses', label: 'Expenses', icon: Receipt },
  { href: '/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/traffic', label: 'Traffic', icon: Activity },
  { href: '/profitability', label: 'Profit & Ads', icon: BadgeDollarSign },
  { href: '/price-compare', label: 'Listing Overview', icon: BarChart2 },
  { href: '/upload', label: 'Data Intake', icon: Upload },
  { href: '/data', label: 'Data Library', icon: FolderOpen },
  { href: '/tasks', label: 'Task Matrix', icon: CheckSquare },
  { href: '/sourcing', label: 'Sourcing Map', icon: MapPin },
  { href: '/listings', label: 'Create Listings', icon: Package },
  { href: '/settings', label: 'Store Settings', icon: Settings },
];

export default function Sidebar() {
  const demo = useDemoMode();
  const pathname = usePathname();
  const state = useStore();
  const [open, setOpen] = useState(false);

  if (!state) return null;

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Open navigation" aria-expanded={open} className="fixed left-3 top-3 z-40 flex h-11 w-11 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-200 md:hidden"><Menu size={20} /></button>
      {open && <button aria-label="Close navigation overlay" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-slate-950/80 md:hidden" />}
      <aside className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-50 w-72 bg-slate-950 text-white flex-col border-r border-slate-800/80 flex-shrink-0 md:static md:flex md:w-56`}>
      {/* Brand */}
      <div className="px-4 py-5 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Zap size={15} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-100 leading-tight">eBay Dashboard</p>
            <p className="text-[10px] text-slate-500 leading-tight mt-0.5 font-mono">{state.store.name}</p>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close navigation" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 md:hidden"><X size={20} /></button>
        </div>
      </div>

      {!demo && <div className="p-3 border-b border-slate-800">
        <label htmlFor="store-switch" className="block text-xs text-slate-400 mb-2">Current store · {state.store.role}</label>
        <select id="store-switch" value={state.store.id} onChange={e => {
          const url = new URL(window.location.href);
          url.search = new URLSearchParams({ store: e.target.value }).toString();
          window.location.assign(url.href);
        }} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm">
          {state.stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
      </div>}
      {/* Nav */}
      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                isActive
                  ? 'bg-slate-800 text-slate-100 font-medium'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 font-normal'
              }`}
            >
              <Icon size={15} className={`flex-shrink-0 transition-colors duration-150 ${
                isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'
              }`} />
              {demo && item.href === '/listings' ? 'Listings' : item.label}
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
              )}
            </Link>
          );
        })}
      </nav>

      {demo ? <div className="px-4 py-4 border-t border-slate-800/80"><div className="flex items-center gap-2 text-xs text-slate-300"><span className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center font-semibold">N</span><div><p className="text-[11px]">{DEMO_STORE_NAME}</p><p className="text-[10px] text-slate-500 mt-0.5">Read-only sample store</p></div></div></div> : <SignOutButton />}

      </aside>
    </>
  );
}

/**
 * Only rendered once a session is confirmed.
 *
 * The root layout wraps every route including `/login`, so without this check
 * the sign-out control would appear on the sign-in screen.
 */
function SignOutButton() {
  const { data } = useSWR<{ authenticated: boolean }>(
    '/api/auth/session',
    sessionFetcher,
    { revalidateOnFocus: false }
  );
  const [busy, setBusy] = useState(false);

  if (!data?.authenticated) return null;

  async function signOut() {
    setBusy(true);
    try {
      await storeFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      // Full reload rather than router.push: Next's client router cache still
      // holds RSC payloads fetched while the session was live, and a soft
      // navigation would keep serving them after sign-out.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/login');
    }
  }

  return (
    <div className="px-2 py-3 border-t border-slate-800/80">
      <button
        onClick={signOut}
        disabled={busy}
        className="group flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition-all duration-150 disabled:opacity-50"
      >
        <LogOut size={15} className="flex-shrink-0 text-slate-500 group-hover:text-slate-300" />
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
