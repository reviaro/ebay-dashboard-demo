/**
 * A database lease, so two syncs of the same domain cannot run at once.
 *
 * Today the only trigger is a human clicking Sync, and clicking twice is
 * merely wasteful. That stops being true the moment a timer fires: a scheduled
 * run overlapping a manual one means duplicated eBay calls against a rate
 * limit and two writers upserting the same orders. This is the piece that
 * makes unattended syncing safe, which is why it lands before the worker.
 *
 * Acquisition is two single statements, each atomic in SQLite:
 *
 *   1. take over the row if its lease has expired  (`UPDATE ... WHERE expiresAt <= now`)
 *   2. otherwise insert one                        (`INSERT`, unique on name)
 *
 * A live lease makes (1) match nothing and (2) violate the unique index, so a
 * concurrent attempt is refused rather than silently sharing the lock.
 */

import { hostname } from 'os';

/**
 * How long a lease is held before another run may take it over.
 *
 * Sized for the slowest realistic run rather than the typical one: a 90-day
 * orders sync makes many chunked API calls. There is deliberately no renewal
 * heartbeat -- a crashed run leaves the lock held for at most this long, which
 * is inconvenient rather than dangerous, and recovery is automatic. The plan's
 * lease renewal is aimed at Phase 6's ad report tasks, which really do poll
 * for minutes; orders do not need it.
 */
export const LEASE_TTL_MS = 30 * 60_000;

export class SyncLockedError extends Error {
  readonly holder: string | null;
  readonly expiresAt: Date | null;

  constructor(name: string, holder: string | null, expiresAt: Date | null) {
    super(`A sync of ${name} is already running.`);
    this.name = 'SyncLockedError';
    this.holder = holder;
    this.expiresAt = expiresAt;
  }
}

export interface SyncLockRow {
  owner: string;
  acquiredAt: Date;
  expiresAt: Date;
}

/** Storage port, mirroring the other sync ports, so the logic tests without a database. */
export interface SyncLockStore {
  /** Returns the number of rows taken over: 1 when the lease had expired, else 0. */
  takeOverExpired(name: string, owner: string, now: Date, expiresAt: Date): Promise<number>;
  /** False when a row already exists, i.e. someone holds a live lease. */
  insert(name: string, owner: string, now: Date, expiresAt: Date): Promise<boolean>;
  /** Scoped to the owner, so a run can only release its own lease. */
  release(name: string, owner: string): Promise<void>;
  find(name: string): Promise<SyncLockRow | null>;
}

/**
 * Identifies the *process* holding a lease.
 *
 * When a lock is stuck the only useful question is what is holding it, and
 * "manual" does not answer that. It also makes release safe: two sequential
 * manual runs get different ids, so one cannot release the other's lease.
 */
export function makeOwnerId(trigger: string, pid: number = process.pid): string {
  return `${trigger}:${pid}@${hostname()}`;
}

export async function withSyncLock<T>(options: {
  store: SyncLockStore;
  name: string;
  owner: string;
  run: () => Promise<T>;
  ttlMs?: number;
  now?: () => Date;
}): Promise<T> {
  const { store, name, owner, run, ttlMs = LEASE_TTL_MS, now = () => new Date() } = options;

  const at = now();
  const expiresAt = new Date(at.getTime() + ttlMs);

  const tookOver = await store.takeOverExpired(name, owner, at, expiresAt);
  if (tookOver === 0) {
    const inserted = await store.insert(name, owner, at, expiresAt);
    if (!inserted) {
      // Report who holds it so the caller can say "already running" rather
      // than "failed". Returning early is what keeps the holder's lease
      // intact -- releasing here would hand it to whoever was turned away.
      const held = await store.find(name);
      throw new SyncLockedError(name, held?.owner ?? null, held?.expiresAt ?? null);
    }
  }

  try {
    return await run();
  } finally {
    await store.release(name, owner);
  }
}
