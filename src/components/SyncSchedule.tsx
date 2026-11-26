'use client';

import { storeFetch } from '@/lib/stores/browser';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2, RefreshCw } from 'lucide-react';
import { timeAgo } from '@/lib/relative-time';
import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_AS_OF } from '@/lib/demo/config';
import { DEMO_OPERATION_DISABLED } from '@/lib/demo/operational-presentation';

type Setting = {
  domain: string;
  enabled: boolean;
  frequency: string;
  lookbackDays: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  /** Sent by the server so the UI cannot offer a choice it would reject. */
  available: string[];
};

type Run = {
  id: number;
  type: string;
  status: string;
  count: number;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
};

const when = (iso: string | null, demo = false) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(demo ? { timeZone: 'UTC' } : {}) }) : '—';

/**
 * What each domain's lookback means, since the same number of days is a
 * different promise per domain.
 */
const LOOKBACK: Record<string, { max: number; label: string; hint: string }> = {
  orders: { max: 90, label: 'Look back', hint: 'Orders modified within this many days are re-checked.' },
  inventory: { max: 1, label: '', hint: 'The report is everything currently listed, so there is no window.' },
  traffic: {
    max: 730,
    label: 'Look back',
    hint: 'Days re-fetched each run. eBay keeps revising the last few, so a week is the settling window rather than a catch-up window.',
  },
};

const TITLES: Record<string, string> = {
  orders: 'Orders',
  inventory: 'Listings',
  traffic: 'Traffic',
  finances: 'Finances',
  payouts: 'Payouts',
  advertising: 'Advertising',
};

/** One-line summary of a manual sync's result, shaped per domain's response. */
function summarizeSync(domain: string, json: Record<string, unknown>): string {
  switch (domain) {
    case 'orders':
      return `${json.stored ?? 0} order(s) synced`;
    case 'inventory':
      return `${json.active ?? 0} active, ${json.sold ?? 0} sold, ${json.ended ?? 0} ended`;
    case 'traffic':
      return `${json.dayRows ?? 0} store row(s), ${json.listingRows ?? 0} listing row(s)`;
    case 'finances':
      return `${json.transactionRows ?? 0} transaction row(s)`;
    case 'payouts':
      return `${json.payoutRows ?? 0} payout row(s)`;
    case 'advertising':
      return `${json.campaigns ?? 0} campaign(s)`;
    default:
      return 'Synced';
  }
}

/**
 * The sync schedule, and what it has actually been doing.
 *
 * Every domain the server returns is rendered. Naming one here is how
 * `inventory` ended up with a scheduled runner, a settings row, and no way to
 * change either without a shell on the host.
 */
