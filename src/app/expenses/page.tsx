'use client';

import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_DATE } from '@/lib/demo/config';
import { DEMO_OPERATION_DISABLED, demoExpenseFeeMonths, type DemoExpenseMetrics } from '@/lib/demo/operational-presentation';

import { storeFetch } from '@/lib/stores/browser';

import { useState, useEffect, useCallback } from 'react';
import {
  Receipt, Package, ShoppingCart, Wrench, Car, Smartphone,
  Building2, MoreHorizontal, Plus, Trash2, Loader2, DollarSign,
  TrendingDown, BarChart3,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

// ── Types ───────────────────────────────────────────────────────────────
interface GeneralExpense {
  id: number;
  date: string;
  category: string;
  amount: number;
  description: string | null;
  vendor: string | null;
}

interface GeneralExpensesData {
  expenses: GeneralExpense[];
  byCategory: Array<{ category: string; total: number }>;
  byMonth: Array<{ month: string; amount: number }>;
  total: number;
}

interface COGSData {
  invByMonth: Array<{ month: string; amount: number }>;
  invByVendor: Array<{ vendor: string; total: number }>;
  feesByMonth: Array<{ month: string; finalValue: number; perOrder: number; flat: number; total: number }>;
  totalInventoryCost: number;
  totalFees: number;
  tripCount: number;
  hasExpenseData: boolean;
  hasFeeData: boolean;
}

// ── Config ──────────────────────────────────────────────────────────────
const EXPENSE_CATEGORIES = [
  { id: 'office-supplies', label: 'Office Supplies', icon: ShoppingCart, color: '#3B82F6' },
  { id: 'shipping-supplies', label: 'Shipping Supplies', icon: Package, color: '#10B981' },
  { id: 'vehicle', label: 'Vehicle / Gas / Mileage', icon: Car, color: '#F59E0B' },
  { id: 'tools', label: 'Tools & Equipment', icon: Wrench, color: '#8B5CF6' },
  { id: 'ebay-store', label: 'eBay Store / Subscription', icon: Building2, color: '#EF4444' },
  { id: 'phone-internet', label: 'Phone / Internet', icon: Smartphone, color: '#06B6D4' },
  { id: 'other', label: 'Other', icon: MoreHorizontal, color: '#9CA3AF' },
];

const CATEGORY_MAP = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.id, c]));

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'cogs', label: 'Cost of Goods', icon: Package },
  { id: 'operating', label: 'Operating Expenses', icon: Receipt },
  { id: 'fees', label: 'eBay Fees', icon: DollarSign },
];

const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4', '#9CA3AF', '#F97316', '#EC4899'];

const VENDOR_COLORS: Record<string, string> = {
  'Yard A': '#3B82F6',
  'Yard B': '#10B981',
  'Yard C': '#F59E0B',
};

function fmtMonth(ym: string) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs shadow-xl">
      <p className="text-gray-300 font-medium mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || p.fill }}>
          {p.name}: ${Number(p.value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </p>
      ))}
    </div>
  );
};

