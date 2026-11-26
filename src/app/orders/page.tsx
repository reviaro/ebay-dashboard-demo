'use client';

import { storeFetch } from '@/lib/stores/browser';

import { useState, useEffect, useCallback } from 'react';
import { Calendar, Search, ShoppingBag } from 'lucide-react';
import { timeAgo } from '@/lib/relative-time';
import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_AS_OF, DEMO_DATE } from '@/lib/demo/config';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

type Sale = {
  /** Order number, or `sale:<id>` for the CSV rows that lack one. */
  key: string;
  /** Which source supplied this row's figures. */
  source: 'api' | 'csv';
  orderNumber: string | null;
  saleDate: string;
  itemTitle: string;
  brand: string;
  itemNumber: string | null;
  soldFor: number;
  shipping: number;
  eBayTax: number;
  totalPrice: number;
  shipToState: string | null;
  shipToCountry: string | null;
  promoted: boolean;
  quantity: number;
  lineItemCount: number;
  paymentStatus: string | null;
  refunded: boolean;
};

type Stats = {
  _sum: { soldFor: number | null; totalPrice: number | null; eBayTax: number | null; shipping: number | null };
  refundTotal?: number;
  ebayFees?: number;
  proceedsAfterFees?: number;
  _count: { _all: number };
};

type ChartItem = {
  saleDate: string;
  soldFor: number;
  eBayTax: number;
  shipping: number;
};

type SyncStatus = {
  orders: {
    state: 'never' | 'inferred' | 'ok' | 'stale' | 'failed' | 'running' | 'stalled';
    lastSyncedAt: string | null;
    inferred: boolean;
    message: string | null;
    orderCount: number;
  };
  csv: { lastUploadAt: string | null; filename: string | null };
};

type ApiResponse = {
  orders: Sale[];
  total: number;
  page: number;
  stats: Stats;
  chartItems: ChartItem[];
};

function fmt(n: number | null | undefined) {
  return `$${(n ?? 0).toFixed(2)}`;
}

/**
 * The list mixes two sources, so freshness is reported per source. A single
 * "synced N ago" over the whole table would imply the CSV rows are as current
 * as the API ones, which they are not.
 */
function SyncBanner({ status }: { status: SyncStatus | null }) {
  const demo = useDemoMode();
  if (demo) return <p className="text-xs mt-0.5 text-slate-500">Synthetic snapshot · {DEMO_DATE} (UTC)</p>;
  if (!status) return null;
  const { state, lastSyncedAt, message, inferred } = status.orders;

  const tone =
    state === 'failed' || state === 'stalled'
      ? 'text-rose-400'
      : state === 'stale'
        ? 'text-amber-400'
        : 'text-slate-500';

  const ebay = (() => {
    switch (state) {
      case 'never': return 'never synced from eBay';
      case 'running': return 'sync in progress…';
      case 'stalled': return 'a sync started but never finished';
      case 'failed': return `last sync failed${message ? `: ${message}` : ''}`;
      case 'inferred': return `eBay data as of ${timeAgo(lastSyncedAt)} (inferred — before sync logging)`;
      case 'stale': return inferred
        ? `eBay data as of ${timeAgo(lastSyncedAt)} — may be out of date (inferred)`
        : `eBay synced ${timeAgo(lastSyncedAt)} — may be out of date`;
      default: return `eBay synced ${timeAgo(lastSyncedAt)}`;
    }
  })();

  const csv = status.csv.lastUploadAt
    ? `CSV uploaded ${timeAgo(status.csv.lastUploadAt)}`
    : 'no CSV upload recorded';

  return (
    <p className={`text-xs mt-0.5 ${tone}`}>
      {ebay} · <span className="text-slate-500">{csv}</span>
    </p>
  );
}