export default function SyncSchedule() {
  const demo = useDemoMode();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<Record<string, string>>({});
  const [syncError, setSyncError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([
      storeFetch('/api/ebay/sync/settings').then((r) => (r.ok ? r.json() : null)),
      storeFetch('/api/ebay/sync/logs?limit=8').then((r) => (r.ok ? r.json() : null)),
    ]);
    setSettings(s?.settings ?? []);
    setRuns(l?.runs ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(domain: string, changes: Partial<Setting>) {
    if (demo) return;
    setSaving(domain);
    setError(null);
    try {
      const res = await storeFetch('/api/ebay/sync/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, ...changes }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || `Could not save (${res.status})`);
        return;
      }
      setSettings((current) => current.map((s) => (s.domain === domain ? json.setting : s)));
    } catch {
      setError('Could not reach the dashboard.');
    } finally {
      setSaving(null);
    }
  }

  async function syncNow(domain: string) {
    if (demo) return;
    setSyncing(domain);
    setSyncError((current) => ({ ...current, [domain]: '' }));
    setSyncResult((current) => ({ ...current, [domain]: '' }));
    try {
      const res = await storeFetch(`/api/ebay/sync/${domain}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncError((current) => ({ ...current, [domain]: json.error || `Sync failed (${res.status})` }));
        return;
      }
      setSyncResult((current) => ({ ...current, [domain]: summarizeSync(domain, json) }));
      await load();
    } catch {
      setSyncError((current) => ({ ...current, [domain]: 'Could not reach the dashboard.' }));
    } finally {
      setSyncing(null);
    }
  }

  if (!loaded) return null;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock size={16} className="text-blue-400" />
        <h3 className="text-sm font-medium text-white">Automatic sync</h3>
      </div>

      {demo && <p className="mb-3 text-xs text-amber-300">Sample schedule configuration and generation history. All live sync and settings changes are disabled.</p>}

      <div className="space-y-4">
        {settings.map((setting) => {
          const lookback = LOOKBACK[setting.domain];
          return (
            <div key={setting.domain} className="border-t border-slate-700/60 pt-3 first:border-0 first:pt-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-slate-300">
                  {TITLES[setting.domain] ?? setting.domain}
                </span>
                {saving === setting.domain && <Loader2 size={12} className="animate-spin text-slate-400" />}
                <button
                  onClick={() => void syncNow(setting.domain)}
                  disabled={demo || syncing === setting.domain}
                  title={demo ? DEMO_OPERATION_DISABLED : undefined}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500 disabled:opacity-50"
                >
                  {syncing === setting.domain ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                  {syncing === setting.domain ? 'Syncing…' : 'Sync now'}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    disabled={demo}
                    title={demo ? DEMO_OPERATION_DISABLED : undefined}
                    checked={setting.enabled}
                    onChange={(e) => void save(setting.domain, { enabled: e.target.checked })}
                    className="accent-blue-500"
                  />
                  Enabled
                </label>

                <label className="flex items-center gap-2 text-slate-300">
                  Frequency
                  <select
                    disabled={demo}
                    title={demo ? DEMO_OPERATION_DISABLED : undefined}
                    value={setting.frequency}
                    onChange={(e) => void save(setting.domain, { frequency: e.target.value })}
                    className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
                  >
                    {(demo && !setting.available.includes(setting.frequency) ? [setting.frequency, ...setting.available] : setting.available).map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>

                {lookback?.label && (
                  <label className="flex items-center gap-2 text-slate-300" title={lookback.hint}>
                    {lookback.label}
                    <input
                      type="number"
                      disabled={demo}
                      title={demo ? DEMO_OPERATION_DISABLED : undefined}
                      min={1}
                      max={lookback.max}
                      defaultValue={setting.lookbackDays}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value !== setting.lookbackDays) void save(setting.domain, { lookbackDays: value });
                      }}
                      className="w-16 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
                    />
                    days
                  </label>
                )}
              </div>

              <p className="mt-2 text-xs text-slate-500">
                Last run {when(setting.lastRunAt, demo)} · Next {setting.enabled ? when(setting.nextRunAt, demo) : 'disabled'}
              </p>

              {syncError[setting.domain] && (
                <p className="mt-1.5 text-xs text-amber-300">{syncError[setting.domain]}</p>
              )}
              {syncResult[setting.domain] && !syncError[setting.domain] && (
                <p className="mt-1.5 text-xs text-emerald-400">{syncResult[setting.domain]}</p>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

      {runs.length > 0 && (
        <div className="mt-4 border-t border-slate-700 pt-3">
          <p className="mb-1.5 text-xs font-medium text-slate-400">Recent runs</p>
          <ul className="space-y-1">
            {runs.map((run) => (
              <li key={run.id} className="flex items-baseline gap-2 text-xs">
                <span
                  className={
                    run.status === 'ok'
                      ? 'text-emerald-400'
                      : run.status === 'running'
                        ? 'text-slate-400'
                        : 'text-rose-400'
                  }
                >
                  {run.status}
                </span>
                <span className="text-slate-400">{run.type}</span>
                <span className="text-slate-500">{timeAgo(run.startedAt, demo ? new Date(DEMO_AS_OF) : undefined)}</span>
                <span className="text-slate-500">· {run.count} stored</span>
                {run.message && (
                  <span className="truncate text-slate-600" title={run.message}>
                    · {run.message}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
