import { describe, expect, it, vi } from 'vitest';
import {
  LEASE_TTL_MS, SyncLockedError, makeOwnerId, withSyncLock, type SyncLockStore,
} from './sync-lock';

const now = new Date('2026-09-04T12:00:00.000Z');

/** An in-memory lease table with the same two atomic operations as SQLite. */
function memoryStore(initial?: { owner: string; acquiredAt: Date; expiresAt: Date }) {
  let row = initial ? { ...initial } : null;
  const store: SyncLockStore = {
    async takeOverExpired(_name, owner, at, expiresAt) {
      if (row && row.expiresAt.getTime() <= at.getTime()) {
        row = { owner, acquiredAt: at, expiresAt };
        return 1;
      }
      return 0;
    },
    async insert(_name, owner, at, expiresAt) {
      if (row) return false;
      row = { owner, acquiredAt: at, expiresAt };
      return true;
    },
    async release(_name, owner) {
      if (row && row.owner === owner) row = null;
    },
    async find() {
      return row;
    },
  };
  return { store, held: () => row };
}

describe('withSyncLock', () => {
  it('runs the work and releases the lease afterwards', async () => {
    const { store, held } = memoryStore();

    const result = await withSyncLock({
      store, name: 'orders', owner: 'manual:1', now: () => now,
      run: async () => 'synced',
    });

    expect(result).toBe('synced');
    expect(held()).toBeNull();
  });

  it('releases the lease when the work throws, and rethrows', async () => {
    const { store, held } = memoryStore();

    await expect(withSyncLock({
      store, name: 'orders', owner: 'manual:1', now: () => now,
      run: async () => { throw new Error('eBay is down'); },
    })).rejects.toThrow('eBay is down');

    expect(held()).toBeNull();
  });

  it('takes over a lease whose holder has expired', async () => {
    const { store } = memoryStore({
      owner: 'manual:dead', acquiredAt: new Date(now.getTime() - 3_600_000),
      expiresAt: new Date(now.getTime() - 60_000),
    });
    const run = vi.fn().mockResolvedValue('ok');

    await expect(withSyncLock({ store, name: 'orders', owner: 'cli:2', now: () => now, run }))
      .resolves.toBe('ok');
    expect(run).toHaveBeenCalled();
  });

  describe('when another run holds a live lease', () => {
    function heldStore() {
      return memoryStore({
        owner: 'cli:99', acquiredAt: new Date(now.getTime() - 120_000),
        expiresAt: new Date(now.getTime() + 600_000),
      });
    }

    it('refuses, naming the holder and when the lease expires', async () => {
      const { store } = heldStore();

      const error = await withSyncLock({
        store, name: 'orders', owner: 'manual:1', now: () => now, run: async () => 'ok',
      }).catch(e => e);

      expect(error).toBeInstanceOf(SyncLockedError);
      expect(error.holder).toBe('cli:99');
      expect(error.expiresAt).toEqual(new Date(now.getTime() + 600_000));
    });

    it('does not run the work', async () => {
      const { store } = heldStore();
      const run = vi.fn();

      await expect(withSyncLock({ store, name: 'orders', owner: 'manual:1', now: () => now, run }))
        .rejects.toBeInstanceOf(SyncLockedError);
      expect(run).not.toHaveBeenCalled();
    });

    // Releasing on the way out of a *failed* acquisition would hand the
    // running sync's lease to whoever was turned away.
    it('leaves the holder’s lease intact', async () => {
      const { store, held } = heldStore();

      await expect(withSyncLock({
        store, name: 'orders', owner: 'manual:1', now: () => now, run: async () => 'ok',
      })).rejects.toBeInstanceOf(SyncLockedError);

      expect(held()).toMatchObject({ owner: 'cli:99' });
    });
  });

  it('leases for the configured window', async () => {
    const { store } = memoryStore();
    let seen: Date | null = null;
    const spy: SyncLockStore = {
      ...store,
      async insert(name, owner, at, expiresAt) { seen = expiresAt; return store.insert(name, owner, at, expiresAt); },
    };

    await withSyncLock({ store: spy, name: 'orders', owner: 'manual:1', now: () => now, run: async () => null });

    expect(seen).toEqual(new Date(now.getTime() + LEASE_TTL_MS));
  });
});

describe('makeOwnerId', () => {
  // "manual" does not answer the only question that matters when a lease is
  // stuck: which process is holding it.
  it('identifies the process, not just how it was triggered', () => {
    const id = makeOwnerId('manual');

    expect(id).toMatch(/^manual:\d+@/);
    expect(id).not.toBe('manual');
  });

  it('gives two runs of the same trigger different identities', () => {
    expect(makeOwnerId('cli')).not.toBe(makeOwnerId('cli', 12345));
  });
});
