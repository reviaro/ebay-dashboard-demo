/**
 * Records that a sync ran, what it did, and whether it worked.
 *
 * `EbaySyncLog` makes unattended syncing reviewable without relying on a human
 * to watch each HTTP response.
 *
 * The record opens *before* the work starts, so failures that happen before
 * eBay is ever contacted -- missing configuration, a disconnected account --
 * are logged too. Those are the ones worth seeing; a successful sync is the
 * case nobody needs a log for.
 *
 * Logging never changes the outcome of a sync: a recorder that throws is
 * swallowed, and the sync's own error is always the one that propagates.
 */

import { redactString } from '../redact';

/** Long enough to diagnose, short enough that one bad error cannot bloat the table. */
export const MESSAGE_LIMIT = 500;

export type SyncRunStatus = 'running' | 'ok' | 'failed';

export interface SyncRunUpdate {
  status: Exclude<SyncRunStatus, 'running'>;
  count: number;
  message: string | null;
  finishedAt: Date;
}

/** Storage port, mirroring `OrderWriter`, so the logic stays testable. */
export interface SyncRunRecorder {
  start(type: string, startedAt: Date): Promise<number>;
  finish(id: number, update: SyncRunUpdate): Promise<void>;
}

/**
 * The message is scrubbed before it is stored, not just before it is returned.
 * A row here outlives the request and ends up in database backups, so an
 * unredacted eBay error would be a durable copy of whatever it embedded.
 */
function describe(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactString(raw).slice(0, MESSAGE_LIMIT);
}

export async function recordSyncRun<T>(options: {
  recorder: SyncRunRecorder;
  type: string;
  run: () => Promise<T>;
  count?: (result: T) => number;
  /**
   * A note to keep on a run that *succeeded* -- a partial result, a window
   * that had to be clamped, a day eBay truncated. Without it the only runs
   * that can say anything are the ones that failed, and a sync that quietly
   * stored two thirds of what it asked for looks identical to a clean one.
   */
  message?: (result: T) => string | null;
  now?: () => Date;
}): Promise<T> {
  const { recorder, type, run, count, message, now = () => new Date() } = options;

  let id: number | null = null;
  try {
    id = await recorder.start(type, now());
  } catch {
    // Observability is not the job. Run the sync anyway, unlogged.
    id = null;
  }

  const close = async (update: SyncRunUpdate) => {
    if (id === null) return;
    try {
      await recorder.finish(id, update);
    } catch {
      // Deliberately swallowed: see the note above.
    }
  };

  let result: T;
  try {
    result = await run();
  } catch (error) {
    await close({ status: 'failed', count: 0, message: describe(error), finishedAt: now() });
    throw error;
  }

  await close({
    status: 'ok',
    count: count ? count(result) : 0,
    message: message ? (message(result)?.slice(0, MESSAGE_LIMIT) ?? null) : null,
    finishedAt: now(),
  });

  return result;
}
