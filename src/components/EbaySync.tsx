'use client';

import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_OPERATION_DISABLED } from '@/lib/demo/operational-presentation';

import { storeFetch } from '@/lib/stores/browser';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Loader2 } from 'lucide-react';

/** Matches ALLOWED_DAYS in the sync route; 90 is eBay's limit for orders. */
const PERIODS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

interface SyncResult {
  ok?: boolean;
  requestedDays?: number;
  maxDays?: number;
  fetched?: number;
  stored?: number;
  skipped?: number;
  clamped?: boolean;
  truncated?: boolean;
  outOfRetention?: boolean;
  from?: string;
  to?: string;
  error?: string;
  code?: string;
}

const shortDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

export default function EbaySync() {
  const demo = useDemoMode();
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSync() {
    if (demo) return;
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const res = await storeFetch('/api/ebay/sync/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      const json = (await res.json().catch(() => ({}))) as SyncResult;

      if (!res.ok) {
        setError(json.error || `Sync failed (${res.status})`);
        return;
      }
      setResult(json);
    } catch {
      setError('Could not reach the dashboard. Is it still running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Download size={15} className="text-blue-400" />
          Sync orders from eBay
        </h2>
        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-300">
          Read-only
        </span>
      </div>

      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        Pulls orders from the eBay API into this dashboard. Nothing is ever
        written back to eBay. Re-running is safe: orders are matched on their
        eBay order ID, so a repeat sync updates rather than duplicates.
      </p>

      {demo && <p className="text-xs text-amber-300 mb-4">Live sync is disabled. The demo uses a fixed synthetic snapshot.</p>}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {PERIODS.map((period) => (
          <button
            key={period.days}
            onClick={() => setDays(period.days)}
            disabled={demo || busy}
            title={demo ? DEMO_OPERATION_DISABLED : undefined}
            aria-pressed={days === period.days}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
              days === period.days
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            {period.label}
          </button>
        ))}

        <button
          onClick={runSync}
          disabled={demo || busy}
          title={demo ? DEMO_OPERATION_DISABLED : undefined}
          className="ml-auto flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-medium rounded-lg px-4 py-1.5 transition-colors"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex gap-2 text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded-lg p-3"
        >
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result?.ok && (
        <div className="text-xs bg-slate-900 border border-slate-700 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span className="text-slate-200">
              {result.stored === 0
                ? 'No orders in this period.'
                : `${result.stored} order${result.stored === 1 ? '' : 's'} synced.`}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-400">
            <dt>Fetched from eBay</dt>
            <dd className="text-slate-200">{result.fetched}</dd>
            <dt>Period covered</dt>
            <dd className="text-slate-200">
              {shortDate(result.from)} – {shortDate(result.to)}
            </dd>
            {result.skipped ? (
              <>
                <dt>Skipped</dt>
                <dd className="text-amber-300">{result.skipped} unreadable</dd>
              </>
            ) : null}
          </dl>

          {/* Never let a shortened range pass silently as a full import. */}
          {result.outOfRetention && (
            <p className="mt-2 text-amber-300">
              That period is entirely older than the {result.maxDays} days eBay
              exposes for orders, so nothing could be fetched.
            </p>
          )}
          {result.clamped && !result.outOfRetention && (
            <p className="mt-2 text-amber-300">
              Shortened to the {result.maxDays} days eBay exposes for orders.
            </p>
          )}
          {result.truncated && (
            <p className="mt-2 text-amber-300">
              Stopped at the page limit — run it again to continue.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
