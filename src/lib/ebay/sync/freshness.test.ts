import { describe, expect, it } from 'vitest';
import { describeSyncState, isCurrentRun, type SyncStateInput } from './freshness';

const now = new Date('2026-09-04T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 3_600_000;
const MINUTE = 60_000;

function input(overrides: Partial<SyncStateInput> = {}): SyncStateInput {
  return { lastRun: null, lastSuccessAt: null, inferredSyncedAt: null, now, ...overrides };
}

describe('describeSyncState', () => {
  it('says never when nothing has ever synced and no orders exist', () => {
    expect(describeSyncState(input())).toMatchObject({ state: 'never', lastSyncedAt: null });
  });

  // Orders may predate sync logging. Their timestamps stand in until the first
  // logged run so existing data is not incorrectly labelled "never synced".
  it('infers a time from the orders themselves when the log is empty', () => {
    const syncedAt = ago(2 * HOUR);
    const state = describeSyncState(input({ inferredSyncedAt: syncedAt }));

    expect(state).toMatchObject({ state: 'inferred', lastSyncedAt: syncedAt, inferred: true });
  });

  // The inferred time comes from order rows, which only move when a sync
  // writes one. If nobody syncs for weeks it stays frozen at the last write,
  // so it has to age out like a logged run -- otherwise the indicator built to
  // catch a neglected sync is the one thing that never reports it.
  it('lets an inferred time go stale too', () => {
    const state = describeSyncState(input({ inferredSyncedAt: ago(200 * HOUR) }));

    expect(state.state).toBe('stale');
    expect(state.inferred).toBe(true);
    expect(state.lastSyncedAt).toEqual(ago(200 * HOUR));
  });

  it('keeps a recent inferred time labelled as inferred', () => {
    expect(describeSyncState(input({ inferredSyncedAt: ago(2 * HOUR) })).state).toBe('inferred');
  });

  it('prefers a logged run over the inferred time once one exists', () => {
    const state = describeSyncState(input({
      lastRun: { status: 'ok', startedAt: ago(HOUR), finishedAt: ago(HOUR), count: 0, message: null },
      lastSuccessAt: ago(HOUR),
      inferredSyncedAt: ago(90 * HOUR),
    }));

    expect(state).toMatchObject({ state: 'ok', inferred: false });
    expect(state.lastSyncedAt).toEqual(ago(HOUR));
  });

  // A sync that legitimately finds nothing new is a success. Freshness has to
  // come from the run, not from whether any row was touched.
  it('treats a run that stored nothing as a successful sync', () => {
    const state = describeSyncState(input({
      lastRun: { status: 'ok', startedAt: ago(MINUTE), finishedAt: ago(MINUTE), count: 0, message: null },
      lastSuccessAt: ago(MINUTE),
      inferredSyncedAt: ago(200 * HOUR),
    }));

    expect(state.state).toBe('ok');
  });

  it('goes stale once the last success is older than the threshold', () => {
    const state = describeSyncState(input({
      lastRun: { status: 'ok', startedAt: ago(30 * HOUR), finishedAt: ago(30 * HOUR), count: 3, message: null },
      lastSuccessAt: ago(30 * HOUR),
    }));

    expect(state.state).toBe('stale');
  });

  it('reports a failure, and still says when it last worked', () => {
    const state = describeSyncState(input({
      lastRun: { status: 'failed', startedAt: ago(MINUTE), finishedAt: ago(MINUTE), count: 0, message: 'token exchange failed' },
      lastSuccessAt: ago(3 * HOUR),
    }));

    expect(state).toMatchObject({ state: 'failed', message: 'token exchange failed' });
    expect(state.lastSyncedAt).toEqual(ago(3 * HOUR));
  });

  it('shows a recent run as in progress', () => {
    const state = describeSyncState(input({
      lastRun: { status: 'running', startedAt: ago(MINUTE), finishedAt: null, count: 0, message: null },
    }));

    expect(state.state).toBe('running');
  });

  // A row stays `running` if the process died mid-sync. Left alone it would
  // read as in progress forever, and never as a problem.
  it('treats a long-running row as stalled rather than in progress', () => {
    const state = describeSyncState(input({
      lastRun: { status: 'running', startedAt: ago(4 * HOUR), finishedAt: null, count: 0, message: null },
      lastSuccessAt: ago(5 * HOUR),
    }));

    expect(state.state).toBe('stalled');
  });

  it('does not treat a stalled run as a fresh sync', () => {
    const state = describeSyncState(input({
      lastRun: { status: 'running', startedAt: ago(4 * HOUR), finishedAt: null, count: 0, message: null },
      lastSuccessAt: null,
    }));

    expect(state.lastSyncedAt).toBeNull();
  });

  it('honours a caller-supplied staleness threshold', () => {
    const args = {
      lastRun: { status: 'ok' as const, startedAt: ago(2 * HOUR), finishedAt: ago(2 * HOUR), count: 1, message: null },
      lastSuccessAt: ago(2 * HOUR),
    };

    expect(describeSyncState(input({ ...args, staleAfterHours: 1 })).state).toBe('stale');
    expect(describeSyncState(input({ ...args, staleAfterHours: 6 })).state).toBe('ok');
  });

  // Legacy rows use a different status vocabulary: `success`/`error` rather
  // than `ok`/`failed`. They say nothing about the current sync and must not
  // override the inferred status of current data.
  describe('rows left behind by the removed integration', () => {
    it('does not count a legacy row as a run of this sync', () => {
      expect(isCurrentRun({ status: 'error' })).toBe(false);
      expect(isCurrentRun({ status: 'success' })).toBe(false);
    });

    it('counts the statuses this logger writes', () => {
      expect(isCurrentRun({ status: 'ok' })).toBe(true);
      expect(isCurrentRun({ status: 'failed' })).toBe(true);
      expect(isCurrentRun({ status: 'running' })).toBe(true);
    });

    it('falls back to the inferred time rather than reporting a stale failure', () => {
      const legacy = [
        { status: 'success', startedAt: new Date('2025-01-01T00:00:00.000Z'), finishedAt: null, count: 3, message: null },
        { status: 'error', startedAt: new Date('2025-01-01T01:00:00.000Z'), finishedAt: null, count: 0, message: 'API_ANALYTICS 50022' },
      ];
      const syncedAt = ago(HOUR);

      const state = describeSyncState(input({
        lastRun: legacy.filter(isCurrentRun)[0] ?? null,
        inferredSyncedAt: syncedAt,
      }));

      expect(state.state).toBe('inferred');
      expect(state.lastSyncedAt).toEqual(syncedAt);
    });
  });
});
