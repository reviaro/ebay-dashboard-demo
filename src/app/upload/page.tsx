'use client';

import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_OPERATION_DISABLED } from '@/lib/demo/operational-presentation';

import { storeFetch } from '@/lib/stores/browser';

import { useState } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, ArrowRight, ShieldCheck, Database, BarChart3, Receipt, Package, BadgeDollarSign, Megaphone } from 'lucide-react';

const REPORT_TYPES = [
  {
    id: 'sales', title: 'Paid & Shipped', desc: "Revenue, ASP, Int'l Sales", icon: <FileText size={24} />,
    accept: '.csv,.xlsx',
    selectedCard: 'bg-white dark:bg-gray-800 border-blue-600 shadow-2xl shadow-blue-100 scale-105',
    selectedIcon: 'bg-blue-600 text-white',
    selectedBadge: 'bg-blue-600',
  },
  {
    id: 'active', title: 'Active Inventory', desc: 'Age, Price Trends, Stock', icon: <Database size={24} />,
    accept: '.csv,.xlsx',
    selectedCard: 'bg-white dark:bg-gray-800 border-purple-600 shadow-2xl shadow-purple-100 scale-105',
    selectedIcon: 'bg-purple-600 text-white',
    selectedBadge: 'bg-purple-600',
  },
  {
    id: 'traffic', title: 'Traffic & Search', desc: 'CTR, Impressions, SEO', icon: <BarChart3 size={24} />,
    accept: '.csv,.xlsx',
    selectedCard: 'bg-white dark:bg-gray-800 border-orange-500 shadow-2xl shadow-orange-100 scale-105',
    selectedIcon: 'bg-orange-500 text-white',
    selectedBadge: 'bg-orange-500',
  },
  {
    id: 'transactions', title: 'Transactions', desc: 'Net payouts, fees, shipping labels', icon: <BadgeDollarSign size={24} />,
    accept: '.csv',
    selectedCard: 'bg-slate-800 border-emerald-500 shadow-xl shadow-emerald-950/30 scale-[1.02]',
    selectedIcon: 'bg-emerald-500 text-slate-950',
    selectedBadge: 'bg-emerald-500',
  },
  {
    id: 'promoted-listings', title: 'Promoted Listings', desc: 'Ad spend, ROAS, campaign efficiency', icon: <Megaphone size={24} />,
    accept: '.csv',
    selectedCard: 'bg-slate-800 border-amber-400 shadow-xl shadow-amber-950/30 scale-[1.02]',
    selectedIcon: 'bg-amber-400 text-slate-950',
    selectedBadge: 'bg-amber-400',
  },
  {
    id: 'inventory-expenses', title: 'Inventory Expenses', desc: 'Junkyard costs, COGS, Supplier split', icon: <Package size={24} />,
    accept: '.csv,.xlsx,.pdf',
    selectedCard: 'bg-white dark:bg-gray-800 border-emerald-600 shadow-2xl shadow-emerald-100 scale-105',
    selectedIcon: 'bg-emerald-600 text-white',
    selectedBadge: 'bg-emerald-600',
  },
  {
    id: 'ebay-fees', title: 'eBay Fees', desc: 'FVF, Per-order, Platform fees', icon: <Receipt size={24} />,
    accept: '.csv,.xlsx,.pdf',
    selectedCard: 'bg-white dark:bg-gray-800 border-rose-600 shadow-2xl shadow-rose-100 scale-105',
    selectedIcon: 'bg-rose-600 text-white',
    selectedBadge: 'bg-rose-600',
  },
];

