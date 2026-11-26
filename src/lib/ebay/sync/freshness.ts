/**
 * Turns raw sync-log rows into the one answer the UI needs: how current is
 * this data, and is anything wrong?
 *
 * Pure, so the awkward cases -- an empty log, a sync that legitimately found
 * nothing, a run that died holding a `running` row -- are decided here and
 * tested, rather than being improvised in a component.
 */

import { LEASE_TTL_MS } from '../sync-lock';

export type SyncState =
  /** No run has ever been logged and there is nothing to infer from. */
  | 'never'
  /** No logged run, but stored orders carry a sync timestamp. */
  | 'inferred'
  | 'ok'
  | 'stale'
  | 'failed'
  | 'running'
  /** A `running` row old enough that the process is presumed dead. */
  | 'stalled';

export interface SyncRunSummary {
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  count: number;
  message: string | null;
}

export interface SyncStateInput {
  lastRun: SyncRunSummary | null;
  lastSuccessAt: Date | null;
  /**
   * The newest `syncedAt` on the domain's own rows -- `max(EbayOrder.syncedAt)`
   * for orders, `max(EbayTrafficDay.syncedAt)` for traffic -- used only to
   * cover the era before runs were logged. Null when there is nothing to infer
   * from.
   */
  inferredSyncedAt: Date | null;
  now: Date;
  staleAfterHours?: number;
  runningStaleAfterMinutes?: number;
}

export interface SyncStateResult {
  state: SyncState;
  /** When the data was last known good, or null if that is unknown. */
  lastSyncedAt: Date | null;
  /** True when `lastSyncedAt` came from data rows rather than a logged run. */
  inferred: boolean;
  message: string | null;
  lastCount: number | null;
}

/**
 * Statuses written by the current sync logger.
 *
 * Legacy `EbaySyncLog` rows use `success`/`error` and are not runs of this
 * logger. Treating them as current could report an unrelated old failure.
 * Filtering on the vocabulary avoids both a hardcoded cutoff date and a
 * migration.
 */
export const CURRENT_RUN_STATUSES: readonly string[] = ['running', 'ok', 'failed'];

export function isCurrentRun(row: { status: string }): boolean {
  return CURRENT_RUN_STATUSES.includes(row.status);
}

const DEFAULT_STALE_AFTER_HOURS = 24;

/**
 * Derived from the lease rather than picked separately: a `running` row is
 * presumed dead exactly when its lease would have expired and another run
 * could take over. Two independent numbers would drift into a window where the
 * page says "stalled" while the lock still considers the run live.
 */
const DEFAULT_RUNNING_STALE_AFTER_MINUTES = LEASE_TTL_MS / 60_000;

export function describeSyncState(input: SyncStateInput): SyncStateResult {
  const {
    lastRun,
    lastSuccessAt,
    inferredSyncedAt,
    now,
    staleAfterHours = DEFAULT_STALE_AFTER_HOURS,
    runningStaleAfterMinutes = DEFAULT_RUNNING_STALE_AFTER_MINUTES,
  } = input;

  // Nothing has ever been logged. Orders synced before this log existed still
  // carry a timestamp, so use it rather than claiming the data is untouched.
  if (!lastRun) {
    if (inferredSyncedAt) {
      // This timestamp only moves when a sync writes an order, so it freezes
      // if syncing stops. It has to age out like a logged run, or the one
      // situation this indicator exists to catch is the one it never reports.
      const inferredAge = now.getTime() - inferredSyncedAt.getTime();
      return {
        state: inferredAge > staleAfterHours * 3_600_000 ? 'stale' : 'inferred',
        lastSyncedAt: inferredSyncedAt,
        inferred: true,
        message: null,
        lastCount: null,
      };
    }
    return { state: 'never', lastSyncedAt: null, inferred: false, message: null, lastCount: null };
  }

  const base = {
    lastSyncedAt: lastSuccessAt,
    inferred: false,
    message: lastRun.message,
    lastCount: lastRun.count,
  };

  if (lastRun.status === 'running') {
    const runningFor = now.getTime() - lastRun.startedAt.getTime();
    const stalled = runningFor > runningStaleAfterMinutes * 60_000;
    // A stalled run says nothing about freshness either way; `lastSyncedAt`
    // stays whatever the last real success was.
    return { ...base, state: stalled ? 'stalled' : 'running' };
  }

  if (lastRun.status !== 'ok') {
    return { ...base, state: 'failed' };
  }

  if (!lastSuccessAt) {
    return { ...base, state: 'ok' };
  }

  const age = now.getTime() - lastSuccessAt.getTime();
  return { ...base, state: age > staleAfterHours * 3_600_000 ? 'stale' : 'ok' };
}
