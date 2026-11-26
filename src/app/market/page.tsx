'use client';

import { storeFetch } from '@/lib/stores/browser';

import { useState, useEffect } from 'react';
import MarketAnalytics from '@/components/MarketAnalytics';
import { useDashboardMetrics } from '@/hooks/useDashboardMetrics';
import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_DATE } from '@/lib/demo/config';
import { demoMarketCashSummary, type DemoMarketFinancials } from '@/lib/demo/market-presentation';
import {
  TrendingUp, BarChart3, Lightbulb, MapPin, Loader2,
  Wrench, Globe, Package, Receipt, DollarSign,
  Eye, Megaphone,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ComposedChart, Line,
} from 'recharts';

const STATE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6', '#84CC16', '#F43F5E', '#A855F7', '#0EA5E9', '#22C55E'];

const PART_CATEGORIES: { label: string; keywords: string[] }[] = [
  { label: 'Climate Control / HVAC', keywords: ['climate', 'hvac', 'heater', 'ac ', 'a/c', 'blower', 'condenser', 'evaporator'] },
  { label: 'Steering', keywords: ['steering', 'clock spring', 'contact reel', 'column'] },
  { label: 'Brakes / ABS', keywords: ['brake', 'abs', 'anti lock', 'anti-lock', 'caliper', 'rotor'] },
  { label: 'Electrical / Modules', keywords: ['module', 'ecu', 'fuse box', 'relay', 'bcm', 'ignition', 'transceiver', 'immobilizer', 'central electronic'] },
  { label: 'Power Steering / Motor', keywords: ['power steering', 'electric power', 'assist motor', 'rack'] },
  { label: 'Engine / Transmission', keywords: ['engine', 'transmission', 'motor', 'alternator', 'starter'] },
  { label: 'Interior / Body', keywords: ['door', 'mirror', 'seat', 'window', 'panel', 'bezel', 'dash', 'trim', 'console'] },
  { label: 'Other', keywords: [] },
];

