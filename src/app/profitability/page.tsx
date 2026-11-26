'use client';

import { useDemoMode } from '@/components/DemoProvider';

import { storeFetch } from '@/lib/stores/browser';

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, BadgeDollarSign, Loader2, Megaphone, MousePointerClick, ReceiptText } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import StoreLink from '@/components/StoreLink';

type Listing = { itemId: string; title: string; campaignName: string; status: string | null; fundingModel: string; impressions: number; clicks: number; sold: number; sales: number; fees: number; roas: number; acos: number; ctr: number; conversionRate: number };
type Campaign = { campaignId: string; name: string; status: string | null; fundingModel: string; dailyBudget: number | null; impressions: number; clicks: number; sold: number; sales: number; fees: number; ctr: number; conversionRate: number; roas: number; acos: number };
type Analytics = {
  reportRange: { start: string; end: string } | null;
  transactionRange: { start: string; end: string } | null;
  financeCoverageStart: string | null;
  financials: { grossRevenue: number; grossOfFees: number; ebayFees: number; refunds: number; netRevenue: number; orderRevenue: number; netPayout: number; totalDeductions: number; finalValueFees: number; regulatoryFees: number; penaltyFees: number; internationalFees: number; shippingLabels: number; adFees: number; otherFees: number; feeRate: number; orders: number };
  advertising: { impressions: number; clicks: number; orders: number; sales: number; spend: number; roas: number; ctr: number; conversionRate: number };
  campaigns: Campaign[];
  actions: { wasted: Listing[]; winners: Listing[] };
};

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const number = (value: number) => value.toLocaleString('en-US');
const date = (value: string, demo: boolean) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(demo ? { timeZone: 'UTC' } : {}) });

