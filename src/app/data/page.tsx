'use client';

import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_UPLOAD_HISTORY, DEMO_OPERATION_DISABLED } from '@/lib/demo/operational-presentation';

import { useState, useEffect, useCallback } from 'react';
import { storeFetch } from '@/lib/stores/browser';

import { Database, Trash2, FileText, BarChart3, Activity, Loader2, AlertCircle, RefreshCw, RotateCcw, BadgeDollarSign, Megaphone } from 'lucide-react';
import StoreLink from '@/components/StoreLink';

interface UploadRecord {
  id: number;
  filename: string;
  type: string;
  rowCount: number;
  createdAt: string;
}

const TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  sales:   { label: 'Paid & Shipped', icon: <FileText size={16} />,  color: 'bg-blue-500/10 text-blue-400' },
  active:  { label: 'Active Inventory', icon: <Database size={16} />, color: 'bg-purple-500/10 text-purple-400' },
  traffic: { label: 'Traffic & Search', icon: <BarChart3 size={16} />, color: 'bg-orange-500/10 text-orange-400' },
  transactions: { label: 'Transactions', icon: <BadgeDollarSign size={16} />, color: 'bg-emerald-500/10 text-emerald-400' },
  'promoted-listings': { label: 'Promoted Listings', icon: <Megaphone size={16} />, color: 'bg-amber-500/10 text-amber-400' },
};

export default function DataLibraryPage() {
  const demo = useDemoMode();
  const [uploads, setUploads] = useState<UploadRecord[]>(() => demo ? DEMO_UPLOAD_HISTORY.map(record => ({ ...record })) : []);
  const [isLoading, setIsLoading] = useState(!demo);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const fetchUploads = useCallback(async () => {
    if (demo) {
      setUploads(DEMO_UPLOAD_HISTORY.map(record => ({ ...record })));
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await storeFetch('/api/uploads');
      const data = await res.json();
      setUploads(Array.isArray(data) ? data : []);
    } catch {
      setUploads([]);
    } finally {
      setIsLoading(false);
    }
  }, [demo]);

  useEffect(() => { fetchUploads(); }, [fetchUploads]);

  const handleClearMetrics = async () => {
    if (demo) return;
    if (!confirm('Clear all imported traffic metrics? Sales, inventory, transactions, promoted listings, and upload history will remain.')) return;
    setIsClearing(true);
    try {
      await storeFetch('/api/metrics', { method: 'DELETE' });
    } finally {
      setIsClearing(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (demo) return;
    if (!confirm('Remove this upload record? This only removes the history entry — processed data stays in the database.')) return;
    setDeletingId(id);
    try {
      await storeFetch(`/api/uploads?id=${id}`, { method: 'DELETE' });
      setUploads(prev => prev.filter(u => u.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(demo ? { timeZone: 'UTC' } : {}) });
  };

  const displayType = (type: string) => demo && type === 'promoted' ? 'promoted-listings' : type;
  const counts: Record<string, number> = Object.fromEntries(Object.keys(TYPE_CONFIG).map(type => [type, 0]));
  uploads.forEach(u => { const type = displayType(u.type); if (type in counts) counts[type]++; });

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-700">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">Data Library</h1>
          <p className="text-gray-500 mt-1 font-medium text-sm">History of all CSV imports. Deleting a record here does not remove the processed data from the dashboard.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleClearMetrics}
            disabled={demo || isClearing}
            title={demo ? DEMO_OPERATION_DISABLED : 'Clear imported traffic metrics'}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400 rounded-2xl shadow-sm hover:bg-red-100 dark:hover:bg-red-900/30 transition text-xs font-bold disabled:opacity-50"
          >
            {isClearing ? <Loader2 className="animate-spin" size={16} /> : <RotateCcw size={16} />}
            Clear Traffic
          </button>
          <button onClick={fetchUploads} aria-label="Refresh import history" className="p-3 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition text-gray-500 dark:text-gray-400">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG[string]][]).map(([type, cfg]) => (
          <div key={type} className="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold mb-3 ${cfg.color}`}>
              {cfg.icon}
              {cfg.label}
            </div>
            <p className="text-3xl font-black text-gray-900 dark:text-white">{counts[type] || 0}</p>
            <p className="text-xs text-gray-400 font-medium mt-1">imports</p>
          </div>
        ))}
      </div>

      {/* Upload List */}
      <div className="bg-white dark:bg-gray-800 rounded-[2rem] border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-50 dark:border-gray-700">
          <h2 className="text-lg font-black text-gray-900 dark:text-white">Import History</h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-3">
            <Loader2 className="animate-spin" size={20} />
            <span className="text-sm font-medium">Loading records...</span>
          </div>
        ) : uploads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="p-4 bg-gray-50 rounded-full text-gray-300">
              <Database size={32} />
            </div>
            <div>
              <p className="font-bold text-gray-500">No imports yet</p>
              <p className="text-sm text-gray-400 mt-1">Upload a CSV from the <StoreLink href="/upload" className="text-blue-600 underline">Data Intake</StoreLink> page to get started.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {uploads.map((upload) => {
              const cfg = TYPE_CONFIG[displayType(upload.type)] || { label: upload.type, icon: <Activity size={16} />, color: 'bg-slate-500/10 text-slate-400' };
              return (
                <div key={upload.id} className="flex items-center gap-4 p-5 hover:bg-gray-50 dark:hover:bg-gray-700 transition group">
                  <div className={`p-2.5 rounded-xl ${cfg.color} shrink-0`}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 dark:text-white text-sm truncate">{upload.filename}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      <span className="text-xs text-gray-400">{upload.rowCount} rows</span>
                      <span className="text-xs text-gray-400">{formatDate(upload.createdAt)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(upload.id)}
                    disabled={demo || deletingId === upload.id}
                    title={demo ? DEMO_OPERATION_DISABLED : undefined}
                    aria-label={`Remove ${upload.filename} from import history`}
                    className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                  >
                    {deletingId === upload.id
                      ? <Loader2 className="animate-spin" size={16} />
                      : <Trash2 size={16} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <AlertCircle size={14} />
        <span>{demo ? 'Synthetic import history. Uploads, deletion, and clearing traffic are disabled in this read-only demo.' : 'Deleting a history record does not delete imported data. “Clear Traffic” only removes traffic snapshots.'}</span>
      </div>
    </div>
  );
}
