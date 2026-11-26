import { describe, expect, it, vi } from 'vitest';
import { runChunked, type ChunkStore, type ChunkRecord } from './checkpoints';

const day = (n: number) => new Date(Date.UTC(2026, 8, n));
const ranges = [
  { from: day(1), to: day(2) },
  { from: day(2), to: day(3) },
  { from: day(3), to: day(4) },
];

/** In-memory chunk table with the same semantics as the Prisma one. */
function memoryStore(seed: Partial<ChunkRecord>[] = []) {
  const rows: ChunkRecord[] = [];
  const key = (a: Date, b: Date) => `${a.toISOString()}|${b.toISOString()}`;

  const store: ChunkStore = {
    async ensure(_runKey, _domain, list) {
      for (const r of list) {
        if (!rows.some((row) => key(row.rangeStart, row.rangeEnd) === key(r.from, r.to))) {
          rows.push({ rangeStart: r.from, rangeEnd: r.to, status: 'pending', attempts: 0, cursor: null, externalId: null });
        }
      }
    },
    async pending(_runKey) {
      return rows.filter((r) => r.status !== 'done');
    },
    async markAttempt(_runKey, from, to) {
      const row = rows.find((r) => key(r.rangeStart, r.rangeEnd) === key(from, to))!;
      row.attempts += 1;
    },
    async markDone(_runKey, from, to) {
      const row = rows.find((r) => key(r.rangeStart, r.rangeEnd) === key(from, to))!;
      row.status = 'done';
    },
    async markFailed(_runKey, from, to) {
      const row = rows.find((r) => key(r.rangeStart, r.rangeEnd) === key(from, to))!;
      row.status = 'failed';
    },
    async setExternalId(_runKey, from, to, externalId) {
      const row = rows.find((r) => key(r.rangeStart, r.rangeEnd) === key(from, to))!;
      row.externalId = externalId;
    },
  };

  for (const s of seed) {
    rows.push({ rangeStart: day(1), rangeEnd: day(2), status: 'pending', attempts: 0, cursor: null, externalId: null, ...s });
  }
  return { store, rows };
}

describe('runChunked', () => {
  it('processes every chunk and marks each done', async () => {
    const { store, rows } = memoryStore();
    const work = vi.fn().mockResolvedValue(undefined);

    const result = await runChunked({ store, runKey: 'orders:1', domain: 'orders', ranges, work });

    expect(work).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ completed: 3, failed: 0 });
    expect(rows.every((r) => r.status === 'done')).toBe(true);
  });

  // The point of the table: a second run must not redo committed work.
  it('skips chunks a previous run already committed', async () => {
    const { store } = memoryStore([
      { rangeStart: day(1), rangeEnd: day(2), status: 'done' },
    ]);
    const work = vi.fn().mockResolvedValue(undefined);

    const result = await runChunked({ store, runKey: 'orders:1', domain: 'orders', ranges, work });

    expect(work).toHaveBeenCalledTimes(2);
    expect(result.completed).toBe(2);
  });

  it('does nothing at all once every chunk is done', async () => {
    const { store } = memoryStore();
    const work = vi.fn().mockResolvedValue(undefined);
    await runChunked({ store, runKey: 'orders:1', domain: 'orders', ranges, work });
    work.mockClear();

    const result = await runChunked({ store, runKey: 'orders:1', domain: 'orders', ranges, work });

    expect(work).not.toHaveBeenCalled();
    expect(result).toMatchObject({ completed: 0, skipped: 3 });
  });

  describe('when a chunk fails', () => {
    // "Advance the checkpoint only after every page/chunk commits" -- a chunk
    // that threw must not be recorded as done, or its data is lost silently.
    it('does not mark it done', async () => {
      const { store, rows } = memoryStore();
      const work = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('eBay 500'))
        .mockResolvedValueOnce(undefined);

      const result = await runChunked({ store, runKey: 'orders:1', domain: 'orders', ranges, work });

      expect(result).toMatchObject({ completed: 2, failed: 1 });
      expect(rows.filter((r) => r.status === 'done')).toHaveLength(2);
      expect(rows.filter((r) => r.status === 'failed')).toHaveLength(1);
    });

    it('keeps going, so one bad chunk does not cost the others', async () => {
      const { store } = memoryStore();
      const work = vi.fn()
        .mockRejectedValueOnce(new Error('eBay 500'))
        .mockResolvedValue(undefined);

      const result = await runChunked({ store, runKey: 'orders:1', domain: 'orders', ranges, work });

      expect(work).toHaveBeenCalledTimes(3);
      expect(result.completed).toBe(2);
    });

    it('retries it on the next run', async () => {
      const { store } = memoryStore();
      const failing = vi.fn().mockRejectedValue(new Error('eBay 500'));
      await runChunked({ store, runKey: 'orders:1', domain: 'orders', ranges: [ranges[0]], work: failing });

      const recovering = vi.fn().mockResolvedValue(undefined);
      const result = await runChunked({ store, runKey: 'orders:1', domain: 'orders', ranges: [ranges[0]], work: recovering });

      expect(recovering).toHaveBeenCalledTimes(1);
      expect(result.completed).toBe(1);
    });

    // Otherwise a permanently broken chunk is retried on every tick forever.
    it('gives up on it after the attempt limit', async () => {
      const { store } = memoryStore();
      const work = vi.fn().mockRejectedValue(new Error('permanently broken'));
      const one = { store, runKey: 'orders:1', domain: 'orders', ranges: [ranges[0]], work, maxAttempts: 2 };

      await runChunked(one);
      await runChunked(one);
      work.mockClear();
      const result = await runChunked(one);

      expect(work).not.toHaveBeenCalled();
      expect(result).toMatchObject({ completed: 0, exhausted: 1 });
    });
  });
});