export default function ProfitabilityPage() {
  const demo = useDemoMode();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    storeFetch('/api/profitability').then(async response => {
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to load analysis');
      return response.json();
    }).then(setData).catch(error => setError(error.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-full flex items-center justify-center text-slate-500 text-sm gap-2"><Loader2 size={16} className="animate-spin" />Building profitability view…</div>;
  if (error) return <div className="max-w-xl mx-auto mt-20 border border-red-900 bg-red-950/30 rounded-xl p-5 text-red-300">{error}</div>;
  if (!data) return null;

  const hasFinance = data.financials.grossRevenue > 0 || data.financials.refunds > 0;
  const hasTransactions = data.financials.orders > 0 || hasFinance;
  const hasAds = data.reportRange !== null;
  const feeChart = [
    { name: 'Final value', amount: data.financials.finalValueFees },
    { name: 'Shipping', amount: data.financials.shippingLabels },
    { name: 'Promoted', amount: data.financials.adFees },
    { name: 'Regulatory', amount: data.financials.regulatoryFees },
    { name: 'Performance penalties', amount: data.financials.penaltyFees },
    { name: 'International', amount: data.financials.internationalFees },
    { name: 'Other', amount: data.financials.otherFees },
  ].filter(item => item.amount > 0);

  return (
    <div className="max-w-7xl mx-auto space-y-8 text-slate-100 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-400 mb-2">Store economics</p>
          <h1 className="text-3xl font-semibold tracking-tight">Profit & advertising</h1>
          <p className="text-sm text-slate-400 mt-2 max-w-2xl">{demo ? 'Synthetic transaction deductions and campaign attribution. Proceeds after fees and refunds exclude shipping labels, advertising, inventory cost, and operating overhead.' : 'Actual eBay transaction deductions alongside campaign attribution. Inventory cost is excluded until it can be tied to each sold item.'}</p>
        </div>
        {demo ? <div><button type="button" disabled aria-describedby="profitability-demo-import" className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 opacity-40 cursor-not-allowed">Import reports <ArrowUpRight size={15} /></button><p id="profitability-demo-import" className="text-xs text-amber-300 mt-2">Report imports are disabled in this read-only demo.</p></div> : <StoreLink href="/upload" className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 transition-colors">Import reports <ArrowUpRight size={15} /></StoreLink>}
      </header>

      {!hasTransactions && !hasAds && <div className="border border-dashed border-slate-700 rounded-xl p-10 text-center"><ReceiptText className="mx-auto text-slate-600 mb-3" /><h2 className="font-semibold">No profitability data yet</h2><p className="text-sm text-slate-500 mt-1">{demo ? 'No synthetic profitability records are available. Imports and live syncs are disabled in this demo.' : 'Import an eBay Transaction report and Promoted Listings report, or wait for the finances sync to run.'}</p></div>}

      {hasTransactions && <section className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Cash realization</h2>{data.transactionRange && <span className="text-xs text-slate-500">{date(data.transactionRange.start, demo)}–{date(data.transactionRange.end, demo)}</span>}</div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-px bg-slate-700 border border-slate-700 rounded-xl overflow-hidden">
          {[
            ['Gross revenue', money(data.financials.grossOfFees), 'text-slate-100'],
            ['eBay fees', `-${money(data.financials.ebayFees)}`, 'text-rose-400'],
            ['Proceeds after fees', money(data.financials.grossRevenue), 'text-slate-100'],
            ['Refunds', `-${money(data.financials.refunds)}`, 'text-rose-400'],
            ['Net (proceeds − refunds)', money(data.financials.netRevenue), 'text-emerald-400'],
            [demo ? 'Order revenue (snapshot)' : 'Order revenue (CSV era)', money(data.financials.orderRevenue), 'text-slate-400'],
            [demo ? 'Deductions (incl. refunds)' : 'Deductions (CSV era)', money(data.financials.totalDeductions), 'text-rose-400'],
            ['Effective deduction rate', `${data.financials.feeRate.toFixed(1)}%`, data.financials.feeRate > 25 ? 'text-amber-400' : 'text-slate-100'],
          ].map(([label, value, color]) => <div key={label} className="bg-slate-900 p-5"><p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p><p className={`text-xl md:text-2xl font-semibold mt-2 tabular-nums ${color}`}>{value}</p></div>)}
        </div>
        <div className="grid lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-xl p-5"><h3 className="text-sm font-medium mb-5">Where the money went</h3><ResponsiveContainer width="100%" height={240}><BarChart data={feeChart} layout="vertical" margin={{ left: 10, right: 25 }}><CartesianGrid stroke="#1e293b" horizontal={false} /><XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `$${v}`} /><YAxis type="category" dataKey="name" width={80} tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip cursor={{ fill: '#1e293b' }} contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} formatter={(v: number) => money(v)} /><Bar dataKey="amount" fill="#fb7185" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div>
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5"><h3 className="text-sm font-medium mb-4">Deduction ledger</h3><div className="divide-y divide-slate-800">{feeChart.map(item => <div key={item.name} className="flex justify-between py-3 text-sm"><span className="text-slate-400">{item.name}</span><span className="font-mono text-slate-200">{money(item.amount)}</span></div>)}</div></div>
        </div>
      </section>}

      {hasAds && <section className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Promoted Listings</h2>{data.reportRange && <span className="text-xs text-slate-500">Latest report: {date(data.reportRange.start, demo)}–{date(data.reportRange.end, demo)}</span>}</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            ['Ad sales', money(data.advertising.sales), Megaphone, 'text-emerald-400'], ['Ad spend', money(data.advertising.spend), BadgeDollarSign, 'text-rose-400'], ['ROAS', `${data.advertising.roas.toFixed(2)}×`, ArrowUpRight, 'text-amber-300'], ['Impressions', number(data.advertising.impressions), Megaphone, 'text-slate-200'], ['CTR', `${data.advertising.ctr.toFixed(2)}%`, MousePointerClick, 'text-blue-400'], ['Conversion', `${data.advertising.conversionRate.toFixed(2)}%`, ReceiptText, 'text-violet-400'],
          ].map(([label, value, Icon, color]) => { const MetricIcon = Icon as typeof Megaphone; return <div key={label as string} className="bg-slate-900 border border-slate-800 rounded-xl p-4"><MetricIcon size={14} className="text-slate-600 mb-4" /><p className="text-[10px] uppercase tracking-wider text-slate-500">{label as string}</p><p className={`text-lg font-semibold mt-1 tabular-nums ${color}`}>{value as string}</p></div>; })}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"><div className="p-5 border-b border-slate-800"><h3 className="text-sm font-medium">Campaign scorecard</h3></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="text-left p-4">Campaign</th><th className="text-right p-4">Sales</th><th className="text-right p-4">Fees</th><th className="text-right p-4">ROAS</th></tr></thead><tbody className="divide-y divide-slate-800">{data.campaigns.map(c => <tr key={c.campaignId}><td className="p-4 max-w-[220px]"><p className="truncate text-slate-200">{c.name}</p><p className="text-[10px] text-slate-600 mt-1">{number(c.impressions)} impressions · {c.clicks} clicks</p></td><td className="p-4 text-right font-mono text-emerald-400">{money(c.sales)}</td><td className="p-4 text-right font-mono text-rose-400">{money(c.fees)}</td><td className="p-4 text-right font-semibold">{c.roas.toFixed(2)}×</td></tr>)}</tbody></table></div></div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"><div className="p-5 border-b border-slate-800 flex items-center gap-2"><AlertTriangle size={14} className="text-amber-400" /><div><h3 className="text-sm font-medium">Spend without attributed sales</h3><p className="text-xs text-slate-500 mt-0.5">Review bids, relevance, price, and listing quality.</p></div></div>{data.actions.wasted.length ? <div className="divide-y divide-slate-800">{data.actions.wasted.slice(0, 6).map(item => <div key={`${item.itemId}-${item.campaignName}`} className="p-4 flex gap-4"><div className="flex-1 min-w-0"><p className="text-sm text-slate-200 truncate">{item.title}</p><p className="text-[10px] text-slate-600 mt-1">{item.clicks} clicks · {number(item.impressions)} impressions · {item.campaignName}</p></div><span className="font-mono text-sm text-rose-400">{money(item.fees)}</span></div>)}</div> : <p className="p-8 text-center text-sm text-slate-500">No wasted ad spend detected in this report.</p>}</div>
        </div>

        {data.actions.winners.length > 0 && <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"><div className="p-5 border-b border-slate-800"><h3 className="text-sm font-medium">Best listing-level returns</h3><p className="text-xs text-slate-500 mt-1">{demo ? 'Synthetic attributed results; ROAS does not include inventory cost or other eBay fees.' : 'Attributed results reported by eBay; ROAS does not include inventory cost or other eBay fees.'}</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="text-left p-4">Listing</th><th className="text-right p-4">Clicks</th><th className="text-right p-4">Sold</th><th className="text-right p-4">Ad sales</th><th className="text-right p-4">Ad fees</th><th className="text-right p-4">ROAS</th></tr></thead><tbody className="divide-y divide-slate-800">{data.actions.winners.map(item => <tr key={`${item.itemId}-${item.campaignName}`}><td className="p-4 max-w-md"><p className="truncate text-slate-200">{item.title}</p><p className="text-[10px] font-mono text-slate-600 mt-1">{item.itemId}</p></td><td className="p-4 text-right text-slate-400">{item.clicks}</td><td className="p-4 text-right">{item.sold}</td><td className="p-4 text-right font-mono text-emerald-400">{money(item.sales)}</td><td className="p-4 text-right font-mono text-rose-400">{money(item.fees)}</td><td className="p-4 text-right font-semibold text-amber-300">{item.roas.toFixed(2)}×</td></tr>)}</tbody></table></div></div>}
      </section>}
    </div>
  );
}
