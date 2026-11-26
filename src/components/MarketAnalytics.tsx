'use client';

import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Cell, Area, Line
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { useDemoMode } from '@/components/DemoProvider';

interface MonthlySale {
  label: string;
  orders: number;
  items: number;
  revenue: number;
  avgOrderValue: number;
}

interface BestSeller {
  itemTitle: string;
  brand: string;
  revenue: number;
  orders: number;
  avgPrice: number;
}

interface MarketAnalyticsProps {
  data: {
    profitPerBrand: Array<{ brand: string; grossRevenue: number; ebayFees: number; refunds: number; netRevenue: number; units: number }>;
    seasonalTrends: Array<{ month: string; revenue: number; volume: number }>;
    monthlySales?: MonthlySale[];
    bestSellers?: BestSeller[];
    inventoryByBrand?: Array<{ brand: string; count: number; totalValue: number; avgPrice: number }>;
    topWatchedItems?: Array<{ title: string; price: number; views: number; watchers: number; brand: string }>;
  };
}

const CHART_BLUE = '#2563EB';
const COLORS = new Array(20).fill(CHART_BLUE);

export default function MarketAnalytics({ data }: MarketAnalyticsProps) {
  const demo = useDemoMode();
  const [view, setView] = useState<'monthly' | 'profit' | 'trends' | 'bestsellers' | 'inventory'>('monthly');
  const hasInventory = (data.inventoryByBrand?.length || 0) > 0;
  const hasMonthlySales = (data.monthlySales?.length || 0) > 0;
  const hasBestSellers = (data.bestSellers?.length || 0) > 0;
  const hasSalesData = data.profitPerBrand?.length > 0 || hasMonthlySales;

  if (!hasSalesData && !hasInventory) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3 border-2 border-dashed border-slate-700/60 rounded-xl m-2 py-12">
        <TrendingUp size={24} className="text-slate-600" />
        <div>
          <p className="text-sm font-semibold text-slate-400">No sales data yet</p>
          <p className="text-xs text-slate-600 max-w-xs mx-auto mt-1">Upload your eBay Paid &amp; Shipped CSV to see monthly revenue, best sellers, and brand performance.</p>
        </div>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs">
        <p className="text-slate-300 font-medium mb-1">{label}</p>
        {payload.map((p: any, i: number) => (
          <p key={i} style={{ color: p.color || p.fill }}>
            {p.name}: {p.name.toLowerCase().includes('revenue') || p.name.toLowerCase().includes('aov') ? `$${Number(p.value).toFixed(0)}` : p.value}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 p-1 bg-slate-900/60 rounded-lg border border-slate-700 mb-6">
        {hasMonthlySales && (
          <button
            onClick={() => setView('monthly')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
              view === 'monthly' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            }`}
          >
            Monthly Revenue
          </button>
        )}
        <button
          onClick={() => setView('profit')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
            view === 'profit' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
          }`}
        >
          By Brand
        </button>
        <button
          onClick={() => setView('trends')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
            view === 'trends' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
          }`}
        >
          Trends
        </button>
        {hasBestSellers && (
          <button
            onClick={() => setView('bestsellers')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
              view === 'bestsellers' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            }`}
          >
            Best Sellers
          </button>
        )}
        {hasInventory && (
          <button
            onClick={() => setView('inventory')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
              view === 'inventory' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            }`}
          >
            Active Inventory
          </button>
        )}
      </div>

      <div className="w-full" style={{ minHeight: 300 }}>

        {/* Monthly Revenue Chart */}
        {view === 'monthly' && hasMonthlySales && (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data.monthlySales} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <defs>
                <linearGradient id="colorMonthRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                angle={-30}
                textAnchor="end"
                height={45}
              />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#3B82F6" strokeWidth={2} fillOpacity={1} fill="url(#colorMonthRev)" />
              <Line type="monotone" dataKey="avgOrderValue" name="AOV" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3, fill: '#F59E0B' }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {/* Net revenue by brand */}
        {view === 'profit' && (
          <ResponsiveContainer width="100%" height={Math.max(300, data.profitPerBrand.length * 40)}>
            <BarChart data={data.profitPerBrand} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#334155" />
              <XAxis type="number" hide />
              <YAxis dataKey="brand" type="category" interval={demo ? 0 : undefined} axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 500, fill: '#94a3b8' }} width={demo ? 112 : 100} />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: '1px solid #334155', background: '#1E293B', color: '#F1F5F9' }}
                formatter={(value: number) => [`$${value.toFixed(0)}`, 'Net revenue']}
              />
              <Bar dataKey="netRevenue" name="Net revenue" radius={[0, 4, 4, 0]} barSize={16}>
                {data.profitPerBrand.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* Seasonal Trends */}
        {view === 'trends' && (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data.seasonalTrends} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #334155', background: '#1E293B', color: '#F1F5F9' }} />
              <Area type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" name="Revenue" />
              <Line type="monotone" dataKey="volume" stroke="#10B981" strokeWidth={2} dot={{ r: 3, fill: '#10B981' }} name="Orders" />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {/* Best Sellers */}
        {view === 'bestsellers' && hasBestSellers && (
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
            {data.bestSellers!.map((item, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-slate-700/50 rounded-lg border border-slate-600/50">
                <div className="w-5 h-5 flex items-center justify-center rounded bg-slate-600 text-slate-300 text-[10px] font-bold flex-shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-200 font-medium leading-snug truncate" title={item.itemTitle}>{item.itemTitle}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{item.brand} · {item.orders} sold · avg ${item.avgPrice.toFixed(0)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-semibold text-emerald-400">${item.revenue.toFixed(0)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Active Inventory */}
        {view === 'inventory' && hasInventory && (
          <ResponsiveContainer width="100%" height={Math.max(300, (data.inventoryByBrand?.length || 1) * 40)}>
            <BarChart data={data.inventoryByBrand} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#334155" />
              <XAxis type="number" hide />
              <YAxis dataKey="brand" type="category" interval={demo ? 0 : undefined} axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 500, fill: '#94a3b8' }} width={demo ? 112 : 100} />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: '1px solid #334155', background: '#1E293B', color: '#F1F5F9' }}
                formatter={(value: number, name: string) => [
                  name === 'count' ? `${value} listings` : `$${value.toFixed(0)}`,
                  name === 'count' ? 'Active Listings' : 'Total Value'
                ]}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16} name="count">
                {(data.inventoryByBrand || []).map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Summary stats below chart */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        {view === 'monthly' && hasMonthlySales && (() => {
          const peak = data.monthlySales!.reduce((p, c) => c.revenue > p.revenue ? c : p);
          const total = data.monthlySales!.reduce((s, m) => s + m.revenue, 0);
          const avgMonthly = total / data.monthlySales!.length;
          return (
            <>
              <div className="p-3 bg-slate-700 rounded-lg border border-slate-600">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Peak Month</p>
                <p className="text-sm font-semibold text-slate-100 mt-0.5">{peak.label} — ${peak.revenue.toFixed(0)}</p>
              </div>
              <div className="p-3 bg-slate-700 rounded-lg border border-slate-600">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Avg Monthly</p>
                <p className="text-sm font-semibold text-slate-100 mt-0.5">${avgMonthly.toFixed(0)}</p>
              </div>
            </>
          );
        })()}

        {view === 'profit' && (
          <>
            <div className="p-3 bg-slate-700 rounded-lg border border-slate-600">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Top Performer</p>
              <p className="text-sm font-semibold text-slate-100 mt-0.5">{data.profitPerBrand?.[0]?.brand || 'N/A'}</p>
            </div>
            <div className="p-3 bg-slate-700 rounded-lg border border-slate-600">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Top gross</p>
              <p className="text-sm font-semibold text-slate-100 mt-0.5">
                ${data.profitPerBrand?.[0]?.grossRevenue?.toFixed(0) || '0'}
              </p>
            </div>
          </>
        )}

        {view === 'trends' && (
          <>
            <div className="p-3 bg-slate-700 rounded-lg border border-slate-600">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Months Tracked</p>
              <p className="text-sm font-semibold text-slate-100 mt-0.5">{data.seasonalTrends.length}</p>
            </div>
            <div className="p-3 bg-slate-700 rounded-lg border border-slate-600">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Peak Month</p>
              <p className="text-sm font-semibold text-slate-100 mt-0.5">
                {data.seasonalTrends.length > 0
                  ? data.seasonalTrends.reduce((prev, cur) => cur.revenue > prev.revenue ? cur : prev).month
                  : 'N/A'}
              </p>
            </div>
          </>
        )}

        {view === 'bestsellers' && hasBestSellers && (
          <>
            <div className="p-3 bg-slate-700 rounded-lg border border-slate-600">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Top Seller</p>
              <p className="text-xs font-semibold text-slate-100 mt-0.5 truncate" title={data.bestSellers![0]?.itemTitle}>
                {data.bestSellers![0]?.brand} — ${data.bestSellers![0]?.revenue.toFixed(0)}
              </p>
            </div>
            <div className="p-3 bg-slate-700 rounded-lg border border-slate-600">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Unique Items</p>
              <p className="text-sm font-semibold text-slate-100 mt-0.5">{data.bestSellers!.length} tracked</p>
            </div>
          </>
        )}

        {view === 'inventory' && hasInventory && (
          <>
            <div className="p-3 bg-slate-700 rounded-lg border border-slate-600">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Top Brand (Stock)</p>
              <p className="text-sm font-semibold text-slate-100 mt-0.5">{data.inventoryByBrand?.[0]?.brand || 'N/A'} — {data.inventoryByBrand?.[0]?.count || 0} listings</p>
            </div>
            <div className="p-3 bg-slate-700 rounded-lg border border-slate-600">
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Most Watched</p>
              <p className="text-sm font-semibold text-slate-100 mt-0.5 truncate" title={data.topWatchedItems?.[0]?.title}>
                {data.topWatchedItems?.[0]
                  ? `${data.topWatchedItems[0].watchers}w · $${data.topWatchedItems[0].price.toFixed(0)} · ${data.topWatchedItems[0].title.substring(0, 28)}…`
                  : 'No watched items'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
