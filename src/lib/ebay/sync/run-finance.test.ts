import { describe, expect, it, vi } from 'vitest';
import { calendarMonthTiles, FinanceSyncError, runFinanceSync } from './run-finance';
import type { ChunkRange, ChunkRecord, ChunkStore } from './checkpoints';
import type { SyncLockStore } from '../sync-lock';
import type { SyncRunRecorder } from './run-log';

function freeLock(): SyncLockStore {
  let row: { owner: string; acquiredAt: Date; expiresAt: Date } | null = null;
  return {
    async takeOverExpired() { return 0; },
    async insert(_n, owner, at, expiresAt) {
      if (row) return false;
      row = { owner, acquiredAt: at, expiresAt };
      return true;
    },
    async release() { row = null; },
    async find() { return row; },
  };
}

function recorder() {
  const finished: { status: string; count: number; message: string | null }[] = [];
  const rec: SyncRunRecorder = {
    async start() { return 1; },
    async finish(_id, u) { finished.push({ status: u.status, count: u.count, message: u.message }); },
  };
  return { rec, finished };
}

/** Faithful in-memory ChunkStore: empty-update upsert, keyed on runKey+range. */
function memChunks() {
  const rows = new Map<string, ChunkRecord & { runKey: string }>();
  const key = (rk: string, from: Date, to: Date) => `${rk}|${from.getTime()}|${to.getTime()}`;
  const store: ChunkStore = {
    async ensure(runKey, _domain, ranges: ChunkRange[]) {
      for (const r of ranges) {
        const k = key(runKey, r.from, r.to);
        if (!rows.has(k)) {
          rows.set(k, { runKey, rangeStart: r.from, rangeEnd: r.to, status: 'pending', attempts: 0, cursor: null, externalId: null });
        }
      }
    },
    async pending(runKey) {
      return [...rows.values()].filter((r) => r.runKey === runKey && r.status !== 'done')
        .map((r) => ({ rangeStart: r.rangeStart, rangeEnd: r.rangeEnd, status: r.status, attempts: r.attempts, cursor: r.cursor, externalId: r.externalId }));
    },
    async markAttempt(runKey, from, to) { rows.get(key(runKey, from, to))!.attempts += 1; },
    async markDone(runKey, from, to) { rows.get(key(runKey, from, to))!.status = 'done'; },
    async markFailed(runKey, from, to) { rows.get(key(runKey, from, to))!.status = 'failed'; },
    async setExternalId(runKey, from, to, externalId) { rows.get(key(runKey, from, to))!.externalId = externalId; },
  };
  return { store, count: () => rows.size, doneCount: () => [...rows.values()].filter((r) => r.status === 'done').length };
}

function financeStub() {
  const saved: unknown[] = [];
  const store = {
    saveTransactions: vi.fn(async (rows: unknown[]) => { saved.push(...rows); return rows.length; }),
    savePayouts: vi.fn(async () => 0),
    attachPayout: vi.fn(async () => {}),
    earliestTransactionDate: vi.fn(async () => null),
  };
  return { store, saved };
}

const baseOptions = (over: Record<string, unknown>) => ({
  lockStore: freeLock(),
  trigger: 'test',
  days: 14,
  resolve: () => ({ config: { marketplaceId: 'EBAY_US' } as never, accounts: { find: async () => ({ id: 'account-1' }) } as never }),
  fetchPayouts: vi.fn(async () => []),
  ...over,
});

describe('calendarMonthTiles', () => {
  it('emits one full-month tile per month the range touches, on fixed boundaries', () => {
    const tiles = calendarMonthTiles(new Date('2026-01-15T00:00:00Z'), new Date('2026-03-04T00:00:00Z'));
    expect(tiles).toEqual([
      { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-01-31T00:00:00.000Z') },
      { from: new Date('2026-02-01T00:00:00.000Z'), to: new Date('2026-02-28T00:00:00.000Z') },
      { from: new Date('2026-03-01T00:00:00.000Z'), to: new Date('2026-03-31T00:00:00.000Z') },
    ]);
  });

  it('spans a year boundary', () => {
    const tiles = calendarMonthTiles(new Date('2025-11-20T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));
    expect(tiles.map((t) => t.from.toISOString().slice(0, 7))).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('runFinanceSync', () => {
  it('fetches the refresh window, stores rows, and reports them', async () => {
    const { store, saved } = financeStub();
    const { rec, finished } = recorder();
    const fetchTransactions = vi.fn().mockImplementation(async () => [{ transactionId: 't1' }]);

    const result = await runFinanceSync(baseOptions({
      recorder: rec,
      chunks: memChunks().store,
      finance: store,
      fetchTransactions,
      now: () => new Date('2026-06-20T00:00:00Z'),
    }) as never);

    // refresh window = [today - 13 .. today]
    const [refreshCall] = fetchTransactions.mock.calls[0];
    expect(refreshCall.from.toISOString().slice(0, 10)).toBe('2026-06-07');
    expect(refreshCall.to.toISOString().slice(0, 10)).toBe('2026-06-20');
    expect(saved.length).toBeGreaterThan(0);
    expect(result.transactionRows).toBeGreaterThan(0);
    expect(finished).toEqual([{ status: 'ok', count: result.transactionRows, message: null }]);
  });

  it('tiles the backfill on calendar months and marks each done', async () => {
    const { store } = financeStub();
    const chunks = memChunks();
    const fetchTransactions = vi.fn().mockImplementation(async () => []);

    await runFinanceSync(baseOptions({
      recorder: recorder().rec,
      chunks: chunks.store,
      finance: store,
      fetchTransactions,
      now: () => new Date('2026-06-20T00:00:00Z'),
    }) as never);

    // 2024-06 .. 2026-06 inclusive = 25 months
    expect(chunks.count()).toBe(25);
    expect(chunks.doneCount()).toBe(25);
    // every backfill window starts on the 1st
    for (const [{ from }] of fetchTransactions.mock.calls.slice(1)) {
      expect(from.getUTCDate()).toBe(1);
    }
  });

  it('does not re-fetch backfill months when the clock advances a day', async () => {
    const { store } = financeStub();
    const chunks = memChunks();
    const fetchTransactions = vi.fn(async () => []);
    const shared = {
      ...baseOptions({ recorder: recorder().rec, chunks: chunks.store, finance: store, fetchTransactions }),
    };

    await runFinanceSync({ ...shared, now: () => new Date('2026-06-20T00:00:00Z') } as never);
    const afterFirst = fetchTransactions.mock.calls.length;
    const rowsAfterFirst = chunks.count();

    await runFinanceSync({ ...shared, now: () => new Date('2026-06-21T00:00:00Z') } as never);

    // second run re-fetches only the (moved) refresh window, no backfill month
    expect(fetchTransactions.mock.calls.length).toBe(afterFirst + 1);
    expect(chunks.count()).toBe(rowsAfterFirst);
  });

  it('throws FinanceSyncError when every backfill month fails and none commit', async () => {
    const { store } = financeStub();
    const { rec, finished } = recorder();
    let call = 0;
    // first call (refresh) succeeds empty; every backfill month throws
    const fetchTransactions = vi.fn(async () => {
      if (call++ === 0) return [];
      throw new Error('eBay 500');
    });

    await expect(
      runFinanceSync(baseOptions({
        recorder: rec,
        chunks: memChunks().store,
        finance: store,
        fetchTransactions,
        now: () => new Date('2026-06-20T00:00:00Z'),
      }) as never)
    ).rejects.toThrow(FinanceSyncError);

    expect(finished).toEqual([expect.objectContaining({ status: 'failed' })]);
  });
});
