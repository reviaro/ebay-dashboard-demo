/**
 * Resumable chunked work.
 *
 * A long sync is tiled into date chunks (`ranges.ts`). Without a record of
 * which tiles committed, an interrupted run has two bad options on retry: redo
 * everything, or skip blindly. This keeps that record, so a retry does exactly
 * the work that is still outstanding.
 *
 * The rule from the plan is the important one: **advance the checkpoint only
 * after the chunk's writes commit.** A chunk that threw is never marked done,
 * because a checkpoint written ahead of the data silently loses it.
 *
 * A failing chunk does not abort the run. One bad tile should cost its own
 * data, not the tiles after it -- and it is retried next time, up to an
 * attempt limit so a permanently broken chunk cannot be retried forever.
 *
 * `canContinue` is the exception: a caller that knows it is out of budget --
 * an API quota, a time limit -- stops the loop *before* the next chunk is
 * attempted, so the untouched chunks keep their attempts and simply run next
 * time. Without it a run that hits a daily quota would spend three ticks
 * failing every remaining chunk and then abandon them permanently, which is
 * the opposite of what the attempt limit is for.
 *
 * Orders do not use this yet, and deliberately so: a 90-day orders sync
 * finishes in about a second, where resume buys nothing. It is built for the
 * asynchronous report tasks in Phase 6, which poll for minutes and carry an
 * external task id per chunk.
 */

export interface ChunkRecord {
  rangeStart: Date;
  rangeEnd: Date;
  /** pending | done | failed */
  status: string;
  attempts: number;
  /** Pagination position inside the chunk, for jobs that page. */
  cursor: string | null;
  /** External async task ID (e.g., eBay report task), for resumable polling. */
  externalId: string | null;
}

export interface ChunkRange {
  from: Date;
  to: Date;
}

export interface ChunkStore {
  /** Idempotent: creates any chunk row that does not exist yet. */
  ensure(runKey: string, domain: string, ranges: ChunkRange[]): Promise<void>;
  /**
   * Every chunk not yet done, regardless of attempts. The attempt limit is
   * applied by the caller so the give-up policy stays in tested code rather
   * than in each storage adapter.
   */
  pending(runKey: string): Promise<ChunkRecord[]>;
  markAttempt(runKey: string, from: Date, to: Date): Promise<void>;
  markDone(runKey: string, from: Date, to: Date): Promise<void>;
  markFailed(runKey: string, from: Date, to: Date, error: string): Promise<void>;
  /** Persist an external task ID for resumable polling. */
  setExternalId(runKey: string, from: Date, to: Date, externalId: string): Promise<void>;
}

export interface ChunkedResult {
  completed: number;
  failed: number;
  /** Chunks an earlier run had already committed. */
  skipped: number;
  /** Chunks abandoned because they hit the attempt limit. */
  exhausted: number;
  /** Chunks left untouched because `canContinue` said to stop. */
  remaining: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;

/** Where a stored chunk sits in the list the caller asked for. */
function position(ranges: ChunkRange[], chunk: ChunkRecord): number {
  const index = ranges.findIndex(
    (range) =>
      range.from.getTime() === chunk.rangeStart.getTime() &&
      range.to.getTime() === chunk.rangeEnd.getTime()
  );
  // A chunk from an earlier, differently tiled run goes last rather than first.
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export async function runChunked(options: {
  store: ChunkStore;
  runKey: string;
  domain: string;
  ranges: ChunkRange[];
  work: (chunk: ChunkRecord, helpers?: { setExternalId(id: string): Promise<void> }) => Promise<void>;
  maxAttempts?: number;
  /** Checked before each chunk; false stops the run without touching the rest. */
  canContinue?: () => boolean;
}): Promise<ChunkedResult> {
  const {
    store, runKey, domain, ranges, work,
    maxAttempts = DEFAULT_MAX_ATTEMPTS, canContinue,
  } = options;

  await store.ensure(runKey, domain, ranges);

  const notDone = await store.pending(runKey);
  const outstanding = notDone
    .filter((chunk) => chunk.attempts < maxAttempts)
    // Restored to the caller's order. A store returns rows in whatever order
    // its query gives -- the Prisma one sorts by rangeStart -- which silently
    // discarded `newest-first` and made a budget-limited backfill start at the
    // oldest day instead of the most useful one.
    .sort((a, b) => position(ranges, a) - position(ranges, b));

  const result: ChunkedResult = {
    completed: 0,
    failed: 0,
    // Chunks an earlier run committed, as opposed to ones abandoned below.
    skipped: ranges.length - notDone.length,
    // Still not done, but out of attempts: a permanently broken chunk must
    // stop being retried on every tick.
    exhausted: notDone.length - outstanding.length,
    remaining: 0,
  };

  for (const [index, chunk] of outstanding.entries()) {
    // Before markAttempt on purpose: a chunk we never tried must not be
    // charged for it.
    if (canContinue && !canContinue()) {
      result.remaining = outstanding.length - index;
      break;
    }

    // Counted before the attempt, so a chunk that crashes the process still
    // burns an attempt rather than retrying forever.
    await store.markAttempt(runKey, chunk.rangeStart, chunk.rangeEnd);

    try {
      const helpers = {
        setExternalId: (id: string) => store.setExternalId(runKey, chunk.rangeStart, chunk.rangeEnd, id),
      };
      await work(chunk, helpers);
      await store.markDone(runKey, chunk.rangeStart, chunk.rangeEnd);
      result.completed++;
    } catch (error) {
      await store.markFailed(
        runKey,
        chunk.rangeStart,
        chunk.rangeEnd,
        error instanceof Error ? error.message : String(error)
      );
      result.failed++;
      // Deliberately continues: see the note above.
    }
  }

  return result;
}