export default function UploadPage() {
  const demo = useDemoMode();
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState('sales');
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState<{ success?: boolean; error?: string; metrics?: any } | null>(null);

  const selectedType = REPORT_TYPES.find(r => r.id === type)!;
  const isPdf = file ? file.name.toLowerCase().endsWith('.pdf') : ['inventory-expenses', 'ebay-fees'].includes(type);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (demo) return;
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setStatus(null);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (demo || !file) return;

    setIsUploading(true);
    setStatus(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    try {
      const res = await storeFetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setStatus({ success: true, metrics: data.metrics });
        setFile(null);
      } else {
        setStatus({ error: data.error });
      }
    } catch {
      setStatus({ error: "Failed to upload file. Please check your connection." });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
      {/* Header */}
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-black text-gray-900 dark:text-white tracking-tighter">Data Intake Portal</h1>
        <p className="text-gray-500 font-medium text-lg max-w-xl mx-auto">
          Import your eBay reports, inventory costs, and platform fees. All data feeds into your Market Analysis automatically.
        </p>
        {demo && <p className="text-sm font-medium text-amber-600 dark:text-amber-300">Explore every report type. File selection and imports are disabled in this read-only demo.</p>}
      </div>

      {/* Upload Matrix — 3 + 2 grid */}
      <div className="space-y-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">eBay CSV Reports</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {REPORT_TYPES.slice(0, 3).map((item) => (
            <button
              key={item.id}
              onClick={() => { setType(item.id); setFile(null); setStatus(null); }}
              className={`p-8 rounded-[2.5rem] border-4 transition-all text-left flex flex-col gap-4 relative overflow-hidden group ${
                type === item.id
                  ? item.selectedCard
                  : 'bg-gray-50 dark:bg-gray-900 border-transparent hover:border-gray-100 dark:hover:border-gray-700 opacity-60'
              }`}
            >
              <div className={`p-4 rounded-2xl ${type === item.id ? item.selectedIcon : 'bg-white dark:bg-gray-800 text-gray-400'}`}>
                {item.icon}
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white tracking-tight">{item.title}</h3>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">{item.desc}</p>
              </div>
              {type === item.id && (
                <div className={`absolute top-0 right-0 p-3 ${item.selectedBadge} text-white rounded-bl-2xl`}>
                  <ShieldCheck size={16} />
                </div>
              )}
            </button>
          ))}
        </div>

        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 pt-2">Profitability & advertising</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {REPORT_TYPES.slice(3, 5).map((item) => (
            <button key={item.id} onClick={() => { setType(item.id); setFile(null); setStatus(null); }} className={`p-7 rounded-2xl border-2 transition-all text-left flex items-center gap-4 relative overflow-hidden ${type === item.id ? item.selectedCard : 'bg-slate-900 border-slate-800 hover:border-slate-700 opacity-70'}`}>
              <div className={`p-3 rounded-xl ${type === item.id ? item.selectedIcon : 'bg-slate-800 text-slate-400'}`}>{item.icon}</div>
              <div><h3 className="text-base font-black text-white">{item.title}</h3><p className="text-xs text-slate-400 mt-1">{item.desc}</p></div>
              {type === item.id && <div className={`absolute top-0 right-0 p-2.5 ${item.selectedBadge} text-slate-950 rounded-bl-xl`}><ShieldCheck size={15} /></div>}
            </button>
          ))}
        </div>

        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 pt-2">QuickBooks PDF Exports</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {REPORT_TYPES.slice(5).map((item) => (
            <button
              key={item.id}
              onClick={() => { setType(item.id); setFile(null); setStatus(null); }}
              className={`p-8 rounded-[2.5rem] border-4 transition-all text-left flex flex-col gap-4 relative overflow-hidden group ${
                type === item.id
                  ? item.selectedCard
                  : 'bg-gray-50 dark:bg-gray-900 border-transparent hover:border-gray-100 dark:hover:border-gray-700 opacity-60'
              }`}
            >
              <div className={`p-4 rounded-2xl ${type === item.id ? item.selectedIcon : 'bg-white dark:bg-gray-800 text-gray-400'}`}>
                {item.icon}
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white tracking-tight">{item.title}</h3>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">{item.desc}</p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">PDF or CSV</span>
              {type === item.id && (
                <div className={`absolute top-0 right-0 p-3 ${item.selectedBadge} text-white rounded-bl-2xl`}>
                  <ShieldCheck size={16} />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Drop Zone */}
      <div className="bg-white dark:bg-gray-800 p-12 rounded-[3rem] border-2 border-dashed border-gray-200 dark:border-gray-600 shadow-sm relative group">
        <form onSubmit={handleUpload} className="space-y-8 flex flex-col items-center">
          <div className="relative w-full flex flex-col items-center justify-center space-y-4 cursor-pointer">
            <input
              type="file"
              disabled={demo}
              aria-label="Select report file"
              title={demo ? DEMO_OPERATION_DISABLED : undefined}
              accept={selectedType.accept}
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="p-10 bg-blue-50 text-blue-600 rounded-full group-hover:scale-110 group-hover:bg-blue-100 transition-all duration-500">
              <Upload size={48} />
            </div>
            <div className="text-center">
              <p className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
                {file ? file.name : `Select your ${selectedType.title} ${isPdf ? 'PDF' : 'CSV'}`}
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">
                Accepted: {selectedType.accept.replaceAll('.', '').toUpperCase().replaceAll(',', ', ')}
              </p>
            </div>
          </div>

          <div className="w-full max-w-md h-px bg-gray-100 dark:bg-gray-700" />

          <button
            type="submit"
            disabled={demo || !file || isUploading}
            title={demo ? DEMO_OPERATION_DISABLED : undefined}
            className="w-full max-w-md py-6 bg-gray-900 dark:bg-white dark:text-gray-900 text-white font-black rounded-[2rem] shadow-2xl hover:bg-black dark:hover:bg-gray-100 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3 text-lg"
          >
            {isUploading ? (
              <>
                <Loader2 className="animate-spin" size={24} />
                Processing {isPdf ? 'PDF' : 'Data'}...
              </>
            ) : (
              <>
                Execute Analysis
                <ArrowRight size={24} />
              </>
            )}
          </button>
        </form>

        {status && (
          <div className={`mt-12 p-8 rounded-[2rem] border-2 animate-in slide-in-from-top-4 duration-500 ${
            status.success ? 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800'
          }`}>
            <div className="flex items-center gap-4 mb-4">
              {status.success ? <CheckCircle2 className="text-green-600" size={32} /> : <AlertCircle className="text-red-600" size={32} />}
              <h3 className={`text-2xl font-black tracking-tight ${status.success ? 'text-green-900 dark:text-green-300' : 'text-red-900 dark:text-red-300'}`}>
                {status.success ? 'Import Complete' : 'Error'}
              </h3>
            </div>
            {status.success && status.metrics && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-4">
                {type === 'sales' && [
                  { label: 'Revenue', val: `$${status.metrics.revenue?.toFixed(2) ?? '—'}` },
                  { label: 'Sales', val: status.metrics.salesCount ?? status.metrics.rows },
                  { label: 'ASP', val: `$${status.metrics.averageSalePrice?.toFixed(2) ?? '—'}` },
                  { label: 'Intl Rate', val: `${status.metrics.internationalRate?.toFixed(1) ?? '—'}%` },
                ].map(m => (
                  <div key={m.label}>
                    <p className="text-[10px] font-black uppercase text-green-700 dark:text-green-400 tracking-widest">{m.label}</p>
                    <p className="text-xl font-black text-green-900 dark:text-green-300">{m.val}</p>
                  </div>
                ))}
                {(type === 'inventory-expenses' || type === 'ebay-fees') && [
                  { label: 'Records', val: status.metrics.rows },
                  { label: 'Total Amount', val: `$${status.metrics.total?.toFixed(2) ?? '0.00'}` },
                ].map(m => (
                  <div key={m.label}>
                    <p className="text-[10px] font-black uppercase text-green-700 dark:text-green-400 tracking-widest">{m.label}</p>
                    <p className="text-xl font-black text-green-900 dark:text-green-300">{m.val}</p>
                  </div>
                ))}
                {(type === 'active' || type === 'traffic') && (
                  <>
                    <div>
                      <p className="text-[10px] font-black uppercase text-green-700 dark:text-green-400 tracking-widest">Records</p>
                      <p className="text-xl font-black text-green-900 dark:text-green-300">{status.metrics.rows ?? '—'}</p>
                    </div>
                    {status.metrics.skipped > 0 && (
                      <div>
                        <p className="text-[10px] font-black uppercase text-amber-700 dark:text-amber-400 tracking-widest">Skipped</p>
                        <p className="text-xl font-black text-amber-700 dark:text-amber-400">{status.metrics.skipped}</p>
                      </div>
                    )}
                  </>
                )}
                {type === 'transactions' && [
                  { label: 'Records', val: status.metrics.rows },
                  { label: 'Order revenue', val: `$${status.metrics.orderRevenue?.toFixed(2) ?? '0.00'}` },
                  { label: 'Fees', val: `$${status.metrics.fees?.toFixed(2) ?? '0.00'}` },
                  { label: 'Net activity', val: `$${status.metrics.net?.toFixed(2) ?? '0.00'}` },
                ].map(m => <div key={m.label}><p className="text-[10px] font-black uppercase text-green-400 tracking-widest">{m.label}</p><p className="text-xl font-black text-green-200">{m.val}</p></div>)}
                {type === 'promoted-listings' && [
                  { label: 'Listings', val: status.metrics.rows },
                  { label: 'Ad sales', val: `$${status.metrics.sales?.toFixed(2) ?? '0.00'}` },
                  { label: 'Ad fees', val: `$${status.metrics.fees?.toFixed(2) ?? '0.00'}` },
                  { label: 'ROAS', val: `${status.metrics.roas?.toFixed(2) ?? '0.00'}×` },
                ].map(m => <div key={m.label}><p className="text-[10px] font-black uppercase text-green-400 tracking-widest">{m.label}</p><p className="text-xl font-black text-green-200">{m.val}</p></div>)}
              </div>
            )}
            {status.error && <p className="text-red-700 dark:text-red-400 font-medium">{status.error}</p>}
          </div>
        )}
      </div>

      {/* Compliance Note */}
      <div className="flex items-center justify-center gap-4 text-gray-400 font-black text-[10px] uppercase tracking-tighter">
        <ShieldCheck size={16} />
        {demo ? 'Synthetic Snapshot · Read-only · No Files Uploaded' : 'Encrypted Endpoint · Local SQLite Storage · Data Stays on Device'}
      </div>
    </div>
  );
}
