'use client';

import React from 'react';
import { useDemoMode } from '@/components/DemoProvider';
import { AlertTriangle } from 'lucide-react';

export default function SuccessDashboard({ metrics }: { metrics: any }) {
  const demo = useDemoMode();
  if (!metrics) return null;

  const {
    revenue = 0,
    asp = 0,
    avgOrderValue = 0,
    nicheAuthority = 0,
    globalReach = 0,
    netRevenue = 0,
    ebayFees = 0,
    activeListings = 0,
    totalOrders = 0,
    bestMonth = null,
    redFlags = []
  } = metrics;

  const aov = avgOrderValue || asp;

  const secondary = [
    { label: 'Active Listings', value: activeListings.toLocaleString() },
    { label: 'Net revenue', value: `$${netRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, accent: netRevenue >= 0 },
    { label: 'eBay fees', value: `-$${ebayFees.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, accent: false },
    { label: 'Niche Authority', value: `${(nicheAuthority * 100).toFixed(1)}%` },
    { label: 'Global Reach', value: `${(globalReach * 100).toFixed(1)}%` },
    ...(bestMonth ? [{ label: 'Best Month', value: bestMonth }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-start gap-0 md:gap-10">

        {/* Primary: Revenue dominates */}
        <div className="md:border-r md:border-slate-800 md:pr-10 flex-shrink-0 pb-6 md:pb-0 border-b border-slate-800 md:border-b-0">
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest mb-2">Gross revenue</p>
          <p className="text-5xl font-semibold text-slate-100 tracking-tight leading-none tabular-nums">
            ${revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <div className="flex gap-8 mt-5">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Orders</p>
              <p className="text-xl font-semibold text-slate-200 mt-0.5 tabular-nums">{totalOrders.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Avg Order</p>
              <p className="text-xl font-semibold text-slate-200 mt-0.5 tabular-nums">${aov.toFixed(0)}</p>
            </div>
          </div>
        </div>

        {/* Secondary: compact stat grid */}
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-x-8 pt-5 md:pt-0">
          {secondary.map(({ label, value, accent }) => (
            <div key={label} className="py-2.5 border-b border-slate-800/60">
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest">{label}</p>
              <p className={`text-sm font-semibold mt-0.5 tabular-nums ${
                accent === true ? 'text-emerald-400' :
                accent === false ? 'text-red-400' :
                'text-slate-300'
              }`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-slate-600">{demo ? 'Gross, fees and net use synthetic finance records. Inventory cost is not included here; see Profit & Ads.' : <>Gross, fees and net are from eBay&apos;s Finances data. Inventory cost is not yet included — see Profit &amp; Ads.</>}</p>

      {redFlags.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
            <h3 className="text-xs font-medium uppercase tracking-wider text-amber-400">Priority Alerts</h3>
          </div>
          <div className="space-y-2">
            {redFlags.map((flag: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs text-amber-200/80 border-b border-amber-500/20 pb-2 last:border-0 last:pb-0">
                <span>{flag.message}</span>
                <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider flex-shrink-0 ml-3">{flag.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