const fiveDays = [1, 2, 3, 4, 5].map((n) => ({ from: day(n), to: day(n) }));

describe('runChunked budget', () => {
  /**
   * The case this exists for: eBay allows 100 traffic_report calls a day. A run
   * that keeps going once the budget is gone gets refused, marks chunk after
   * chunk failed, and after three ticks abandons the rest of a backfill for
   * good -- the opposite of what the attempt limit is for.
   */
  it('stops before a chunk it cannot afford, leaving it untouched', async () => {
    const { store, rows } = memoryStore();
    const work = vi.fn(async () => {});
    let budget = 2;

    const result = await runChunked({
      store,
      runKey: 'traffic:listing:x',
      domain: 'traffic',
      ranges: fiveDays,
      canContinue: () => budget-- > 0,
      work,
    });

    expect(work).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ completed: 2, failed: 0, remaining: 3 });
    // Untouched means untouched: no attempt is charged to a chunk never tried.
    expect(rows.filter((r) => r.status === 'pending' && r.attempts === 0)).toHaveLength(3);
  });

  /**
   * The store returns rows in its own order -- the Prisma one sorts by
   * rangeStart -- so without this a `newest-first` backfill silently started at
   * the oldest day, and a budget-limited run spent its whole allowance on 2024
   * before touching this week.
   */
  it('follows the order the caller asked for, not the store\u2019s', async () => {
    const { store } = memoryStore();
    const seen: string[] = [];
    const newestFirst = [...fiveDays].reverse();

    await runChunked({
      store,
      runKey: 'traffic:listing:z',
      domain: 'traffic',
      ranges: newestFirst,
      work: async (chunk) => { seen.push(chunk.rangeStart.toISOString().slice(0, 10)); },
    });

    expect(seen).toEqual(['2026-09-05', '2026-09-04', '2026-09-03', '2026-09-02', '2026-09-01']);
  });

  it('runs everything when no budget is given', async () => {
    const { store } = memoryStore();
    const work = vi.fn(async () => {});

    const result = await runChunked({
      store, runKey: 'traffic:listing:y', domain: 'traffic', ranges: fiveDays, work,
    });

    expect(work).toHaveBeenCalledTimes(5);
    expect(result.remaining).toBe(0);
  });
});

describe('externalId (async task tracking)', () => {
  it('persists externalId before work throws, so a resume can poll the task', async () => {
    const { store, rows } = memoryStore();
    const work = vi.fn(async (_chunk, helpers) => {
      await helpers!.setExternalId('task-123');
      throw new Error('poll failed');
    });

    const result = await runChunked({ store, runKey: 'ads:sync', domain: 'ads', ranges: [ranges[0]], work });

    expect(result).toMatchObject({ completed: 0, failed: 1 });
    const chunk = rows.find((r) => r.rangeStart.getTime() === day(1).getTime())!;
    expect(chunk.status).toBe('failed');
    expect(chunk.externalId).toBe('task-123');
  });

  it('passes stored externalId to work on resume', async () => {
    const { store } = memoryStore([
      { rangeStart: day(1), rangeEnd: day(2), status: 'failed', externalId: 'task-456', attempts: 1, cursor: null },
    ]);
    const seen: (string | null)[] = [];
    const work = vi.fn(async (chunk) => { seen.push(chunk.externalId ?? null); });

    await runChunked({ store, runKey: 'ads:sync', domain: 'ads', ranges: [ranges[0]], work });

    expect(seen).toEqual(['task-456']);
  });
});