function categorizePart(title: string): string {
  const t = title.toLowerCase();
  for (const cat of PART_CATEGORIES.slice(0, -1)) {
    if (cat.keywords.some(kw => t.includes(kw))) return cat.label;
  }
  return 'Other';
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs shadow-xl">
      <p className="text-gray-300 font-medium mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || p.fill }}>
          {p.name}: {typeof p.value === 'number' && (p.name?.toLowerCase().includes('revenue') || p.name?.toLowerCase().includes('amount') || p.name?.toLowerCase().includes('cost') || p.name?.toLowerCase().includes('fee') || p.name?.toLowerCase().includes('profit'))
            ? `$${Number(p.value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
            : p.value}
        </p>
      ))}
    </div>
  );
};

interface ExpenseData {
  invByMonth: Array<{ month: string; amount: number }>;
  invByVendor: Array<{ vendor: string; total: number }>;
  feesByMonth: Array<{ month: string; finalValue: number; perOrder: number; flat: number; total: number }>;
  totalInventoryCost: number;
  totalFees: number;
  tripCount: number;
  hasExpenseData: boolean;
  hasFeeData: boolean;
  largestPurchase?: { amount: number; vendor: string; date: string } | null;
}

// Illustrative analysis prompts, not findings about a real store.
const CROSS_REF_FINDINGS = [
  { type: 'success', icon: '✅', title: 'Sample: Compare Revenue and Inventory Trends', body: 'Compare monthly revenue with inventory purchases to explore how sourcing activity changes with demand.' },
  { type: 'success', icon: '✅', title: 'Sample: Reconcile Fee and Sales Reports', body: 'Match fee entries to order identifiers and review unmatched rows before drawing conclusions about report completeness.' },
  { type: 'info', icon: '📐', title: 'Sample: Review Purchase Timing', body: 'Compare purchase dates with sales dates to explore stocking patterns and possible sourcing delays.' },
  { type: 'info', icon: '🔄', title: 'Sample: Compare Product Categories', body: 'Review revenue, volume, and purchase costs by category to identify areas for further analysis.' },
  { type: 'warning', icon: '⚠️', title: 'Sample: Check Seasonal Changes', body: 'Compare the same months across multiple periods before treating a short-term change as a lasting trend.' },
  { type: 'warning', icon: '⚠️', title: 'Sample: Review Similar Expense Entries', body: 'Rows with matching vendor, date, and amount may warrant review. Confirm the underlying receipts before removing any entry.' },
  { type: 'warning', icon: '⚠️', title: 'Sample: Compare Advertising Outcomes', body: 'Compare promoted and organic sales while accounting for advertising fees, item mix, and the reporting window.' },
  { type: 'alert', icon: '🔍', title: 'Sample: Include Opening Inventory', body: 'A beginning-inventory balance helps explain sales of stock purchased before the selected reporting period.' },
  { type: 'info', icon: '🌍', title: 'Sample: Separate International Shipping Costs', body: 'Track shipping expenses by destination so domestic and international margins can be compared consistently.' },
];

const GAPS_AND_RECS = {
  gaps: [
    { icon: '📁', title: 'Example Input: Shipping Cost Records', body: 'A shipping-expense report allows collected shipping revenue to be compared with fulfillment costs.' },
    { icon: '📁', title: 'Example Input: Opening Inventory', body: 'A beginning-inventory balance helps account for stock acquired before the selected period.' },
    { icon: '📁', title: 'Example Input: Returns & Refunds', body: 'A returns report can distinguish reversed transactions from completed sales.' },
  ],
  recs: [
    { icon: '🎯', title: 'Example Review: Category Mix', body: 'Compare demand and margin across categories before deciding which products to source next.' },
    { icon: '🎯', title: 'Example Review: Purchase Categories', body: 'Consistent purchase tags support comparisons of revenue and acquisition costs by category.' },
    { icon: '🎯', title: 'Example Review: Expense Accuracy', body: 'Use receipts and order references to check unusual or repeated expense rows.' },
  ],
};

const VENDOR_COLORS: Record<string, string> = {
  'Yard A': '#3B82F6',
  'Yard B': '#10B981',
  'Yard C': '#F59E0B',
};

const TABS = [
  { id: 'sales', label: 'Sales Performance', icon: BarChart3 },
  { id: 'product', label: 'Product & Catalog', icon: Wrench },
  { id: 'geographic', label: 'Geographic', icon: Globe },
  { id: 'traffic', label: 'Traffic & Visibility', icon: Eye },
  { id: 'inventory-supplier', label: 'Inventory & Supplier', icon: Package },
  { id: 'ebay-fees', label: 'eBay Fees', icon: Receipt },
  { id: 'profitability', label: 'Profitability', icon: DollarSign },
  { id: 'advertising', label: 'Advertising', icon: Megaphone },
];

export default function MarketPage() {
  const demo = useDemoMode();
  const { metrics, isLoading, isError } = useDashboardMetrics();
  const m = metrics?.metrics;
  const [activeTab, setActiveTab] = useState('sales');
  const [expenseData, setExpenseData] = useState<ExpenseData | null>(null);
  const [adData, setAdData] = useState<any>(null);
  const [demoFinancials, setDemoFinancials] = useState<DemoMarketFinancials | null>(null);
  const [operatingExpenses, setOperatingExpenses] = useState<number | null>(null);
  const [demoFinanceError, setDemoFinanceError] = useState(false);

  useEffect(() => {
    if (demo) return;
    storeFetch('/api/expenses').then(r => r.json()).then(setExpenseData).catch(() => {});
    storeFetch('/api/advertising').then(r => r.json()).then(setAdData).catch(() => {});
  }, [demo]);

  useEffect(() => {
    if (!demo) return;
    let cancelled = false;
    const read = async (url: string) => {
      const response = await storeFetch(url);
      if (!response.ok) throw new Error('Demo analytics could not be loaded');
      return response.json();
    };
    Promise.all([read('/api/profitability'), read('/api/general-expenses'), read('/api/expenses'), read('/api/advertising')])
      .then(([profitability, expenses, inventory, advertising]) => {
        if (cancelled) return;
        setDemoFinancials(profitability.financials);
        setOperatingExpenses(expenses.total);
        setExpenseData(inventory);
        setAdData(advertising);
      })
      .catch(() => { if (!cancelled) setDemoFinanceError(true); });
    return () => { cancelled = true; };
  }, [demo]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  if (demo && isError) {
    return <p className="p-8 text-gray-500 dark:text-gray-400" role="alert">Market data could not be loaded. Refresh to try again.</p>;
  }

  const topBrand = m?.profitPerBrand?.[0];
  const geography = demo ? m?.geography : null;
  const geographicStates: Array<{ state: string; orders: number; revenue: number }> = geography?.states ?? [];
  const topStates: Array<{ state: string; orders: number; revenue: number }> = demo
    ? [...geographicStates].sort((a, b) => b.revenue - a.revenue).slice(0, 10)
    : m?.topStates || [];
  const demoConcentration = geographicStates.slice(0, 10).map((state, index) => ({
    label: state.state, count: state.orders,
    pct: ((state.orders / (geography?.domesticOrders || 1)) * 100).toFixed(1),
    width: (state.orders / (geographicStates[0]?.orders || 1)) * 100,
    color: STATE_COLORS[index % STATE_COLORS.length],
  }));
  const countryNames = (geography?.countries ?? []).map((country: { country: string }) => country.country).join(', ');
  const reportMonths = m?.monthlySales ?? [];
  const demoPeriodLabel = reportMonths.length
    ? `${reportMonths[0].label} – ${reportMonths[reportMonths.length - 1].label}`
    : 'No reporting months';
  const maxStateRevenue = topStates[0]?.revenue || 1;
  const nicheAuthorityPct = ((m?.nicheAuthority || 0) * 100).toFixed(1);
  const promotedPct = m?.promotedStats ? (m.promotedStats.promotedPct * 100).toFixed(0) : null;

  // Build part category breakdown from best sellers
  const partCatMap: Record<string, { count: number; revenue: number }> = {};
  (m?.bestSellers || []).forEach((s: any) => {
    const cat = categorizePart(s.itemTitle);
    if (!partCatMap[cat]) partCatMap[cat] = { count: 0, revenue: 0 };
    partCatMap[cat].count += s.orders;
    partCatMap[cat].revenue += s.revenue;
  });
  const partCatData = Object.entries(partCatMap)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue);
  const partCatRevenue = partCatData.reduce((total, category) => total + category.revenue, 0);

  // Use uploaded expense data when available
  const invByMonth = (expenseData?.invByMonth || []).map(d => {
    const [yr, mo] = d.month.split('-');
    const label = new Date(+yr, +mo - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    // Find matching revenue month
    const revMonth = m?.monthlySales?.find((ms: any) => ms.month === d.month);
    return { label, inventoryCost: d.amount, revenue: revMonth?.revenue || 0 };
  });

  const invByVendor = expenseData?.invByVendor || [];
  const totalInventoryCost = expenseData?.totalInventoryCost || 0;
  // eBay fees: the reconciled Finances total (same source as the eBay Fees tab).
  // The uploaded-PDF `EbayFee` table is the fallback for pre-Finances history.
  const totalFees = demo ? m?.ebayFees ?? 0 : (m?.ebayFees ?? 0) || (expenseData?.totalFees || 0);

  // Real monthly eBay fees from the Finances data (metrics.byMonth), replacing
  // the uploaded-PDF fallback on the eBay Fees tab.
  const feeMonths = (m?.byMonth ?? []).map((mo: any) => {
    const [yr, mn] = mo.month.split('-');
    const label = new Date(+yr, +mn - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    return {
      month: mo.month,
      label,
      finalValue: mo.finalValueFee,
      perOrder: mo.perOrderFee,
      flat: mo.otherFee,
      total: mo.finalValueFee + mo.perOrderFee + mo.otherFee,
    };
  });
  const realTotalFees = m?.ebayFees ?? 0;

  const totalRevenue = m?.revenue || 0;
  const totalShipping = (m?.monthlySales || []).reduce((sum: number, month: any) => sum + (month.shipping || 0), 0);
  const shippingCost = 0;
  const estProfit = totalRevenue + totalShipping - totalInventoryCost - totalFees - shippingCost;

  const demoCash = demo && demoFinancials && operatingExpenses !== null && expenseData?.hasExpenseData !== undefined
    ? demoMarketCashSummary(demoFinancials, totalInventoryCost, operatingExpenses)
    : null;
  const money = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const demoCostComposition = demoCash ? [
    { name: 'Cash after expenses', value: Math.max(0, demoCash.cashAfterExpenses) },
    { name: 'Inventory purchases', value: demoCash.inventoryPurchases },
    { name: 'eBay selling fees', value: demoCash.marketplaceFees },
    { name: 'Postage', value: demoCash.postage },
    { name: 'Refunds', value: demoCash.refunds },
    { name: 'Advertising', value: demoCash.advertising },
    { name: 'Other ledger costs', value: Math.max(0, demoCash.otherLedgerCosts) },
    { name: 'Operating expenses', value: demoCash.operatingExpenses },
  ].filter(row => row.value > 0) : [];

  const pieColors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">Market Analysis</h1>
          <p className="text-gray-500 font-mono text-xs uppercase tracking-widest mt-1">Business Intelligence{demo && ` · Portfolio Demo · ${demoPeriodLabel} · As of ${DEMO_DATE}`}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 px-4 py-2 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center gap-2">
          <BarChart3 className="text-blue-600" size={16} />
          <span className="text-xs font-bold text-gray-600 dark:text-gray-300">
            {m?.totalOrders ? `${m.totalOrders} orders` : demo ? 'No sample orders' : 'Upload CSV to populate'}
          </span>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex flex-wrap gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl transition-all duration-150 ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-white/50 dark:hover:bg-gray-700/50'
              }`}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab: Sales Performance ─────────────────────────────── */}
      {activeTab === 'sales' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className={`${demo ? 'min-w-0 ' : ''}lg:col-span-2 bg-white dark:bg-gray-800 p-8 rounded-[2.5rem] shadow-sm border border-gray-100 dark:border-gray-700 min-h-[600px] flex flex-col`}>
            <h2 className="text-xl font-black mb-6 text-gray-800 dark:text-white tracking-tight flex items-center gap-2">
              <BarChart3 className="text-blue-500" size={20} />
              Sales Performance
            </h2>
            <MarketAnalytics data={{
              profitPerBrand: m?.profitPerBrand || [],
              seasonalTrends: m?.seasonalTrends || [],
              monthlySales: m?.monthlySales || [],
              bestSellers: m?.bestSellers || [],
              inventoryByBrand: m?.inventoryByBrand || [],
              topWatchedItems: m?.topWatchedItems || [],
            }} />
          </div>
          <div className="space-y-6">
            <div className="bg-blue-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-blue-100">
              <TrendingUp className="mb-4" size={32} />
              <h3 className="text-xl font-black mb-2">Market Snapshot</h3>
              {topBrand ? (
                <div className="space-y-2 text-blue-100 text-sm font-medium leading-relaxed">
                  <p>Top brand: <span className="text-white font-bold">{topBrand.brand}</span> — ${Number(topBrand.grossRevenue).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} gross</p>
                  {nicheAuthorityPct !== '0.0' && <p>{demo ? 'Volvo: ' : 'Niche authority: '}<span className="text-white font-bold">{nicheAuthorityPct}%</span> of volume</p>}
                  {promotedPct && <p><span className="text-white font-bold">{promotedPct}%</span> of orders via Promoted Listings</p>}
                  {m?.bestMonth && <p>Best month: <span className="text-white font-bold">{m.bestMonth}</span></p>}
                </div>
              ) : (
                <p className="text-blue-100 text-sm font-medium">{demo ? 'No synthetic sales are available for this snapshot.' : 'Upload your Paid & Shipped CSV to generate market analysis.'}</p>
              )}
            </div>
            {(m?.salesInsights?.length || 0) > 0 && (
              <div className="bg-white dark:bg-gray-800 p-6 rounded-[2.5rem] border border-gray-100 dark:border-gray-700 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Lightbulb size={14} className="text-amber-400 flex-shrink-0" />
                  <h3 className="text-sm font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Key Insights</h3>
                </div>
                <ul className="space-y-2.5">
                  {m!.salesInsights.map((insight: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <span className="text-amber-400 mt-0.5 flex-shrink-0">→</span>
                      <span>{insight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-[2.5rem] border border-gray-100 dark:border-gray-700 shadow-sm">
              <div className="flex items-center gap-2 mb-5">
                <MapPin size={14} className="text-blue-400 flex-shrink-0" />
                <h3 className="text-sm font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Regional Hotspots</h3>
              </div>
              {demo && <p className="text-xs text-gray-400 mb-3">Domestic states · item revenue</p>}
              {topStates.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">{demo ? 'No domestic destinations in this snapshot.' : 'Upload CSV to see top states by revenue.'}</p>
              ) : (
                <div className="space-y-3">
                  {topStates.slice(0, 8).map((s, i) => (
                    <div key={s.state} className="space-y-1">
                      <div className="flex justify-between items-center text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400 w-4">{i + 1}</span>
                          <span className="font-bold text-gray-700 dark:text-gray-200">{s.state}</span>
                          <span className="text-[10px] text-gray-400">{s.orders} orders</span>
                        </div>
                        <span className="font-mono text-xs font-bold" style={{ color: STATE_COLORS[i % STATE_COLORS.length] }}>
                          ${s.revenue.toFixed(0)}
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(s.revenue / maxStateRevenue) * 100}%`, backgroundColor: STATE_COLORS[i % STATE_COLORS.length] }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Product & Catalog Analysis ──────────────────── */}
      {activeTab === 'product' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Revenue by Car Make (Top 10)</h3>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={(m?.profitPerBrand || []).slice(0, 10)} layout="vertical" margin={{ left: 20, right: 30, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${v.toLocaleString()}`} />
                  <YAxis dataKey="brand" type="category" interval={demo ? 0 : undefined} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} width={demo ? 110 : 80} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey={demo ? "grossRevenue" : "revenue"} name="Revenue" radius={[0, 4, 4, 0]} barSize={14}>
                    {(m?.profitPerBrand || []).slice(0, 10).map((_: any, i: number) => (
                      <Cell key={i} fill={pieColors[i % pieColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className={`${demo ? 'demo-category-pie ' : ''}bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm`}>
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">{demo ? 'Part Categories · Top 10 Best Sellers' : 'Sales by Part Category'}</h3>
              {demo && <p className="text-xs text-gray-400 mb-3">Item revenue for the ten best-selling listings only.</p>}
              {partCatData.length > 0 ? (
                <>
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie data={partCatData} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={110} label={({ name, percent }) => `${name.split('/')[0].trim()} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                      {partCatData.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(0)}`, 'Revenue']} />
                  </PieChart>
                </ResponsiveContainer>
                {demo && <ul aria-label="Part category revenue shares" className="demo-category-pie-key mt-3 space-y-2 text-xs text-gray-500 dark:text-gray-400">
                  {partCatData.map((category, i) => <li key={category.name} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
                    <span className="min-w-0 break-words">{category.name} {(partCatRevenue > 0 ? category.revenue / partCatRevenue * 100 : 0).toFixed(0)}%</span>
                  </li>)}
                </ul>}
                </>
              ) : (
                <div className="h-[320px] flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                  <Wrench size={24} className="text-gray-400" />
                  <p className="text-sm text-gray-400 font-medium">{demo ? 'No sample best sellers are available.' : 'Upload Paid & Shipped CSV to see part category breakdown'}</p>
                </div>
              )}
            </div>
          </div>

          {/* Top 10 Items Table */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
            <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Top 10 Items by Total Revenue</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">#</th>
                    <th className="text-left py-2 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Item Title</th>
                    <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Units</th>
                    <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Revenue</th>
                    <th className="text-right py-2 px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Avg Price</th>
                  </tr>
                </thead>
                <tbody>
                  {(m?.bestSellers && m.bestSellers.length > 0 ? m.bestSellers.map((s: any, i: number) => ({
                    rank: i + 1, title: s.itemTitle, units: s.orders, revenue: s.revenue, avg: s.avgPrice
                  })) : []).map((row: any) => (
                    <tr key={row.rank} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="py-2.5 px-3 text-gray-400 font-mono text-xs">{row.rank}</td>
                      <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300 max-w-xs">
                        <span className="line-clamp-2 text-xs">{row.title}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-gray-700 dark:text-gray-300">{row.units}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-600">${row.revenue.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500 dark:text-gray-400 font-mono text-xs">${row.avg.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Geographic Analysis ──────────────────────────── */}
      {activeTab === 'geographic' && (demo && !geography ? (
        <p className="text-sm text-gray-500 dark:text-gray-400" role="status">Geographic data is unavailable. Refresh to try again.</p>
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-gray-500 dark:text-gray-400">{demo ? `All ${m?.totalOrders ?? 0} synthetic orders · ${demoPeriodLabel}. State shares use domestic orders only.` : 'Top states by order count from your recorded orders.'}</p>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {(demo ? [
              { label: 'Total US Orders', value: geography?.domesticOrders ?? '—', sub: 'Domestic destinations' },
              { label: 'International Orders', value: geography?.internationalOrders ?? '—', sub: m?.totalOrders ? `${((geography?.internationalOrders ?? 0) / m.totalOrders * 100).toFixed(1)}% of all orders` : 'No orders' },
              { label: 'States Reached', value: geography?.statesReached ?? '—', sub: 'All recorded domestic states' },
              { label: 'Countries Reached', value: geography?.countriesReached ?? '—', sub: countryNames || 'No recorded destinations' },
            ] : [
              // Destination breakdowns are only computed for the demo ledger.
              { label: 'Total Orders', value: m?.totalOrders ?? '—', sub: 'All recorded orders' },
            ]).map(k => (
              <div key={k.label} className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <p className="text-[11px] font-bold uppercase text-gray-400 dark:text-gray-500 tracking-wider mb-1">{k.label}</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">{k.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">{demo ? 'Domestic States by Order Count' : 'Top 15 States by Order Count'}</h3>
              <ResponsiveContainer width="100%" height={380}>
                <BarChart
                  data={demo ? geographicStates : topStates.length > 0 ? topStates.slice(0, 15) : [
                    { state: 'CA', orders: 30 }, { state: 'TX', orders: 24 }, { state: 'FL', orders: 20 },
                    { state: 'WA', orders: 18 }, { state: 'IL', orders: 16 }, { state: 'OH', orders: 14 },
                    { state: 'NY', orders: 12 }, { state: 'CO', orders: 10 }, { state: 'AZ', orders: 8 },
                    { state: 'OR', orders: 7 }, { state: 'MI', orders: 6 }, { state: 'GA', orders: 5 },
                    { state: 'NC', orders: 4 }, { state: 'PA', orders: 3 }, { state: 'VA', orders: 3 },
                  ]}
                  layout="vertical"
                  margin={{ left: 10, right: 30, top: 5, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  <YAxis dataKey="state" type="category" interval={demo ? 0 : undefined} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} width={demo ? 96 : 30} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="orders" name="Orders" radius={[0, 4, 4, 0]} barSize={14}>
                    {(demo ? geographicStates : topStates.length > 0 ? topStates.slice(0, 15) : Array(15).fill({})).map((_: any, i: number) => (
                      <Cell key={i} fill={STATE_COLORS[i % STATE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">State Concentration</h3>
              <div className="space-y-3">
                {(demo ? demoConcentration : topStates.length > 0 ? topStates.slice(0, 10).map((s, i) => ({
                  label: s.state, count: s.orders, pct: ((s.orders / (m?.totalOrders || 1)) * 100).toFixed(1), width: (s.revenue / maxStateRevenue) * 100, color: STATE_COLORS[i]
                })) : []).map((row, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-gray-700 dark:text-gray-300">{row.label}</span>
                      <span className="text-gray-400">{row.count} orders — {row.pct}%</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${row.width}%`, backgroundColor: row.color }} />
                    </div>
                  </div>
                ))}
              </div>
              {demo && (
                <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700 grid grid-cols-2 gap-3 text-xs">
                  <div className="text-gray-500 dark:text-gray-400">Top 5 domestic states: <span className="font-bold text-gray-700 dark:text-gray-200">{`${((geography?.topFiveDomesticShare ?? 0) * 100).toFixed(1)}% of domestic orders`}</span></div>
                  <div className="text-gray-500 dark:text-gray-400">Countries: <span className="font-bold text-gray-700 dark:text-gray-200">{countryNames || 'None recorded'}</span></div>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* ── Tab: Traffic & Visibility ─────────────────────────── */}
      {activeTab === 'traffic' && (() => {
        const monthlyTraffic: Array<{ month: string; label: string; impressions: number; pageViews: number; ctr: number; conversionRate: number }> = m?.monthlyTraffic || [];
        const hasTrafficData = monthlyTraffic.length > 0 || (m?.impressions || 0) > 0;
        const totalImpressions = m?.impressions || 0;
        const totalPageViews = m?.pageViews || 0;
        const avgCtr = m?.ctr || 0;
        const avgConv = m?.conversionRate || 0;

        // Estimate listing views-to-sale conversion from sales + traffic
        const viewsToSale = totalPageViews > 0 && (m?.totalOrders || 0) > 0
          ? (((m?.totalOrders || 0) / totalPageViews) * 100).toFixed(2)
          : null;

        return (
          <div className="space-y-6">
            {!hasTrafficData && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-2xl p-4 flex items-start gap-3">
                <Eye size={18} className="text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-blue-800 dark:text-blue-300">No traffic data for this period</p>
                  <p className="text-xs text-blue-700 dark:text-blue-400">{demo ? 'No synthetic traffic is available for this reporting period.' : 'Traffic syncs from the eBay Analytics API when configured. Older periods may be empty until their history has been imported.'}</p>
                </div>
              </div>
            )}

            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Impressions', value: hasTrafficData ? totalImpressions.toLocaleString() : '—', sub: 'Search exposure' },
                { label: 'Total Page Views', value: hasTrafficData ? totalPageViews.toLocaleString() : '—', sub: 'Listing clicks' },
                { label: 'Click-Through Rate', value: hasTrafficData ? `${(avgCtr * 100).toFixed(2)}%` : '—', sub: 'Impressions → views' },
                { label: 'Listing Conversion', value: viewsToSale ? `${viewsToSale}%` : (hasTrafficData ? `${(avgConv * 100).toFixed(2)}%` : '—'), sub: 'Views → sales' },
              ].map(k => (
                <div key={k.label} className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                  <p className="text-[11px] font-bold uppercase text-gray-400 dark:text-gray-500 tracking-wider mb-1">{k.label}</p>
                  <p className="text-2xl font-black text-gray-900 dark:text-white">{k.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
                </div>
              ))}
            </div>

            {/* Impressions & Page Views over time */}
            {monthlyTraffic.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                  <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Monthly Impressions & Page Views</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={monthlyTraffic} margin={{ left: 10, right: 20, top: 5, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-30} textAnchor="end" height={45} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="impressions" name="Impressions" fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={16} opacity={0.85} />
                      <Line dataKey="pageViews" name="Page Views" stroke="#10B981" strokeWidth={2.5} dot={{ r: 3, fill: '#10B981' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                  <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">CTR & Conversion Rate Trend</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={monthlyTraffic.map(t => ({ ...t, ctrPct: parseFloat((t.ctr * 100).toFixed(2)), convPct: parseFloat((t.conversionRate * 100).toFixed(2)) }))} margin={{ left: 10, right: 20, top: 5, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-30} textAnchor="end" height={45} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `${v}%`} />
                      <Tooltip formatter={(v: any) => [`${v}%`, '']} />
                      <Line dataKey="ctrPct" name="CTR %" stroke="#8B5CF6" strokeWidth={2.5} dot={{ r: 3, fill: '#8B5CF6' }} />
                      <Line dataKey="convPct" name="Conv. Rate %" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 3, fill: '#F59E0B' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Funnel + insights */}
            {hasTrafficData && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                  <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-5">Listing Funnel</h3>
                  {[
                    { label: 'Impressions', value: totalImpressions, pct: 100, color: '#3B82F6' },
                    { label: 'Page Views', value: totalPageViews, pct: totalImpressions > 0 ? (totalPageViews / totalImpressions) * 100 : 0, color: '#10B981' },
                    { label: 'Sales', value: m?.totalOrders || 0, pct: totalImpressions > 0 ? ((m?.totalOrders || 0) / totalImpressions) * 100 : 0, color: '#F59E0B' },
                  ].map((row, i) => (
                    <div key={i} className="mb-4">
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="font-bold text-gray-700 dark:text-gray-200">{row.label}</span>
                        <span className="font-mono text-xs text-gray-500">{row.value.toLocaleString()} ({row.pct.toFixed(2)}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(row.pct, 100)}%`, backgroundColor: row.color }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                  <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Traffic Insights</h3>
                  <div className="space-y-3 text-sm">
                    {[
                      totalImpressions > 0 && avgCtr > 0 && { icon: '👁', text: demo ? `${(avgCtr * 100).toFixed(2)}% CTR across the synthetic reporting window` : `${(avgCtr * 100).toFixed(2)}% avg CTR — ${avgCtr > 0.03 ? 'above' : 'below'} typical eBay avg of ~3%` },
                      totalPageViews > 0 && viewsToSale && { icon: '🛒', text: `${viewsToSale}% of page views converted to a sale` },
                      totalImpressions > 0 && totalPageViews > 0 && { icon: '📊', text: `${((totalPageViews / totalImpressions) * 100).toFixed(1)}% of impressions led to a listing view` },
                      monthlyTraffic.length > 1 && (() => {
                        const peak = monthlyTraffic.reduce((a, b) => b.impressions > a.impressions ? b : a);
                        return { icon: '📈', text: `Peak traffic in ${peak.label}: ${peak.impressions.toLocaleString()} impressions` };
                      })(),
                    ].filter(Boolean).map((insight: any, i) => (
                      <div key={i} className="flex items-start gap-2 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                        <span>{insight.icon}</span>
                        <span className="text-gray-600 dark:text-gray-300 text-xs leading-relaxed">{insight.text}</span>
                      </div>
                    ))}
                    {!hasTrafficData && <p className="text-gray-400 text-xs">Traffic is still syncing from the eBay API.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Tab: Inventory & Supplier Analysis ───────────────── */}
      {activeTab === 'inventory-supplier' && (demo && !expenseData ? (
        <p className="text-sm text-gray-500 dark:text-gray-400" role="status">{demoFinanceError ? 'Inventory expenses could not be loaded. Refresh to try again.' : 'Loading inventory expenses…'}</p>
      ) : (
        <div className="space-y-6">
          {!expenseData?.hasExpenseData && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4 flex items-start gap-3">
              <span className="text-amber-500 text-lg">⚠️</span>
              <div>
                <p className="text-sm font-bold text-amber-800 dark:text-amber-300">{demo ? 'No recorded sample purchases' : 'No uploaded report data'}</p>
                <p className="text-xs text-amber-700 dark:text-amber-400">{demo ? 'There are no inventory expenses in this synthetic snapshot.' : <>Upload your <strong>Inventory Expenses PDF</strong> from Data Intake to show live data.</>}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Inventory Cost', value: `$${totalInventoryCost.toLocaleString()}`, sub: 'Recorded inventory purchases' },
              { label: 'Trips / Purchases', value: demo || expenseData?.hasExpenseData ? expenseData?.tripCount ?? '—' : '—', sub: 'Recorded inventory purchases' },
              { label: 'Avg Cost per Trip', value: expenseData?.tripCount ? money(totalInventoryCost / expenseData.tripCount) : '—', sub: 'Average spend' },
              { label: 'Largest Single Buy', value: expenseData?.largestPurchase ? money(expenseData.largestPurchase.amount) : '—', sub: expenseData?.largestPurchase?.vendor ?? 'No recorded purchases' },
            ].map(k => (
              <div key={k.label} className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <p className="text-[11px] font-bold uppercase text-gray-400 dark:text-gray-500 tracking-wider mb-1">{k.label}</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">{k.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Monthly Inventory Spend vs. Revenue</h3>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={invByMonth} margin={{ left: 10, right: 20, top: 5, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-30} textAnchor="end" height={45} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="inventoryCost" name="Inventory Cost" fill="#10B981" radius={[4, 4, 0, 0]} barSize={16} />
                  {invByMonth.some(d => d.revenue > 0) && (
                    <Line dataKey="revenue" name="Revenue" stroke="#3B82F6" strokeWidth={2.5} dot={{ r: 3, fill: '#3B82F6' }} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Supplier Share of Inventory Spend</h3>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={invByVendor} dataKey="total" nameKey="vendor" cx="50%" cy="50%" outerRadius={80} label={({ vendor, percent }) => `${demo ? vendor.replace(/^DEMO\s+/, '') : vendor.split("'")[0].split(' ')[0]} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                    {invByVendor.map((v, i) => <Cell key={i} fill={VENDOR_COLORS[v.vendor] || pieColors[i]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(0)}`, 'Spend']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-3">
                {invByVendor.map((v, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: VENDOR_COLORS[v.vendor] || pieColors[i] }} />
                      <span className="text-gray-600 dark:text-gray-300">{v.vendor}</span>
                    </div>
                    <span className="font-bold text-gray-700 dark:text-gray-200">${v.total.toLocaleString()} ({((v.total / totalInventoryCost) * 100).toFixed(1)}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* COGS ratio */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
            <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Inventory Cost-to-Revenue Ratio by Month</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={invByMonth.map(d => ({
                  ...d,
                  cogsRatio: d.revenue > 0 ? parseFloat(((d.inventoryCost / d.revenue) * 100).toFixed(1)) : 0,
                }))}
                margin={{ left: 10, right: 20, top: 5, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-30} textAnchor="end" height={45} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: any) => [`${v}%`, demo ? 'Purchases / Revenue' : 'COGS / Revenue']} />
                <Bar dataKey="cogsRatio" name={demo ? "Purchases / Revenue" : "COGS Ratio"} radius={[4, 4, 0, 0]} barSize={20}>
                  {invByMonth.map((d, i) => {
                    const ratio = d.revenue > 0 ? (d.inventoryCost / d.revenue) : 0;
                    return <Cell key={i} fill={ratio > 0.25 ? '#EF4444' : ratio > 0.18 ? '#F59E0B' : '#10B981'} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}

      {/* ── Tab: eBay Fees Analysis ───────────────────────────── */}
      {activeTab === 'ebay-fees' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total eBay Fees', value: `$${realTotalFees.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sub: m?.revenue ? `${((realTotalFees / m.revenue) * 100).toFixed(1)}% of gross` : 'from eBay Finances', color: 'text-rose-600' },
              { label: 'Fees / Order', value: `$${(m?.salesCount ? realTotalFees / m.salesCount : 0).toFixed(2)}`, sub: 'Average per sale' },
            ].map(k => (
              <div key={k.label} className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <p className="text-[11px] font-bold uppercase text-gray-400 dark:text-gray-500 tracking-wider mb-1">{k.label}</p>
                <p className={`text-2xl font-black ${k.color || 'text-gray-900 dark:text-white'}`}>{k.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Monthly eBay Fee Breakdown</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={feeMonths} margin={{ left: 10, right: 20, top: 5, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-30} textAnchor="end" height={45} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="finalValue" name="Final Value Fee" fill="#EF4444" stackId="fees" barSize={20} />
                  <Bar dataKey="perOrder" name="Per-Order Fee" fill="#F59E0B" stackId="fees" barSize={20} />
                  <Bar dataKey="flat" name={demo ? "Other Selling Fees" : "Flat Fees"} fill="#8B5CF6" stackId="fees" radius={[4, 4, 0, 0]} barSize={20} />
                  <Legend />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Fee Structure</h3>
              <div className="space-y-3 text-sm">
                {(demo ? [
                  { label: 'Final value fees', value: money(feeMonths.reduce((sum: number, month: { finalValue: number }) => sum + month.finalValue, 0)) },
                  { label: 'Per-order fees', value: money(feeMonths.reduce((sum: number, month: { perOrder: number }) => sum + month.perOrder, 0)) },
                  { label: 'Other selling fees', value: money(feeMonths.reduce((sum: number, month: { flat: number }) => sum + month.flat, 0)) },
                  { label: 'Total selling fees', value: money(realTotalFees) },
                ] : [
                  { label: 'Fee type "-fee-1"', value: 'Final value fees' },
                  { label: 'Fee type "-fee-2"', value: 'Per-order fees' },
                  { label: 'Other fee types', value: 'Store/insertion fees' },
                  { label: 'Total est. entries', value: 'Varies by report' },
                ]).map(r => (
                  <div key={r.label} className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <span className="text-gray-500 dark:text-gray-400 text-xs">{r.label}</span>
                    <span className="font-bold text-gray-700 dark:text-gray-200 text-xs">{r.value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-900/20 rounded-xl border border-rose-100 dark:border-rose-800">
                <p className="text-xs text-rose-700 dark:text-rose-300 font-medium">Compare recorded fees and inventory costs with revenue. Include shipping and operating expenses before interpreting net margin.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Cross-Reference Findings ────────────────────── */}
      {activeTab === 'findings' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Illustrative analysis prompts for comparing sales, inventory, and fee data.</p>
          {CROSS_REF_FINDINGS.map((f, i) => {
            const borderColor = f.type === 'success' ? 'border-l-emerald-500' : f.type === 'warning' ? 'border-l-amber-500' : f.type === 'alert' ? 'border-l-red-500' : 'border-l-blue-500';
            const bg = f.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/10' : f.type === 'warning' ? 'bg-amber-50 dark:bg-amber-900/10' : f.type === 'alert' ? 'bg-red-50 dark:bg-red-900/10' : 'bg-white dark:bg-gray-800';
            return (
              <div key={i} className={`${bg} border border-gray-100 dark:border-gray-700 border-l-4 ${borderColor} rounded-2xl p-5 flex gap-4`}>
                <div className="text-2xl flex-shrink-0 mt-0.5">{f.icon}</div>
                <div>
                  <h4 className="font-bold text-gray-900 dark:text-white text-sm mb-1">{f.title}</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{f.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Tab: Profitability Summary ────────────────────────── */}
      {activeTab === 'profitability' && (
        <div className="space-y-6">
          {demo && !demoCash && <p className="text-sm text-gray-500 dark:text-gray-400" role="status">{demoFinanceError ? 'The cash breakdown could not be loaded. Refresh to try again.' : 'Loading reconciled cash breakdown…'}</p>}
          {(!demo || demoCash) && <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Gross Revenue', value: `$${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'text-emerald-600', sub: 'Selected reporting period' },
              { label: demo ? 'Inventory Purchases' : 'Total COGS', value: `$${totalInventoryCost.toLocaleString()}`, color: 'text-red-500', sub: demo ? 'Cash spent on stock' : 'Junkyard purchases' },
              { label: 'eBay Fees', value: `$${totalFees.toLocaleString()}`, color: 'text-rose-600', sub: 'Recorded marketplace fees' },
              { label: demo ? 'Cash After Expenses' : 'Est. Net Profit', value: demo ? (demoCash ? money(demoCash.cashAfterExpenses) : '—') : `$${Math.round(estProfit).toLocaleString()}`, color: 'text-blue-600', sub: demo ? 'After purchases and recorded overhead' : 'Before tax & overhead' },
            ].map(k => (
              <div key={k.label} className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <p className="text-[11px] font-bold uppercase text-gray-400 dark:text-gray-500 tracking-wider mb-1">{k.label}</p>
                <p className={`text-2xl font-black ${k.color}`}>{k.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">{demo ? `Cash Breakdown · ${demoPeriodLabel}` : 'Annual P&L Breakdown'}</h3>
              <div className="space-y-1">
                {(demo ? (demoCash ? [
                  { label: 'Gross Revenue (items + shipping)', value: `+ ${money(demoCash.grossRevenue)}`, green: true },
                  { label: 'eBay Selling Fees', value: `− ${money(demoCash.marketplaceFees)}`, green: false },
                  { label: 'Refunds', value: `− ${money(demoCash.refunds)}`, green: false },
                  { label: 'Postage / Shipping Labels', value: `− ${money(demoCash.postage)}`, green: false },
                  { label: 'Advertising', value: `− ${money(demoCash.advertising)}`, green: false },
                  { label: 'Other Ledger Costs / Credits', value: `${demoCash.otherLedgerCosts < 0 ? '+' : '−'} ${money(Math.abs(demoCash.otherLedgerCosts))}`, green: demoCash.otherLedgerCosts < 0 },
                  { label: 'Inventory Purchases', value: `− ${money(demoCash.inventoryPurchases)}`, green: false },
                  { label: 'Recorded Operating Expenses', value: `− ${money(demoCash.operatingExpenses)}`, green: false },
                ] : []) : [
                  { label: 'Gross Revenue (parts sold)', value: `+ $${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, green: true },
                  { label: 'Shipping Revenue Collected', value: `+ $${totalShipping.toLocaleString()}`, green: true },
                  { label: 'Cost of Inventory (COGS)', value: `− $${totalInventoryCost.toLocaleString()}`, red: true },
                  { label: 'eBay Selling Fees (est.)', value: `− $${totalFees.toLocaleString()}`, red: true },
                  { label: 'Shipping Costs (not yet recorded)', value: `− $${shippingCost.toLocaleString()}`, red: true },
                ]).map((row, i) => (
                  <div key={i} className={`flex justify-between py-2.5 border-b border-gray-100 dark:border-gray-700 text-sm ${i === 4 ? 'border-0' : ''}`}>
                    <span className="text-gray-600 dark:text-gray-400">{row.label}</span>
                    <span className={`font-bold ${row.green ? 'text-emerald-600' : 'text-red-500'}`}>{row.value}</span>
                  </div>
                ))}
                <div className="flex justify-between py-3 mt-2 border-t-2 border-gray-300 dark:border-gray-500 text-base">
                  <span className="font-black text-gray-900 dark:text-white">{demo ? 'Cash After Recorded Expenses' : 'Estimated Net Profit (before tax)'}</span>
                  <span className="font-black text-blue-600 text-xl">{demo ? (demoCash ? money(demoCash.cashAfterExpenses) : '—') : `~$${Math.round(estProfit).toLocaleString()}`}</span>
                </div>
                <p className="text-xs text-gray-400 mt-3">{demo ? 'Cash view: settlement less inventory purchases and recorded operating expenses. Inventory purchases are not matched to sold units, so this is not accounting net profit. Taxes and any unrecorded overhead are excluded.' : '* Excludes business overhead (phone, tools, gas/mileage, eBay store subscription). Actual net profit will be lower once all operating costs are accounted for.'}</p>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">{demo ? 'Gross Receipts Allocation' : 'Cost Composition'}</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={demo ? demoCostComposition : [
                      { name: 'Net Profit', value: Math.max(0, estProfit) },
                      { name: 'Inventory COGS', value: totalInventoryCost },
                      { name: 'eBay Fees', value: totalFees },
                      { name: 'Shipping Costs', value: shippingCost },
                    ]}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                    fontSize={11}
                  >
                    {(demo ? demoCostComposition : [{}, {}, {}, {}]).map((_, index) => <Cell key={index} fill={(demo ? pieColors : ['#3B82F6', '#10B981', '#EF4444', '#F59E0B'])[index % pieColors.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(0)}`, '']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          </>}
        </div>
      )}

      {/* ── Tab: Advertising (Promoted Listings) ─────────────── */}
      {activeTab === 'advertising' && (demo && !adData ? (
        <p className="text-sm text-gray-500 dark:text-gray-400" role="status">{demoFinanceError ? 'Advertising data could not be loaded. Refresh to try again.' : 'Loading advertising data…'}</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Ad spend', value: `$${(adData?.spend ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'text-rose-600' },
              { label: 'Attributed sales', value: `$${(adData?.attributedSales ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'text-emerald-600' },
              { label: 'ROAS', value: `${(adData?.roas ?? 0).toFixed(2)}×`, color: 'text-amber-600' },
              { label: 'ACOS', value: `${((adData?.acos ?? 0) * 100).toFixed(0)}%`, color: 'text-gray-900 dark:text-white' },
              { label: 'CPS / CPC spend', value: `$${(adData?.cpsSpend ?? 0).toFixed(0)} / $${(adData?.cpcSpend ?? 0).toFixed(0)}`, color: 'text-gray-900 dark:text-white' },
              { label: 'Running campaigns', value: `${adData?.runningCampaigns ?? 0}`, color: 'text-blue-600' },
            ].map(k => (
              <div key={k.label} className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <p className="text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500 tracking-wider mb-1">{k.label}</p>
                <p className={`text-xl font-black ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          {(adData?.rosterOnly?.length ?? 0) > 0 && (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-800">
              <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                {adData.rosterOnly.length} running campaign{adData.rosterOnly.length === 1 ? '' : 's'} {adData.rosterOnly.length === 1 ? 'has' : 'have'} {demo ? 'no performance rows in this synthetic snapshot.' : 'no uploaded performance data — upload the latest Promoted Listings report from Seller Hub.'}
              </p>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
            <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Spend &amp; ROAS by report window</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={(adData?.byWindow ?? []).map((w: any) => ({
                label: new Date(w.reportStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(demo ? { timeZone: 'UTC' } : {}) }),
                spend: w.spend,
                roas: Number((w.roas ?? 0).toFixed(2)),
              }))} margin={{ left: 10, right: 20, top: 5, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-30} textAnchor="end" height={45} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${v}`} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `${v}×`} />
                <Tooltip content={<CustomTooltip />} />
                <Bar yAxisId="left" dataKey="spend" name="Ad spend" fill="#EF4444" radius={[4, 4, 0, 0]} barSize={22} />
                <Line yAxisId="right" dataKey="roas" name="ROAS" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} />
                <Legend />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">Campaigns</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  <tr>
                    <th className="text-left p-3">Campaign</th>
                    <th className="text-left p-3">Model</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-right p-3">Daily budget</th>
                    <th className="text-right p-3">Impr.</th>
                    <th className="text-right p-3">Clicks</th>
                    <th className="text-right p-3">CTR</th>
                    <th className="text-right p-3">Spend</th>
                    <th className="text-right p-3">Sales</th>
                    <th className="text-right p-3">ROAS</th>
                    <th className="text-right p-3">ACOS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {(adData?.byCampaign ?? []).length === 0 && (
                    <tr><td colSpan={11} className="p-8 text-center text-gray-400 dark:text-gray-500">{demo ? 'No synthetic campaigns in this snapshot.' : 'No campaigns synced yet. The roster syncs on the daily tick.'}</td></tr>
                  )}
                  {(adData?.byCampaign ?? []).map((row: any) => (
                    <tr key={row.campaignId}>
                      <td className="p-3 max-w-[220px]"><p className="truncate text-gray-800 dark:text-gray-200">{row.campaignName}</p></td>
                      <td className="p-3">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${row.fundingModel === 'CPS' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : row.fundingModel === 'CPC' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>{row.fundingModel}</span>
                      </td>
                      <td className="p-3 text-gray-500 dark:text-gray-400">{row.status ?? '—'}</td>
                      <td className="p-3 text-right font-mono text-gray-500 dark:text-gray-400">{row.dailyBudget != null ? `$${row.dailyBudget}` : '—'}</td>
                      {row.hasReportData ? (
                        <>
                          <td className="p-3 text-right font-mono">{row.impressions.toLocaleString()}</td>
                          <td className="p-3 text-right font-mono">{row.clicks.toLocaleString()}</td>
                          <td className="p-3 text-right font-mono">{(row.ctr * 100).toFixed(2)}%</td>
                          <td className="p-3 text-right font-mono text-rose-600">${row.spend.toFixed(2)}</td>
                          <td className="p-3 text-right font-mono text-emerald-600">${row.attributedSales.toFixed(2)}</td>
                          <td className="p-3 text-right font-semibold">{row.roas.toFixed(2)}×</td>
                          <td className="p-3 text-right font-mono">{(row.acos * 100).toFixed(0)}%</td>
                        </>
                      ) : (
                        <td colSpan={7} className="p-3 text-center text-[11px] text-gray-400 dark:text-gray-500 italic">{demo ? 'No performance rows in this synthetic snapshot.' : 'no report data — upload the Promoted Listings CSV'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Top listings by ROAS</h3>
              <div className="space-y-2">
                {(adData?.winners ?? []).length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500">No attributed sales in this window.</p>}
                {(adData?.winners ?? []).map((l: any) => (
                  <div key={l.listingId} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                    <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">{l.title}</span>
                    <span className="text-xs font-mono text-emerald-600">${l.attributedSales.toFixed(0)}</span>
                    <span className="text-xs font-semibold text-amber-600 w-14 text-right">{l.roas.toFixed(2)}×</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Spend without attributed sales</h3>
              <div className="space-y-2">
                {(adData?.losers ?? []).length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500">No wasted spend detected in this window.</p>}
                {(adData?.losers ?? []).map((l: any) => (
                  <div key={l.listingId} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                    <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">{l.title}</span>
                    <span className="text-xs text-gray-400">{l.clicks} clicks</span>
                    <span className="text-xs font-mono text-rose-600 w-14 text-right">${l.spend.toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800">
            <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
              {demo ? 'Synthetic campaign performance for the fixed demo snapshot. Advertising spend reconciles to the same fictional finance ledger shown in Profit & Ads. No live eBay account is connected.' : <>Performance is uploaded from Seller Hub&apos;s Promoted Listings report — upload the latest to refresh it. The campaign list is live from eBay. The authoritative ad-spend figure is the Promoted Listings line on Profit &amp; Ads (the finance ledger), which can differ from the report by timing. Figures here are listing-level only.</>}
            </p>
          </div>
        </div>
      ))}

      {/* ── Tab: Gaps & Recommendations ──────────────────────── */}
      {activeTab === 'recommendations' && (
        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="text-base">📁</span> Data Gaps
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {GAPS_AND_RECS.gaps.map((g, i) => (
                <div key={i} className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 border-l-4 border-l-gray-300 dark:border-l-gray-500 rounded-2xl p-5">
                  <div className="text-2xl mb-2">{g.icon}</div>
                  <h4 className="font-bold text-gray-900 dark:text-white text-sm mb-2">{g.title}</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{g.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="text-base">🎯</span> Recommendations
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {GAPS_AND_RECS.recs.map((r, i) => (
                <div key={i} className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 border-l-4 border-l-emerald-500 rounded-2xl p-5">
                  <div className="text-2xl mb-2">{r.icon}</div>
                  <h4 className="font-bold text-gray-900 dark:text-white text-sm mb-2">{r.title}</h4>
                  <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{r.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Dynamic live insights if data available */}
          {m?.totalOrders && m.totalOrders > 0 && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-2xl p-6">
              <h3 className="text-sm font-black text-blue-800 dark:text-blue-300 uppercase tracking-wider mb-3">Live Data Insights</h3>
              <ul className="space-y-2">
                {m.salesInsights?.map((insight: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-blue-700 dark:text-blue-300">
                    <span className="text-blue-400 mt-0.5 flex-shrink-0">→</span>
                    {insight}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
