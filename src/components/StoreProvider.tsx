'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SWRConfig } from 'swr';
import { fallbackStoreId } from '@/lib/stores/browser';
import { useDemoMode } from './DemoProvider';
import { DEMO_STORE } from '@/lib/demo/store';

const STORE_KEY = 'dashboard-store';

export type StoreSummary = { id: string; name: string; role: string; writeEnabled: boolean; descriptionTemplate: string; marketplaceId: string };
type StoreState = { stores: StoreSummary[]; store: StoreSummary; isOwner: boolean };
const StoreContext = createContext<StoreState | null>(null);
export const useStore = () => useContext(StoreContext);
const demoState: StoreState = { stores: [DEMO_STORE], store: DEMO_STORE, isOwner: false };

export default function StoreProvider({ children }: { children: React.ReactNode }) {
  const demo = useDemoMode();
  const pathname = usePathname();
  const publicPage = pathname === '/login' || pathname === '/join';
  const [loadedState, setState] = useState<StoreState | null>(null);
  const state = demo ? demoState : loadedState;
  const [error, setError] = useState('');
  const [cache] = useState(() => new Map());
  useEffect(() => {
    if (demo || publicPage) return;
    let cancelled = false;
    fetch('/api/stores', { cache: 'no-store' }).then(async response => {
      if (response.status === 401) { window.location.href = '/login'; return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Unable to load stores.');
      if (cancelled) return;
      const url = new URL(window.location.href);
      const selected = url.searchParams.get('store');
      const store = body.stores.find((s: StoreSummary) => s.id === selected);
      if (!selected && body.stores.length) {
        let remembered: string | null = null;
        try { remembered = sessionStorage.getItem(STORE_KEY); } catch { /* storage unavailable */ }
        url.searchParams.set('store', fallbackStoreId(body.stores.map((s: StoreSummary) => s.id), remembered)!);
        window.location.replace(url.href);
        return;
      }
      if (!store) throw new Error(selected ? 'You do not have access to this store.' : 'No stores are assigned to your user. Ask your administrator for access.');
      try { sessionStorage.setItem(STORE_KEY, store.id); } catch { /* storage unavailable */ }
      setState({ stores: body.stores, store, isOwner: body.isOwner });
    }).catch(e => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [demo, publicPage, pathname]);
  if (publicPage && !demo) return children;
  if (error) return <main className="p-8 text-slate-200"><p role="alert">{error}</p><Link className="underline" href="/">Choose an available store</Link><Link className="ml-6 underline" href="/login">Sign in</Link></main>;
  if (!state) return <p className="p-8 text-slate-400">Loading your stores…</p>;
  return <StoreContext.Provider value={state}><SWRConfig key={state.store.id} value={{ provider: () => cache }}>{children}</SWRConfig></StoreContext.Provider>;
}
