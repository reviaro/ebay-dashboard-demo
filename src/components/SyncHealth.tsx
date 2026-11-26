'use client';

import { storeFetch } from '@/lib/stores/browser';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { timeAgo } from '@/lib/relative-time';
import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_AS_OF, DEMO_DATE } from '@/lib/demo/config';

/**
 * Whether the scheduled sync is actually working.
 *
 * The weekly timer runs unattended, so a failure is otherwise invisible until
 * someone notices the order numbers have stopped moving. This is the one place
 * that says so, and it says *when*.
 */
type Status = {
  orders: {
    state: 'never' | 'inferred' | 'ok' | 'stale' | 'failed' | 'running' | 'stalled';
    lastSyncedAt: string | null;
    message: string | null;
    orderCount: number;
  };
};

export default function SyncHealth() {
  const demo = useDemoMode();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    storeFetch('/api/ebay/sync/status')
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  const { state, lastSyncedAt, message } = status.orders;
  const when = timeAgo(lastSyncedAt, demo ? new Date(DEMO_AS_OF) : undefined);
  const bad = state === 'failed' || state === 'stalled';
  const warn = state === 'stale' || state === 'never';

  const headline = (() => {
    if (demo) return `Synthetic data as of ${DEMO_DATE}`;
    switch (state) {
      case 'failed':
        return 'The last sync failed';
      case 'stalled':
        return 'A sync started and never finished';
      case 'never':
        return 'Orders have never been synced';
      case 'running':
        return 'A sync is running now';
      case 'stale':
        return `Last synced ${when} — the scheduled sync may not be running`;
      case 'inferred':
        return `eBay data as of ${when}`;
      default:
        return `Last synced ${when}`;
    }
  })();

  const Icon = bad ? AlertTriangle : warn ? Clock : CheckCircle2;
  const tone = bad
    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
    : warn
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
      : 'border-slate-700 bg-slate-800/60 text-slate-400';

  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${tone}`}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">{headline}</p>
        {/* The failure time is the point: "it broke" is not actionable, "it
            broke three weeks ago" is. */}
        {bad && when && (
          <p className="mt-0.5 opacity-80">
            {state === 'failed' ? 'Failed' : 'Started'} {when}
          </p>
        )}
        {bad && message && <p className="mt-0.5 opacity-70 break-words">{message}</p>}
        {/* The schedule is configurable below, so this does not name it. */}
        <p className="mt-0.5 text-slate-500">{demo ? 'No live sync has run. Automatic sync is disabled.' : 'Runs on the schedule set below.'}</p>
      </div>
    </div>
  );
}
