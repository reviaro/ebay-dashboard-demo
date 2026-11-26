'use client';

import { storeFetch } from '@/lib/stores/browser';

import { useState, useEffect, useCallback } from 'react';
import { Search, Package } from 'lucide-react';
import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_DATE } from '@/lib/demo/config';

type InventoryItem = {
  id: number;
  itemId: string | null;
  sku: string | null;
  title: string;
  brand: string;
  price: number;
  quantity: number;
  views: number;
  watchers: number;
  condition: string | null;
  location: string | null;
  key: string;
  source: 'api' | 'csv';
  /** active | sold | ended from the report; unknown for CSV-only rows. */
  status: string;
  lastSeenAt: string | null;
};

type Stats = {
  _sum: { quantity: number | null };
  _count: { _all: number };
  _avg: { price: number | null };
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
  page: number;
  stats: Stats;
  listingStatus: ListingStatus;
};

function fmt(n: number | null | undefined) {
  return `$${(n ?? 0).toFixed(2)}`;
}

const STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'sold', label: 'Sold' },
  { value: 'ended', label: 'Ended' },
  { value: 'all', label: 'All' },
] as const;

export default function InventoryPage() {
  const demo = useDemoMode();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await storeFetch(`/api/inventory?${params}`);
      const json = await res.json() as ApiResponse;
      setData(json);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => { void fetchItems(); }, [fetchItems]);

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="flex items-center gap-3 mb-6">
        <Package size={22} className="text-indigo-400" />
        <div>
          <h1 className="text-xl font-semibold text-white">Active Listings</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {data?.total ?? 0} shown — {demo ? 'synthetic listing snapshot' : 'eBay report and CSV listing history'}
          </p>
          {data && (
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="text-emerald-400">{data.listingStatus.active} active</span>
              {' · '}{data.listingStatus.sold} sold
              {' · '}{data.listingStatus.ended} ended
              {data.listingStatus.unknown > 0 && (
                <span title={demo ? "Synthetic listing with unconfirmed status" : "In a CSV upload, but not in the latest eBay report"}>
                  {' · '}{data.listingStatus.unknown} unconfirmed
                </span>
              )}
              <span className="block mt-0.5 text-slate-600">
                {demo ? `Fictional status history as of ${DEMO_DATE}; only active listings count as sample stock.` : 'Sold and ended listings come from past CSV uploads; only active ones are current stock.'}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Active Listings', value: String(data?.listingStatus.active ?? 0), accent: 'text-white' },
          { label: 'Active Qty', value: String(data?.listingStatus.activeQuantity ?? 0), accent: 'text-indigo-400' },
          { label: 'Avg Price', value: fmt(data?.stats._avg.price), accent: 'text-emerald-400' },
        ].map((card) => (
          <div key={card.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 mb-1">{card.label}</p>
            <p className={`text-xl font-bold ${card.accent}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input type="text" placeholder="Search title, brand, SKU…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                {['Item ID', 'Title', 'Brand', 'Price', 'Qty', 'Watchers', 'Views', 'Condition', 'Location', 'Status'].map((h) => (
                  <th key={h} className="text-left px-3 py-3 text-xs font-medium text-slate-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="text-center py-12 text-slate-500">Loading…</td></tr>
              ) : data?.items.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-slate-500">{demo ? 'No sample listings match these filters. Try another status or search.' : <>No listings found. Sync from eBay in Settings, or upload an Active Listings CSV from Data Intake.</>}</td></tr>
              ) : (
                data?.items.map((item) => (
                  <tr key={item.key} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{item.itemId ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-300 max-w-xs truncate">{item.title}</td>
                    <td className="px-3 py-2.5 text-slate-400">{item.brand}</td>
                    <td className="px-3 py-2.5 text-white">{fmt(item.price)}</td>
                    <td className="px-3 py-2.5 text-slate-300">{item.quantity}</td>
                    <td className="px-3 py-2.5">
                      {item.watchers > 0 ? (
                        <span className="text-amber-400 font-medium">{item.watchers}</span>
                      ) : <span className="text-slate-600">0</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">{item.views}</td>
                    <td className="px-3 py-2.5 text-slate-400">{item.condition ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs">{item.location ?? '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          item.status === 'active'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : item.status === 'sold'
                              ? 'bg-sky-500/20 text-sky-300'
                              : item.status === 'ended'
                                ? 'bg-slate-600/40 text-slate-400'
                                : 'bg-amber-500/20 text-amber-300'
                        }`}
                        title={
                          demo ? `Fictional listing status as of ${DEMO_DATE}` : item.status === 'unknown'
                            ? 'From a CSV upload; the latest eBay report does not list it'
                            : item.status === 'ended'
                              ? 'No longer listed on eBay, and no sale recorded for it'
                              : `From the eBay report${item.lastSeenAt ? `, last seen ${new Date(item.lastSeenAt).toLocaleDateString()}` : ''}`
                        }
                      >
                        {item.status === 'unknown' ? 'unconfirmed' : item.status === 'ended' ? 'not listed' : item.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
            <p className="text-xs text-slate-500">Page {page} of {totalPages} ({data?.total ?? 0} items)</p>
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