// ── Add Expense Form ─────────────────────────────────────────────────────
function AddExpenseForm({ onSaved }: { onSaved: () => void }) {
  const demo = useDemoMode();
  const [form, setForm] = useState({ date: demo ? DEMO_DATE : new Date().toISOString().substring(0, 10), category: 'office-supplies', amount: '', description: '', vendor: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (demo) return;
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Amount must be greater than 0'); return; }
    setSaving(true); setError('');
    const res = await storeFetch('/api/general-expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) { setForm(f => ({ ...f, amount: '', description: '', vendor: '' })); onSaved(); }
    else setError('Failed to save. Try again.');
  }

  return (
    <form onSubmit={submit} className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
      <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
        <Plus size={14} /> Add Expense
      </h3>
      <fieldset disabled={demo} title={demo ? DEMO_OPERATION_DISABLED : undefined} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="mt-1 w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Category</label>
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            className="mt-1 w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Amount ($)</label>
          <input type="number" step="0.01" min="0" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            className="mt-1 w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Vendor / Store</label>
          <input type="text" placeholder="e.g. Staples, Amazon" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
            className="mt-1 w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</label>
          <input type="text" placeholder="e.g. Printer paper, poly mailers" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="mt-1 w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </fieldset>
      {demo && <p className="mt-3 text-xs text-amber-600 dark:text-amber-300">Adding and deleting expenses are disabled in this read-only demo.</p>}
      {error && <p className="mt-2 text-xs text-red-500 font-medium">{error}</p>}
      <button type="submit" disabled={demo || saving} title={demo ? DEMO_OPERATION_DISABLED : undefined}
        className="mt-4 flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        {saving ? 'Saving…' : 'Add Expense'}
      </button>
    </form>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────
export default function ExpensesPage() {
  const demo = useDemoMode();
  const [activeTab, setActiveTab] = useState('overview');
  const [cogs, setCogs] = useState<COGSData | null>(null);
  const [genData, setGenData] = useState<GeneralExpensesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [demoMetrics, setDemoMetrics] = useState<DemoExpenseMetrics | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const read = (url: string) => storeFetch(url).then(r => demo && !r.ok ? null : r.json()).catch(() => null);
    const [cogsRes, genRes, metricsRes] = await Promise.all([
      read('/api/expenses'), read('/api/general-expenses'),
      demo ? read('/api/metrics') : Promise.resolve(null),
    ]);
    if (demo) setDemoMetrics(metricsRes?.metrics ?? null);
    setCogs(cogsRes);
    setGenData(genRes);
    setLoading(false);
  }, [demo]);

  useEffect(() => { load(); }, [load]);

  async function deleteExpense(id: number) {
    if (demo) return;
    setDeletingId(id);
    await storeFetch(`/api/general-expenses?id=${id}`, { method: 'DELETE' });
    setDeletingId(null);
    load();
  }

  // Derived values
  const totalCOGS = cogs?.totalInventoryCost || 0;
  const totalFees = demo ? demoMetrics?.ebayFees ?? 0 : cogs?.totalFees || 0;
  const totalOpEx = genData?.total || 0;
  const totalExpenses = demo
    ? (Math.round(totalCOGS * 100) + Math.round(totalFees * 100) + Math.round(totalOpEx * 100)) / 100
    : totalCOGS + totalFees + totalOpEx;
  const purchaseLabel = demo ? 'Inventory Purchases' : 'Cost of Goods';
  const tripCount = cogs?.tripCount ?? 0;
  const revenue = demoMetrics?.revenue ?? 0;
  const orderCount = demoMetrics?.totalOrders ?? 0;

  const invByMonth = (cogs?.invByMonth || [])
    .map(d => ({ ...d, label: fmtMonth(d.month) }));
  const feesByMonth = (demo ? (demoMetrics ? demoExpenseFeeMonths(demoMetrics) : []) : cogs?.feesByMonth || [])
    .map(d => ({ ...d, label: fmtMonth(d.month) }));
  const invByVendor = cogs?.invByVendor || [];

  // Merge COGS + fees + opex by month for overview
  const allMonthsSet = new Set([
    ...invByMonth.map(d => d.month),
    ...feesByMonth.map(d => d.month),
    ...(genData?.byMonth || []).map(d => d.month),
  ]);
  const overviewByMonth = Array.from(allMonthsSet).sort().map(month => {
    const cogs_ = invByMonth.find(d => d.month === month)?.amount || 0;
    const fees = feesByMonth.find(d => d.month === month)?.total || 0;
    const opex = genData?.byMonth.find(d => d.month === month)?.amount || 0;
    return { month, label: fmtMonth(month), cogs: cogs_, fees, opex, total: cogs_ + fees + opex };
  });

  // Pie data for expense composition
  const pieData = [
    { name: purchaseLabel, value: totalCOGS },
    { name: 'eBay Fees', value: totalFees },
    ...(genData?.byCategory || []).map(c => ({ name: CATEGORY_MAP[c.category]?.label || c.category, value: c.total })),
  ].filter(d => d.value > 0);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  if (demo && (!cogs || !genData || !demoMetrics)) {
    return (
      <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
        <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">Expenses</h1>
        <p role="alert" className="text-sm text-amber-600 dark:text-amber-300">The synthetic expense ledger could not be loaded. Totals are unavailable.</p>
        <button onClick={load} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold">Retry expense data</button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">Expenses</h1>
          <p className="text-gray-500 font-mono text-xs uppercase tracking-widest mt-1">{demo ? 'Inventory Purchases · Operating Costs · eBay Selling Fees' : 'Cost of Goods · Operating Costs · eBay Fees'}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 px-4 py-2 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center gap-2">
          <TrendingDown className="text-red-500" size={16} />
          <span className="text-xs font-bold text-gray-600 dark:text-gray-300">
            ${totalExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })} {demo ? 'recorded expense subtotal' : 'total expenses'}
          </span>
        </div>
      </div>

      {demo && <p className="text-xs text-gray-500 dark:text-gray-400">Synthetic snapshot as of {DEMO_DATE}. Inventory purchases include replenishment and are not accounting COGS. This subtotal covers purchases, selling fees, and operating expenses; postage, advertising, refunds, and other settlement charges appear in Profit &amp; Ads.</p>}

      {/* Tab Bar */}
      <div className="flex flex-wrap gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl transition-all duration-150 ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-white/50 dark:hover:bg-gray-700/50'
              }`}>
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Overview ──────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: demo ? 'Inventory Purchases' : 'Total Cost of Goods', value: `$${totalCOGS.toLocaleString()}`, sub: demo ? 'Recorded restocking purchases' : 'Junkyard purchases', color: 'text-blue-600' },
              { label: 'eBay Fees', value: `$${totalFees.toLocaleString()}`, sub: 'Recorded marketplace fees', color: 'text-rose-600' },
              { label: 'Operating Expenses', value: totalOpEx > 0 ? `$${totalOpEx.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—', sub: 'Office, vehicle, tools…', color: 'text-amber-600' },
              { label: demo ? 'Recorded Expense Subtotal' : 'Total Expenses', value: `$${totalExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sub: demo ? 'Purchases, selling fees, operating costs' : 'All expense categories', color: 'text-gray-900 dark:text-white' },
            ].map(k => (
              <div key={k.label} className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <p className="text-[11px] font-bold uppercase text-gray-400 dark:text-gray-500 tracking-wider mb-1">{k.label}</p>
                <p className={`text-2xl font-black ${k.color}`}>{k.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly stacked expenses */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Monthly Expenses by Type</h3>
              {overviewByMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={overviewByMonth} margin={{ left: 10, right: 20, top: 5, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-30} textAnchor="end" height={45} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="cogs" name={purchaseLabel} fill="#3B82F6" stackId="exp" barSize={20} />
                    <Bar dataKey="fees" name="eBay Fees" fill="#EF4444" stackId="exp" barSize={20} />
                    <Bar dataKey="opex" name="Operating" fill="#F59E0B" stackId="exp" radius={[4, 4, 0, 0]} barSize={20} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">No data yet</div>
              )}
            </div>

            {/* Composition pie */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Expense Composition</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                    label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false} fontSize={11}>
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, '']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {pieData.map((d, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-gray-600 dark:text-gray-300">{d.name}</span>
                    </div>
                    <span className="font-bold text-gray-700 dark:text-gray-200">
                      ${d.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({((d.value / totalExpenses) * 100).toFixed(1)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Cost of Goods ──────────────────────────────────────────── */}
      {activeTab === 'cogs' && (
        <div className="space-y-6">
          {!cogs?.hasExpenseData && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4 flex items-start gap-3">
              <span className="text-amber-500 text-lg">⚠️</span>
              <div>
                <p className="text-sm font-bold text-amber-800 dark:text-amber-300">No uploaded report data</p>
                <p className="text-xs text-amber-700 dark:text-amber-400">Upload your <strong>Inventory Expenses PDF</strong> from Data Intake to show live data.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: demo ? 'Inventory Purchases' : 'Total COGS', value: `$${totalCOGS.toLocaleString()}`, sub: 'Recorded inventory purchases' },
              { label: 'Trips / Purchases', value: demo ? tripCount : cogs?.hasExpenseData ? cogs.tripCount : '—', sub: demo ? 'Recorded purchase entries' : 'Individual acquisitions' },
              { label: 'Avg Cost / Trip', value: demo ? (tripCount > 0 ? `$${(totalCOGS / tripCount).toFixed(2)}` : '—') : (cogs?.hasExpenseData && cogs.tripCount ? `$${(totalCOGS / cogs.tripCount).toFixed(2)}` : '—'), sub: 'Average spend' },
              // Revenue is only loaded with the demo ledger; ordinary mode omits this card.
              ...(demo ? [{ label: 'Purchases / Revenue', value: revenue > 0 ? `${((totalCOGS / revenue) * 100).toFixed(1)}%` : '—', sub: 'vs ledger gross revenue (items + shipping)' }] : []),
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
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Monthly Inventory Spend</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={invByMonth} margin={{ left: 10, right: 20, top: 5, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-30} textAnchor="end" height={45} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="amount" name={demo ? "Inventory Purchases" : "COGS"} fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Supplier Share</h3>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={invByVendor} dataKey="total" nameKey="vendor" cx="50%" cy="50%" outerRadius={70}
                    label={({ vendor, percent }: any) => `${vendor.split("'")[0].split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false} fontSize={11}>
                    {invByVendor.map((v, i) => <Cell key={i} fill={VENDOR_COLORS[v.vendor] || PIE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'Spend']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-3">
                {invByVendor.map((v, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: VENDOR_COLORS[v.vendor] || PIE_COLORS[i] }} />
                      <span className="text-gray-600 dark:text-gray-300">{v.vendor}</span>
                    </div>
                    <span className="font-bold text-gray-700 dark:text-gray-200">
                      ${v.total.toLocaleString()} ({(totalCOGS > 0 ? (v.total / totalCOGS) * 100 : 0).toFixed(1)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Operating Expenses ─────────────────────────────────────── */}
      {activeTab === 'operating' && (
        <div className="space-y-6">
          {/* Category KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {EXPENSE_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const total = genData?.byCategory.find(c => c.category === cat.id)?.total || 0;
              return (
                <div key={cat.id} className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: cat.color + '20' }}>
                      <Icon size={14} style={{ color: cat.color }} />
                    </div>
                    <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider leading-tight">{cat.label}</p>
                  </div>
                  <p className="text-xl font-black text-gray-900 dark:text-white">
                    {total > 0 ? `$${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Add form */}
          <AddExpenseForm onSaved={load} />

          {/* Monthly trend + table */}
          {(genData?.byMonth || []).length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Monthly Operating Expenses</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={genData!.byMonth.map(d => ({ ...d, label: fmtMonth(d.month) }))} margin={{ left: 10, right: 20, top: 5, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-30} textAnchor="end" height={45} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="amount" name="Operating Expenses" fill="#F59E0B" radius={[4, 4, 0, 0]} barSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">By Category</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={genData!.byCategory.map(c => ({ ...c, name: CATEGORY_MAP[c.category]?.label || c.category }))}
                      dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                      label={({ name, percent }: any) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false} fontSize={11}>
                      {genData!.byCategory.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, '']} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Expense log table */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">Expense Log</h3>
            </div>
            {(genData?.expenses || []).length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Receipt size={28} className="text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-gray-400 font-medium">No operating expenses recorded yet.</p>
                <p className="text-xs text-gray-400 mt-1">Use the form above to add expenses.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700">
                      <th className="text-left py-3 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Date</th>
                      <th className="text-left py-3 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Category</th>
                      <th className="text-left py-3 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Description</th>
                      <th className="text-left py-3 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Vendor</th>
                      <th className="text-right py-3 px-4 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Amount</th>
                      <th className="py-3 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {(genData?.expenses || []).map(exp => {
                      const cat = CATEGORY_MAP[exp.category];
                      const Icon = cat?.icon || MoreHorizontal;
                      return (
                        <tr key={exp.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                          <td className="py-3 px-4 text-gray-500 dark:text-gray-400 font-mono text-xs whitespace-nowrap">
                            {new Date(exp.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(demo ? { timeZone: 'UTC' } : {}) })}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (cat?.color || '#9CA3AF') + '20' }}>
                                <Icon size={12} style={{ color: cat?.color || '#9CA3AF' }} />
                              </div>
                              <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">{cat?.label || exp.category}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-gray-600 dark:text-gray-300 text-xs max-w-xs truncate">{exp.description || '—'}</td>
                          <td className="py-3 px-4 text-gray-500 dark:text-gray-400 text-xs">{exp.vendor || '—'}</td>
                          <td className="py-3 px-4 text-right font-bold text-gray-800 dark:text-gray-200 whitespace-nowrap">
                            ${exp.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4">
                            <button onClick={() => deleteExpense(exp.id)} disabled={demo || deletingId === exp.id}
                              title={demo ? DEMO_OPERATION_DISABLED : undefined}
                              aria-label={`Delete expense ${exp.description || exp.id}`}
                              className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 transition-colors">
                              {deletingId === exp.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 dark:bg-gray-700/40 border-t-2 border-gray-200 dark:border-gray-600">
                      <td colSpan={4} className="py-3 px-4 text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total</td>
                      <td className="py-3 px-4 text-right font-black text-gray-900 dark:text-white">
                        ${(genData?.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── eBay Fees ──────────────────────────────────────────────── */}
      {activeTab === 'fees' && (
        <div className="space-y-6">
          {!cogs?.hasFeeData && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4 flex items-start gap-3">
              <span className="text-amber-500 text-lg">⚠️</span>
              <div>
                <p className="text-sm font-bold text-amber-800 dark:text-amber-300">No uploaded report data</p>
                <p className="text-xs text-amber-700 dark:text-amber-400">Upload your <strong>eBay Fees PDF</strong> from Data Intake to show live data.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total eBay Fees', value: `$${totalFees.toLocaleString()}`, sub: 'Recorded marketplace fees', color: 'text-rose-600' },
              // Revenue and order count are only loaded with the demo ledger; ordinary
              // mode shows the fee figures it can compute from uploaded fee reports.
              ...(demo ? [{ label: 'Selling Fee Rate', value: revenue > 0 ? `${(totalFees / revenue * 100).toFixed(1)}%` : '—', sub: 'Selling fees / ledger gross revenue' }] : []),
              { label: 'Final Value Fees', value: `$${(feesByMonth.reduce((sum, month) => sum + Math.round(month.finalValue * 100), 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, sub: demo ? 'Variable fees from the same ledger' : 'From uploaded fee reports' },
              ...(demo ? [{ label: 'Fees / Order', value: orderCount > 0 ? `$${(totalFees / orderCount).toFixed(2)}` : '—', sub: `${orderCount.toLocaleString()} recorded orders` }] : []),
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
                <BarChart data={feesByMonth} margin={{ left: 10, right: 20, top: 5, bottom: 20 }}>
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
                  { label: 'Variable final value fees', value: 'SALE ledger fees' },
                  { label: 'Per-order fees', value: 'Fixed SALE fees' },
                  { label: 'Other selling fees', value: 'International / regulatory' },
                  { label: 'Recorded order count', value: orderCount.toLocaleString() },
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
    </div>
  );
}
