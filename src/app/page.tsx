'use client';

import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_DATE } from '@/lib/demo/config';

import { storeFetch } from '@/lib/stores/browser';

import { useState, useEffect } from 'react';
import AIChatDrawer from '@/components/AIChatDrawer';
import MarketAnalytics from '@/components/MarketAnalytics';
import SuccessDashboard from '@/components/SuccessDashboard';
import { useDashboardMetrics } from '@/hooks/useDashboardMetrics';
import { MessageSquare, MapPin, Upload, Download, BarChart3, Plus, ChevronRight, Loader2, X, ShoppingCart, DollarSign, RotateCcw } from 'lucide-react';
import StoreLink from '@/components/StoreLink';

interface Task {
  id: number;
  title: string;
  priority: string;
  status: string;
  createdAt: string;
}

export default function Dashboard() {
  const demo = useDemoMode();
  const readOnlyReason = demo ? 'Unavailable in this read-only demo. The sample store cannot be changed.' : undefined;
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isBrandModalOpen, setIsBrandModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  
  const [filterPeriod, setFilterPeriod] = useState('all');
  const [filterMonth, setFilterMonth] = useState<number | undefined>();
  const [filterYear, setFilterYear] = useState<number | undefined>();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { metrics, isLoading } = useDashboardMetrics({
    period: filterPeriod === 'month' ? undefined : filterPeriod,
    month: filterPeriod === 'month' ? filterMonth : undefined,
    year: filterPeriod === 'month' ? filterYear : undefined,
  });

  useEffect(() => {
    storeFetch('/api/tasks')
      .then(r => r.json())
      .then(data => Array.isArray(data) && setTasks(data.slice(0, 5)))
      .catch(() => {});
  }, []);

  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    // Check if it's a month-year value (e.g., "2024-3")
    const isMonthYear = /^\d{4}-\d{1,2}$/.test(val);
    
    if (isMonthYear) {
      const [y, m] = val.split('-').map(Number);
      setFilterPeriod('month');
      setFilterMonth(m);
      setFilterYear(y);
    } else {
      setFilterPeriod(val);
      setFilterMonth(undefined);
      setFilterYear(undefined);
    }
  };

  const handleReset = async (type: 'sales' | 'inventory' | 'all') => {
    if (demo) return;
    setIsResetting(true);
    try {
      await storeFetch(`/api/reset?type=${type}`, { method: 'DELETE' });
      setIsResetModalOpen(false);
      window.location.reload();
    } catch {
      alert('Reset failed');
    } finally {
      setIsResetting(false);
    }
  };

  const handleDownloadReport = async () => {
    try {
      const res = await storeFetch('/api/reports');
      if (!res.ok) throw new Error('Failed to fetch report');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `weekly-strategy-report-${demo ? DEMO_DATE : new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Report error:', err);
      alert('Failed to generate weekly strategy report');
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-blue-600" size={24} />
          <p className="text-slate-500 text-xs">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex flex-wrap flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100 tracking-tight">Store Performance</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {demo ? `Synthetic snapshot · ${DEMO_DATE} (UTC)` : mounted && metrics?.lastUpdated
                ? `Last synced ${new Date(metrics.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : 'No data uploaded yet'}
            </p>
          </div>
          
          <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 shadow-sm">
            <BarChart3 size={14} className="text-slate-500 mr-2" />
            <select 
              className="bg-transparent text-slate-200 text-xs font-medium border-none focus:ring-0 cursor-pointer outline-none"
              value={filterPeriod === 'month' ? `${filterYear}-${filterMonth}` : filterPeriod}
              onChange={handlePeriodChange}
            >
              <optgroup label="Quick Filters" className="bg-slate-800">
                <option value="all">All Time</option>
                <option value="last30">Last 30 Days</option>
                <option value="last90">Last 90 Days</option>
                <option value="this-year">This Year</option>
                <option value="last-year">Last Year</option>
              </optgroup>
              {metrics?.metrics?.availablePeriods?.length > 0 && (
                <optgroup label="By Month" className="bg-slate-800">
                  {metrics.metrics.availablePeriods.map((p: any) => (
                    <option key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap max-w-full gap-2 w-full md:w-auto">
          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 text-slate-200 text-sm font-medium border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <span className="relative flex-shrink-0">
              <MessageSquare size={15} />
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </span>
            Ask Agent
          </button>
          {demo ? (
            <button type="button" disabled title={readOnlyReason} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-50">
            <Upload size={15} />
            Upload CSV
            </button>
          ) : (
            <StoreLink href="/upload" className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 transition-colors cursor-pointer">
            <Upload size={15} />
            Upload CSV
            </StoreLink>
          )}
          <button
            onClick={handleDownloadReport}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 text-slate-200 text-sm font-medium border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <Download size={15} />
            Report
          </button>
          <button
            onClick={() => !demo && setIsResetModalOpen(true)}
            disabled={demo}
            aria-label="Reset dashboard data"
            className="flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 text-red-400 text-sm font-medium border border-slate-700 rounded-lg hover:bg-red-950/40 hover:border-red-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title={readOnlyReason || "Reset dashboard data"}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>

      {/* Reset Modal */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-sm mx-4 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-slate-100 font-semibold text-base">Reset Dashboard Data</h3>
                <p className="text-slate-400 text-xs mt-1">Choose what to clear. This cannot be undone.</p>
              </div>
              <button onClick={() => setIsResetModalOpen(false)} aria-label="Close" className="text-slate-500 hover:text-slate-300 p-1 rounded transition-colors cursor-pointer">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => handleReset('sales')}
                disabled={demo || isResetting}
                title={readOnlyReason}
                className="w-full flex items-center gap-3 px-4 py-3 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg text-left transition-colors disabled:opacity-50"
              >
                <DollarSign size={16} className="text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-slate-100 text-sm font-medium">Clear Sales Data</p>
                  <p className="text-slate-400 text-xs">Removes all performance metrics & sales history</p>
                </div>
              </button>
              <button
                onClick={() => handleReset('inventory')}
                disabled={demo || isResetting}
                title={readOnlyReason}
                className="w-full flex items-center gap-3 px-4 py-3 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg text-left transition-colors disabled:opacity-50"
              >
                <ShoppingCart size={16} className="text-blue-400 flex-shrink-0" />
                <div>
                  <p className="text-slate-100 text-sm font-medium">Clear Inventory</p>
                  <p className="text-slate-400 text-xs">Removes all active listing data</p>
                </div>
              </button>
              <button
                onClick={() => handleReset('all')}
                disabled={demo || isResetting}
                title={readOnlyReason}
                className="w-full flex items-center gap-3 px-4 py-3 bg-red-950/50 hover:bg-red-950/80 border border-red-900 rounded-lg text-left transition-colors disabled:opacity-50"
              >
                <RotateCcw size={16} className="text-red-400 flex-shrink-0" />
                <div>
                  <p className="text-red-300 text-sm font-medium">Clear Everything</p>
                  <p className="text-red-400/70 text-xs">Wipes all sales and inventory data</p>
                </div>
              </button>
            </div>
            {isResetting && (
              <div className="flex items-center gap-2 text-slate-400 text-xs justify-center">
                <Loader2 size={12} className="animate-spin" />
                Clearing data...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Store metrics */}
      <SuccessDashboard metrics={metrics?.metrics} />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Market Analysis */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 min-h-[400px] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-base font-semibold text-slate-100">Market Momentum</h2>
            </div>
            <MarketAnalytics data={{
              profitPerBrand: metrics?.metrics?.profitPerBrand || [],
              seasonalTrends: metrics?.metrics?.seasonalTrends || [],
              monthlySales: metrics?.metrics?.monthlySales || [],
              bestSellers: metrics?.metrics?.bestSellers || [],
              inventoryByBrand: metrics?.metrics?.inventoryByBrand || [],
              topWatchedItems: metrics?.metrics?.topWatchedItems || [],
            }} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StoreLink href="/sourcing" className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex items-center gap-3 group cursor-pointer hover:border-slate-600 hover:bg-slate-700/50 transition-colors">
              <MapPin size={16} className="text-slate-500 flex-shrink-0 group-hover:text-slate-300 transition-colors" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Sourcing Trip</p>
                <p className="text-sm font-semibold text-slate-100 mt-0.5">{demo ? 'Demo Yard North' : 'Pick-A-Part VA'}</p>
              </div>
              <ChevronRight size={16} className="text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0" />
            </StoreLink>

            <div
              onClick={() => metrics?.metrics?.profitPerBrand?.length && setIsBrandModalOpen(true)}
              className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex items-center gap-3 group cursor-pointer hover:border-slate-600 hover:bg-slate-700/50 transition-colors"
            >
              <BarChart3 size={16} className="text-slate-500 flex-shrink-0 group-hover:text-slate-300 transition-colors" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Top Brand</p>
                <p className="text-sm font-semibold text-slate-100 mt-0.5 truncate">
                  {metrics?.metrics?.profitPerBrand?.[0]?.brand || 'Upload CSV'}
                </p>
              </div>
              <ChevronRight size={16} className="text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0" />
            </div>
          </div>
        </div>

        {/* Task Matrix */}
        <div className="lg:col-span-4">
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 flex flex-col h-full">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-base font-semibold text-slate-100">Task Matrix</h2>
              <StoreLink href="/tasks" onClick={event => { if (demo) event.preventDefault(); }}>
                <button disabled={demo} title={readOnlyReason} aria-label="Add task" className="p-1.5 text-blue-400 bg-blue-500/10 rounded-lg hover:bg-blue-500/20 transition cursor-pointer">
                  <Plus size={16} />
                </button>
              </StoreLink>
            </div>

            <div className="space-y-1 flex-1">
              {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-slate-500 text-sm gap-1.5">
                  <p className="font-medium text-slate-400">No tasks yet</p>
                  <StoreLink href="/tasks" className="text-blue-400 text-xs hover:underline">{demo ? 'View sample Task Matrix →' : 'Add tasks in Task Matrix →'}</StoreLink>
                </div>
              ) : tasks.map((item) => {
                const priorityColor =
                  item.priority === 'high' ? 'bg-red-500/10 text-red-400' :
                  item.priority === 'medium' ? 'bg-amber-500/10 text-amber-400' :
                  'bg-slate-700 text-slate-400';
                return (
                  <div key={item.id} className="group flex items-start gap-3 p-3 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 w-4 h-4 rounded border border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 cursor-pointer flex-shrink-0"
                      readOnly
                      disabled={demo}
                      title={readOnlyReason}
                      checked={item.status === 'completed'}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-300 font-medium leading-snug group-hover:text-slate-100 transition-colors truncate">{item.title}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${priorityColor}`}>
                          {item.priority}
                        </span>
                        <span className={`text-[10px] font-medium ${
                          item.status === 'in-progress' ? 'text-blue-400' :
                          item.status === 'completed' ? 'text-emerald-400' : 'text-slate-500'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <StoreLink href="/tasks" className="mt-5 block">
              <button className="w-full py-2.5 text-xs font-medium text-blue-400 bg-blue-500/10 rounded-lg hover:bg-blue-500/20 transition-colors border border-blue-500/20 uppercase tracking-wider cursor-pointer">
                View Strategy Map
              </button>
            </StoreLink>
          </div>
        </div>
      </div>

      {/* Analytics Row: Insights + Top States + Promoted */}
      {(metrics?.metrics?.salesInsights?.length > 0 || metrics?.metrics?.topStates?.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Key Insights */}
          {metrics?.metrics?.salesInsights?.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">Key Insights</h3>
              <ul className="space-y-2">
                {metrics.metrics.salesInsights.map((insight: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                    <span className="text-slate-500 mt-0.5 flex-shrink-0">→</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Top States */}
          {metrics?.metrics?.topStates?.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">Top Markets</h3>
              <div className="space-y-2">
                {metrics.metrics.topStates.slice(0, 5).map((s: any, i: number) => (
                  <div key={s.state} className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 w-4 flex-shrink-0">{i + 1}</span>
                    <span className="text-xs font-medium text-slate-200 w-24 flex-shrink-0 truncate" title={s.state}>{s.state}</span>
                    <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full"
                        style={{ width: `${(s.revenue / metrics.metrics.topStates[0].revenue) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">${(s.revenue / 1000).toFixed(1)}k</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Promoted vs Organic */}
          {metrics?.metrics?.promotedStats?.promotedOrders > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">Promoted vs Organic</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                    <span>Promoted</span>
                    <span>{(metrics.metrics.promotedStats.promotedPct * 100).toFixed(0)}% of orders</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-blue-600 rounded-full" style={{ width: `${metrics.metrics.promotedStats.promotedPct * 100}%` }} />
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-slate-300 font-medium">{metrics.metrics.promotedStats.promotedOrders} orders</span>
                    <span className="text-blue-400 font-semibold">${metrics.metrics.promotedStats.promotedRevenue.toFixed(0)}</span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                    <span>Organic</span>
                    <span>{((1 - metrics.metrics.promotedStats.promotedPct) * 100).toFixed(0)}% of orders</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(1 - metrics.metrics.promotedStats.promotedPct) * 100}%` }} />
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-slate-300 font-medium">{metrics.metrics.promotedStats.organicOrders} orders</span>
                    <span className="text-emerald-400 font-semibold">${metrics.metrics.promotedStats.organicRevenue.toFixed(0)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Chat — inline below dashboard */}
      <AIChatDrawer isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />

      {/* Brand Modal */}
      {isBrandModalOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setIsBrandModalOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">Sales by Brand</h2>
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mt-0.5">{demo ? 'Selected period · synthetic records' : 'Lifetime revenue · all uploads'}</p>
              </div>
              <button
                onClick={() => setIsBrandModalOpen(false)}
                aria-label="Close brand breakdown"
                className="p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <div className="overflow-y-auto p-6 space-y-2">
              {(metrics?.metrics?.profitPerBrand || []).map((b: any, i: number) => (
                <div key={b.brand} className="flex items-center gap-3 p-3 rounded-lg bg-slate-800 border border-slate-700">
                  <div className="w-6 h-6 flex items-center justify-center rounded-md bg-blue-600 text-white text-xs font-semibold flex-shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-100 text-sm">{b.brand}</p>
                    <div className="flex gap-3 mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      <span className="flex items-center gap-1"><ShoppingCart size={10} />{b.units} sold</span>
                      <span className="flex items-center gap-1"><DollarSign size={10} />${(b.grossRevenue || 0).toFixed(0)} gross</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-semibold ${b.netRevenue >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {b.netRevenue >= 0 ? '+' : ''}${(b.netRevenue || 0).toFixed(0)}
                    </p>
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">net</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
