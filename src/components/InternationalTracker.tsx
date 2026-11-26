'use client';

import React from 'react';
import { Globe, MapPin, TrendingUp } from 'lucide-react';
import { PHASE_3_TARGETS } from '@/lib/constants';

interface InternationalTrackerProps {
  metrics: {
    internationalRate: number;
    targetRegionRate: number;
    canadaSalesCount: number;
    ukSalesCount: number;
    salesCount: number;
  };
}

export default function InternationalTracker({ metrics }: InternationalTrackerProps) {
  const {
    internationalRate = 0,
    targetRegionRate = 0,
    canadaSalesCount = 0,
    ukSalesCount = 0,
    salesCount = 1,
  } = metrics;

  const target = PHASE_3_TARGETS.GLOBAL_REACH * 100; // Configured CA/UK target
  const progress = Math.min((targetRegionRate / target) * 100, 100);

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden h-full">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="text-blue-600" size={18} />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">International Expansion Tracker</h3>
        </div>
        <div className="text-[10px] font-mono font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded uppercase tracking-tighter">
          Target: {target}% (CA/UK)
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Overall Progress */}
        <div>
          <div className="flex justify-between items-end mb-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">CA/UK Market Penetration</span>
            <span className="text-xl font-bold font-mono text-slate-900">{targetRegionRate.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-1000 ${targetRegionRate >= target ? 'bg-green-500' : 'bg-blue-600'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] font-mono text-slate-400">
            <span>Current: {targetRegionRate.toFixed(1)}%</span>
            <span>Goal: {target}%</span>
          </div>
        </div>

        {/* Region Breakdown */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-50 border border-slate-200 p-3 rounded">
            <div className="flex items-center gap-1.5 mb-2">
              <MapPin className="text-red-500" size={14} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Canada</span>
            </div>
            <div className="text-lg font-bold font-mono text-slate-800">{canadaSalesCount}</div>
            <div className="text-[10px] font-mono text-slate-400 uppercase tracking-tighter">
              {((canadaSalesCount / (salesCount || 1)) * 100).toFixed(1)}% of total
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-3 rounded">
            <div className="flex items-center gap-1.5 mb-2">
              <MapPin className="text-blue-500" size={14} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">United Kingdom</span>
            </div>
            <div className="text-lg font-bold font-mono text-slate-800">{ukSalesCount}</div>
            <div className="text-[10px] font-mono text-slate-400 uppercase tracking-tighter">
              {((ukSalesCount / (salesCount || 1)) * 100).toFixed(1)}% of total
            </div>
          </div>
        </div>

        {/* Global Overview */}
        <div className="border-t border-slate-100 pt-4 flex justify-between items-center">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Total Global Reach</div>
            <div className="text-sm font-bold font-mono text-slate-700">{internationalRate.toFixed(1)}%</div>
          </div>
          <div className="flex items-center gap-1 text-green-600">
            <TrendingUp size={14} />
            <span className="text-[10px] font-bold uppercase tracking-tighter">Tracking Positive</span>
          </div>
        </div>
      </div>
    </div>
  );
}
