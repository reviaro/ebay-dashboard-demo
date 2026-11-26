import { describe, expect, it, vi } from 'vitest';
import { runOrdersSync } from './run-orders';
import { SyncLockedError, type SyncLockStore } from '../sync-lock';
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

function heldLock(): SyncLockStore {
  const held = { owner: 'cron:1@host', acquiredAt: new Date(), expiresAt: new Date(Date.now() + 600_000) };
  return {
    async takeOverExpired() { return 0; },
    async insert() { return false; },
    async release() {},
    async find() { return held; },
  };
}

function recorder() {
  const started: string[] = [];
  const finished: { status: string; count: number; message: string | null }[] = [];
  const rec: SyncRunRecorder = {
    async start(type) { started.push(type); return 1; },
    async finish(_id, u) { finished.push({ status: u.status, count: u.count, message: u.message }); },
  };
  return { rec, started, finished };
}

describe('runOrdersSync', () => {
  it('runs the sync and reports what it stored', async () => {
    const { rec, finished } = recorder();
    const sync = vi.fn().mockResolvedValue({ stored: 4, fetched: 4 });

    const result = await runOrdersSync({
      lockStore: freeLock(), recorder: rec, trigger: 'cron', days: 30,
      resolve: () => ({ config: {} as never, accounts: {} as never }),
      writer: {} as never, sync,
    });

    expect(result).toMatchObject({ stored: 4 });
    expect(finished).toEqual([{ status: 'ok', count: 4, message: null }]);
  });

  // Configuration is resolved inside the run record on purpose: a sync that
  // dies before eBay is contacted is the failure most worth being able to
  // look up, and it is invisible if config is read before the record opens.
  it('logs a failure that happens before eBay is ever contacted', async () => {
    const { rec, finished } = recorder();

    await expect(runOrdersSync({
      lockStore: freeLock(), recorder: rec, trigger: 'cron', days: 30,
      resolve: () => { throw new Error('EBAY_CLIENT_ID is not set'); },
      writer: {} as never, sync: vi.fn(),
    })).rejects.toThrow('EBAY_CLIENT_ID is not set');

    expect(finished).toEqual([
      { status: 'failed', count: 0, message: 'EBAY_CLIENT_ID is not set' },
    ]);
  });

  it('does not open a run record when another sync holds the lease', async () => {
    const { rec, started } = recorder();
    const sync = vi.fn();

    await expect(runOrdersSync({
      lockStore: heldLock(), recorder: rec, trigger: 'manual', days: 7,
      resolve: () => ({ config: {} as never, accounts: {} as never }),
      writer: {} as never, sync,
    })).rejects.toBeInstanceOf(SyncLockedError);

    expect(started).toEqual([]);
    expect(sync).not.toHaveBeenCalled();
  });

  it('asks for the window the caller requested', async () => {
    const now = new Date('2026-09-04T12:00:00.000Z');
    const sync = vi.fn().mockResolvedValue({ stored: 0 });

    await runOrdersSync({
      lockStore: freeLock(), recorder: recorder().rec, trigger: 'cron', days: 30,
      resolve: () => ({ config: {} as never, accounts: {} as never }),
      writer: {} as never, sync, now: () => now,
    });

    const range = sync.mock.calls[0][0].range;
    expect(range.to).toEqual(now);
    expect(range.from).toEqual(new Date(now.getTime() - 29 * 86_400_000));
  });
});
