'use client';

import { storeFetch } from '@/lib/stores/browser';

import { useState, useEffect, useCallback } from 'react';
import { Search, BarChart2 } from 'lucide-react';
import { useDemoMode } from '@/components/DemoProvider';

type InventoryItem = {
  key: string;
  sku: string | null;
  itemId: string | null;
  title: string;
  brand: string;
  condition: string | null;
  price: number;
  quantity: number;
  watchers: number;
  views: number;
  status: string;
};

type ListingStatus = {
  active: number;
  activeQuantity: number;
  activeValue: number;
  sold: number;
  ended: number;
  unknown: number;
};

type ApiResponse = {
  items: InventoryItem[];
  total: number;
  stats: {
    _avg: { price: number | null };
    _count: { _all: number };
    _sum: { quantity: number | null };
  };
  listingStatus: ListingStatus;
};

function fmt(n: number | null | undefined) {
  return `$${(n ?? 0).toFixed(2)}`;
}

const SORT_OPTIONS = [
  { value: 'price_desc', label: 'Price: High → Low' },
  { value: 'price_asc', label: 'Price: Low → High' },
  { value: 'watchers_desc', label: 'Most Watchers' },
  { value: 'views_desc', label: 'Most Views' },
];

const STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'sold', label: 'Sold' },
  { value: 'ended', label: 'Ended' },
  { value: 'all', label: 'All' },
] as const;

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'active' ? 'bg-emerald-500/20 text-emerald-300'
      : status === 'sold' ? 'bg-sky-500/20 text-sky-300'
        : status === 'ended' ? 'bg-slate-600/40 text-slate-400'
          : 'bg-amber-500/20 text-amber-300';
  const label = status === 'unknown' ? 'unconfirmed' : status === 'ended' ? 'not listed' : status;
  return <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>{label}</span>;
}

export default function PriceComparePage() {
  const demo = useDemoMode();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('watchers_desc');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await storeFetch(`/api/inventory?${params}`);
      if (!res.ok) throw new Error('Could not load listings');
      const json = await res.json() as ApiResponse;

      // Client-side sort
      if (json.items) {
        json.items.sort((a, b) => {
          if (sort === 'price_desc') return b.price - a.price;
          if (sort === 'price_asc') return a.price - b.price;
          if (sort === 'watchers_desc') return b.watchers - a.watchers;
          if (sort === 'views_desc') return b.views - a.views;
          return 0;
        });
      }

      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load listings');
    } finally {
      setLoading(false);
    }
  }, [page, search, sort, statusFilter]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const items = data?.items ?? [];
  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <BarChart2 size={22} className="text-blue-400" />
        <div>
          <h1 className="text-xl font-semibold text-white">Listing Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {demo ? 'Synthetic listings and status history.' : 'Live eBay listings and CSV listing history.'} Only <span className="text-emerald-400">active</span> listings are {demo ? 'sample stock' : 'current stock'}.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 mb-1">Active Listings</p>
          <p className="text-xl font-bold text-white">{data?.listingStatus.active ?? 0}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 mb-1">Avg Price{statusFilter !== 'all' ? '' : ' (all)'}</p>
          <p className="text-xl font-bold text-blue-400">{fmt(data?.stats._avg.price)}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 mb-1">Sold</p>
          <p className="text-xl font-bold text-sky-300">{data?.listingStatus.sold ?? 0}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 mb-1">Ended</p>
          <p className="text-xl font-bold text-slate-400">{data?.listingStatus.ended ?? 0}</p>
        </div>
      </div>

      {/* Status filter + search + sort */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => {
            const count =
              f.value === 'active' ? data?.listingStatus.active
                : f.value === 'sold' ? data?.listingStatus.sold
                  : f.value === 'ended' ? data?.listingStatus.ended
                    : undefined;
            return (
              <button
                key={f.value}
                onClick={() => { setStatusFilter(f.value); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer border ${
                  statusFilter === f.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                {f.label}{count !== undefined ? ` (${count})` : ''}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              aria-label="Search listings"
              type="text"
              placeholder="Search SKU, title, or brand…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <select
            aria-label="Sort listings"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                {['SKU', 'Title', 'Brand', 'Condition', 'Price', 'Qty', 'Watchers', 'Views', 'Status'].map((h) => (
                  <th key={h} className="text-left px-3 py-3 text-xs font-medium text-slate-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-500">Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={9} className="text-center py-12 text-red-400">{error} <button onClick={() => void fetchItems()} className="underline ml-1">Try again</button></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-500">No listings found.</td></tr>
              ) : (
                items.map((item) => (
                  <tr key={item.key} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{item.sku ?? item.itemId ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-200 max-w-xs truncate">{item.title || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-400">{item.brand}</td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs">{item.condition ?? '—'}</td>
                    <td className="px-3 py-2.5 text-white font-semibold">{fmt(item.price)}</td>
                    <td className="px-3 py-2.5 text-slate-400">{item.quantity}</td>
                    <td className="px-3 py-2.5 text-amber-400">{item.watchers}</td>
                    <td className="px-3 py-2.5 text-slate-400">{item.views}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge status={item.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
            <p className="text-xs text-slate-500">Page {page} of {totalPages} ({data?.total ?? 0} listings)</p>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-40 cursor-pointer">Prev</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg disabled:opacity-40 cursor-pointer">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
