import { describe, expect, it, vi } from 'vitest';
import { runPayoutSync } from './run-payout';
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

function financeStub() {
  return {
    saveTransactions: vi.fn(async () => 0),
    savePayouts: vi.fn(async (rows: unknown[]) => rows.length),
    attachPayout: vi.fn(async () => {}),
    earliestTransactionDate: vi.fn(async () => null),
  };
}

describe('runPayoutSync', () => {
  it('fetches the window, saves the payouts, and reports the count', async () => {
    const { rec, finished } = recorder();
    const finance = financeStub();
    const fetchPayouts = vi.fn().mockImplementation(async () => [{ id: 'p1' }, { id: 'p2' }]);

    const result = await runPayoutSync({
      lockStore: freeLock(),
      recorder: rec,
      finance: finance as never,
      trigger: 'test',
      days: 14,
      resolve: () => ({ config: { marketplaceId: 'EBAY_US' } as never, accounts: { find: async () => ({ id: 'account-1' }) } as never }),
      fetchPayouts: fetchPayouts as never,
      now: () => new Date('2026-06-20T00:00:00Z'),
    });

    const [call] = fetchPayouts.mock.calls[0];
    expect(call.from.toISOString().slice(0, 10)).toBe('2026-06-07');
    expect(call.to.toISOString().slice(0, 10)).toBe('2026-06-20');
    expect(finance.savePayouts).toHaveBeenCalledWith([{ id: 'p1' }, { id: 'p2' }]);
    expect(result.payoutRows).toBe(2);
    expect(finished).toEqual([{ status: 'ok', count: 2, message: null }]);
  });

  it('does not touch attachPayout — the transaction mapper carries the link', async () => {
    const finance = financeStub();
    await runPayoutSync({
      lockStore: freeLock(),
      recorder: recorder().rec,
      finance: finance as never,
      trigger: 'test',
      days: 7,
      resolve: () => ({ config: { marketplaceId: 'EBAY_US' } as never, accounts: { find: async () => ({ id: 'account-1' }) } as never }),
      fetchPayouts: vi.fn(async () => []) as never,
      now: () => new Date('2026-06-20T00:00:00Z'),
    });
    expect(finance.attachPayout).not.toHaveBeenCalled();
  });

  it('records a failure when the fetch throws', async () => {
    const { rec, finished } = recorder();
    await expect(
      runPayoutSync({
        lockStore: freeLock(),
        recorder: rec,
        finance: financeStub() as never,
        trigger: 'test',
        days: 14,
        resolve: () => ({ config: { marketplaceId: 'EBAY_US' } as never, accounts: { find: async () => ({ id: 'account-1' }) } as never }),
        fetchPayouts: vi.fn(async () => { throw new Error('eBay 503'); }) as never,
        now: () => new Date('2026-06-20T00:00:00Z'),
      })
    ).rejects.toThrow('eBay 503');
    expect(finished).toEqual([expect.objectContaining({ status: 'failed' })]);
  });
});