export default function OrdersPage() {
  const demo = useDemoMode();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activePreset, setActivePreset] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    if (demo) return;
    storeFetch('/api/ebay/sync/status')
      .then(r => (r.ok ? r.json() : null))
      .then(setSyncStatus)
      .catch(() => setSyncStatus(null));
  }, [demo]);

  function applyPreset(preset: string) {
    const now = demo ? new Date(DEMO_AS_OF) : new Date();
    const from = new Date(now);
    if (demo) {
      if (preset === '1m') from.setUTCMonth(now.getUTCMonth() - 1);
      else if (preset === '3m') from.setUTCMonth(now.getUTCMonth() - 3);
      else if (preset === '1y') from.setUTCFullYear(now.getUTCFullYear() - 1);
    } else {
      if (preset === '1m') from.setMonth(now.getMonth() - 1);
      else if (preset === '3m') from.setMonth(now.getMonth() - 3);
      else if (preset === '1y') from.setFullYear(now.getFullYear() - 1);
    }
    setDateFrom(from.toISOString().split('T')[0]);
    setDateTo(now.toISOString().split('T')[0]);
    setActivePreset(preset);
    setShowCustom(false);
    setPage(1);
  }

  function clearDateFilter() {
    setDateFrom('');
    setDateTo('');
    setActivePreset('');
    setShowCustom(false);
    setPage(1);
  }

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await storeFetch(`/api/orders?${params}`);
      const json = await res.json() as ApiResponse;
      setData(json);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, search, dateFrom, dateTo]);

  useEffect(() => { void fetchOrders(); }, [fetchOrders]);

  // Monthly chart from all matching records (not just current page)
  const chartData = (() => {
    if (!data?.chartItems.length) return [];
    const monthly: Record<string, { month: string; revenue: number; tax: number; shipping: number }> = {};
    for (const o of data.chartItems) {
      const key = o.saleDate.substring(0, 7);
      if (!monthly[key]) monthly[key] = { month: key, revenue: 0, tax: 0, shipping: 0 };
      monthly[key].revenue += o.soldFor;
      monthly[key].tax += o.eBayTax;
      monthly[key].shipping += o.shipping;
    }
    return Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
  })();

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="flex items-center gap-3 mb-6">
        <ShoppingBag size={22} className="text-blue-400" />
        <div>
          <h1 className="text-xl font-semibold text-white">Orders &amp; Sales</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {data?.stats._count._all ?? 0} orders — {demo ? 'fictional store history' : 'eBay API and CSV history combined'}
          </p>
          <SyncBanner status={syncStatus} />
        </div>
      </div>

      {/* Date range filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Calendar size={14} className="text-slate-500" />
        <span className="text-xs text-slate-500">Range:</span>
        {(['1m', '3m', '1y'] as const).map((preset) => {
          const labels: Record<string, string> = { '1m': 'Last Month', '3m': 'Last 3 Months', '1y': 'Last Year' };
          return (
            <button key={preset} onClick={() => applyPreset(preset)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${activePreset === preset ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'}`}>
              {labels[preset]}
            </button>
          );
        })}
        <button onClick={() => { setShowCustom((v) => !v); setActivePreset('custom'); }}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${activePreset === 'custom' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'}`}>
          Custom
        </button>
        {(activePreset || dateFrom || dateTo) && (
          <button onClick={clearDateFilter} className="px-3 py-1 rounded-full text-xs text-slate-500 hover:text-white transition-colors cursor-pointer">Clear</button>
        )}
        {showCustom && (
          <div className="flex flex-wrap md:flex-nowrap items-center gap-2 mt-2 w-full">
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
            <span className="text-slate-500 text-xs">to</span>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500" />
          </div>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Revenue', value: fmt(data?.stats._sum.soldFor), accent: 'text-white' },
          { label: 'eBay Fees', value: fmt(-(data?.stats.ebayFees ?? 0)), accent: 'text-rose-400' },
          { label: 'Proceeds After Fees', value: fmt(data?.stats.proceedsAfterFees ?? 0), accent: 'text-white' },
          { label: 'Refunds', value: fmt(-(data?.stats.refundTotal ?? 0)), accent: 'text-rose-400' },
          { label: 'Net Revenue', value: fmt((data?.stats._sum.soldFor ?? 0) - (data?.stats.refundTotal ?? 0)), accent: 'text-emerald-400' },
          { label: 'Tax Collected', value: fmt(data?.stats._sum.eBayTax), accent: 'text-yellow-400' },
          { label: 'Shipping', value: fmt(data?.stats._sum.shipping), accent: 'text-blue-400' },
          { label: 'Total Billed', value: fmt(data?.stats._sum.totalPrice), accent: 'text-emerald-400' },
        ].map((card) => (
          <div key={card.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-400 mb-1">{card.label}</p>
            <p className={`text-xl font-bold ${card.accent}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 mb-6">
          <h2 className="text-sm font-medium text-slate-300 mb-4">Monthly Sales Breakdown</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#e2e8f0' }} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[2, 2, 0, 0]} />
              <Bar dataKey="tax" name="Tax" fill="#64748b" radius={[2, 2, 0, 0]} />
              <Bar dataKey="shipping" name="Shipping" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input type="text" placeholder="Search title, brand, order number…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                {['Date', 'Item', 'Brand', 'Sold For', 'Shipping', 'Tax', 'Total', 'Qty', 'Ship To', 'Promoted', 'Source'].map((h) => (
                  <th key={h} className="text-left px-3 py-3 text-xs font-medium text-slate-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="text-center py-12 text-slate-500">Loading…</td></tr>
              ) : data?.orders.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-12 text-slate-500">{demo ? 'No sample orders match these filters. Try another date range or search.' : <>No orders found. Sync from eBay in Settings, or upload a Paid &amp; Shipped CSV from Data Intake.</>}</td></tr>
              ) : (
                data?.orders.map((o) => (
                  <tr key={o.key} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                    <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{new Date(o.saleDate).toLocaleDateString(demo ? 'en-US' : undefined, demo ? { timeZone: 'UTC' } : undefined)}</td>
                    <td className="px-3 py-2.5 text-slate-300 max-w-xs truncate">{o.itemTitle}</td>
                    <td className="px-3 py-2.5 text-slate-400">{o.brand}</td>
                    <td className="px-3 py-2.5 text-white font-medium">{fmt(o.soldFor)}</td>
                    <td className="px-3 py-2.5 text-slate-400">{fmt(o.shipping)}</td>
                    <td className="px-3 py-2.5 text-yellow-400">{fmt(o.eBayTax)}</td>
                    <td className="px-3 py-2.5 text-emerald-400 font-medium">{fmt(o.totalPrice)}</td>
                    <td className="px-3 py-2.5 text-slate-400">{o.quantity}</td>
                    <td className="px-3 py-2.5 text-slate-400">{o.shipToState ?? o.shipToCountry ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      {o.promoted && <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-400">Ad</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          o.source === 'api'
                            ? 'bg-sky-500/20 text-sky-300'
                            : 'bg-slate-600/40 text-slate-400'
                        }`}
                        title={demo ? 'Fictional record in the read-only demo' : o.source === 'api' ? 'Synced from the eBay API' : 'From a CSV export'}
                      >
                        {demo ? 'Sample' : o.source === 'api' ? 'eBay' : 'CSV'}
                      </span>
                      {o.refunded && (
                        <span
                          className="ml-1 px-2 py-0.5 rounded-full text-xs bg-rose-500/20 text-rose-300"
                          title={o.paymentStatus ?? undefined}
                        >
                          {o.paymentStatus === 'PARTIALLY_REFUNDED' ? 'Part. refund' : 'Refunded'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700">
            <p className="text-xs text-slate-500">Page {page} of {totalPages} ({data?.total ?? 0} orders)</p>
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
