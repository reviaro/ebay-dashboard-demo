import { describe, expect, it, vi } from 'vitest';
import { runTrafficSync, TrafficSyncError } from './run-traffic';
import type { SyncLockStore } from '../sync-lock';
import type { SyncRunRecorder } from './run-log';
import type { ChunkRange, ChunkRecord, ChunkStore } from './checkpoints';
import type { TrafficStore } from './prisma-traffic-writer';
import type { TrafficDayRow, TrafficListingRow } from '../mappers/traffic-report';
import type { DateRange } from '../ranges';

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

/** In-memory chunk table, keeping the semantics `runChunked` relies on. */
function chunkStore() {
  const runs = new Map<string, ChunkRecord[]>();
  const find = (runKey: string, from: Date, to: Date) =>
    (runs.get(runKey) ?? []).find(
      (c) => c.rangeStart.getTime() === from.getTime() && c.rangeEnd.getTime() === to.getTime()
    );

  const store: ChunkStore = {
    async ensure(runKey, _domain, ranges: ChunkRange[]) {
      const rows = runs.get(runKey) ?? [];
      for (const range of ranges) {
        if (!find(runKey, range.from, range.to)) {
          rows.push({ rangeStart: range.from, rangeEnd: range.to, status: 'pending', attempts: 0, cursor: null, externalId: null });
        }
      }
      runs.set(runKey, rows);
    },
    // Sorted by rangeStart like the Prisma store, which is what `runChunked`
    // has to re-order.
    async pending(runKey) {
      return (runs.get(runKey) ?? [])
        .filter((c) => c.status !== 'done')
        .sort((a, b) => a.rangeStart.getTime() - b.rangeStart.getTime());
    },
    async markAttempt(runKey, from, to) { const c = find(runKey, from, to); if (c) c.attempts++; },
    async markDone(runKey, from, to) { const c = find(runKey, from, to); if (c) c.status = 'done'; },
    async markFailed(runKey, from, to) { const c = find(runKey, from, to); if (c) c.status = 'failed'; },
    async setExternalId(runKey, from, to, externalId) { const c = find(runKey, from, to); if (c) c.externalId = externalId; },
  };

  return { store, runs };
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const MARKETPLACES = ['EBAY_US', 'EBAY_MOTORS_US'];

/**
 * Store-wide coverage with no holes, which is the steady state. Tests about
 * the repair pass supply their own gappy version; everywhere else this keeps
 * that pass quiet so each test exercises only what it is about.
 */
function completeDayCoverage(except: Date[] = []): { marketplaceId: string; date: Date }[] {
  const skip = new Set(except.map((d) => d.getTime()));
  const rows: { marketplaceId: string; date: Date }[] = [];
  // Runs a little past the tests' "today" so a case that advances the clock by
  // a day does not trip the repair pass on a day the fixture simply predates.
  for (let t = Date.UTC(2024, 8, 1); t <= Date.UTC(2026, 8, 8); t += 86_400_000) {
    for (const marketplaceId of MARKETPLACES) {
      // A gap is per marketplace; one marketplace can retain complete coverage.
      if (marketplaceId === 'EBAY_MOTORS_US' && skip.has(t)) continue;
      rows.push({ marketplaceId, date: new Date(t) });
    }
  }
  return rows;
}

/**
 * Store that answers coverage questions from what it has been given, so the
 * repair and backfill passes are driven by data rather than by a stub.
 */
function trafficStore(seed: {
  storedDays?: { marketplaceId: string; date: Date }[];
  withImpressions?: Date[];
  listingDates?: Date[];
} = {}) {
  const storedDays = seed.storedDays ?? completeDayCoverage();
  const withImpressions = seed.withImpressions ?? [];
  const listingDates = seed.listingDates ?? [];
  const saved = { days: [] as TrafficDayRow[], listings: [] as TrafficListingRow[] };

  const inRange = (d: Date, r: DateRange) =>
    d.getTime() >= r.from.getTime() && d.getTime() <= r.to.getTime();

  const store: TrafficStore = {
    async saveDays(rows) { saved.days.push(...rows); return rows.length; },
    async saveListings(rows) { saved.listings.push(...rows); return rows.length; },
    async marketplacesWithImpressions() { return ['EBAY_MOTORS_US']; },
    async storedDayDates(range) { return storedDays.filter((r) => inRange(r.date, range)); },
    async daysWithImpressions(range) { return withImpressions.filter((d) => inRange(d, range)); },
    async storedListingDates(range) { return listingDates.filter((d) => inRange(d, range)); },
  };

  return { store, saved };
}

const dayRow = (date: string, marketplaceId: string): TrafficDayRow => ({
  date: new Date(date), marketplaceId,
  impressionsSearch: 10, impressionsStore: 0, impressionsTotal: 10,
  viewsSearch: 1, viewsStore: 0, viewsDirect: 0, viewsOtherEbay: 0, viewsOffEbay: 0,
  viewsTotal: 1, transactions: 0, reportUpdatedAt: null,
});

const listingRow = (date: Date, truncated = false): TrafficListingRow => ({
  date, marketplaceId: 'EBAY_MOTORS_US', listingId: '100000000010', title: null,
  impressionsSearch: 5, impressionsStore: 0, impressionsTotal: 5,
  viewsSearch: 1, viewsStore: 0, viewsTotal: 1, transactions: 0, truncated,
});

/**
 * Plain functions, not mocks. `vi.fn(someMock)` hands back the *same* mock
 * rather than a fresh one, so wrapping a shared mock made every test in this
 * file accumulate the others' call counts.
 */
const okDay = async ({ marketplaceId }: { marketplaceId: string; from: Date; to: Date }) => [
  dayRow('2026-09-04T00:00:00.000Z', marketplaceId),
];
const okListing = ({ date }: { date: Date }) => Promise.resolve([listingRow(date)]);

const config = { marketplaceId: 'EBAY_US' } as never;

/** Everything the run needs, with the parts a test does not care about stubbed. */
const base = (overrides: Record<string, unknown> = {}) => ({
  lockStore: freeLock(),
  trigger: 'cron',
  resolve: () => ({ config, accounts: {} as never }),
  now: () => new Date('2026-09-04T12:00:00.000Z'),
  chunks: chunkStore().store,
  traffic: trafficStore().store,
  days: 1,
  fetchDay: vi.fn(okDay),
  fetchListing: vi.fn(okListing),
  ...overrides,
});

describe('runTrafficSync — refresh pass', () => {
  it('asks each marketplace separately, because a combined filter silently sums them', async () => {
    const { rec } = recorder();
    const fetchDay = vi.fn(okDay);

    await runTrafficSync(base({ recorder: rec, fetchDay }) as never);

    expect(fetchDay.mock.calls.map((c) => c[0].marketplaceId)).toEqual(['EBAY_US', 'EBAY_MOTORS_US']);
  });

  it('fetches per-listing detail one day at a time, newest first', async () => {
    const { rec } = recorder();
    const fetchListing = vi.fn(okListing);

    await runTrafficSync(base({ recorder: rec, days: 3, fetchListing }) as never);

    expect(fetchListing.mock.calls.map((c) => c[0].date.toISOString().slice(0, 10))).toEqual([
      '2026-09-04', '2026-09-03', '2026-09-02',
    ]);
  });

  /**
   * The settling window is the reason this matters: a stable key would leave
   * the last few days marked done and never refresh them, which is exactly the
   * range eBay is still revising.
   */
  it('gives the moving refresh window a fresh key each day', async () => {
    const { rec } = recorder();
    const chunks = chunkStore();

    await runTrafficSync(base({ recorder: rec, chunks: chunks.store, days: 2 }) as never);
    await runTrafficSync(base({
      recorder: rec, chunks: chunks.store, days: 2,
      now: () => new Date('2026-09-05T12:00:00.000Z'),
    }) as never);

    expect([...chunks.runs.keys()]).toEqual([
      'traffic:refresh:20260903..20260904',
      'traffic:refresh:20260903..20260904:listing',
      'traffic:refresh:20260904..20260905',
      'traffic:refresh:20260904..20260905:listing',
    ]);
  });
});

describe('runTrafficSync — repair pass', () => {
  /**
   * A completed chunk can still have missing days when an API response was
   * incomplete. The repair pass checks actual per-marketplace coverage.
   */
  it('re-requests a window that is missing store-wide days', async () => {
    const { rec } = recorder();
    // Everything present except one day in May, and only for Motors.
    const stored = completeDayCoverage([day('2026-05-20')]);
    const fetchDay = vi.fn(okDay);

    await runTrafficSync(base({
      recorder: rec,
      traffic: trafficStore({ storedDays: stored }).store,
      fetchDay,
    }) as never);

    // One refresh window plus the single 90-day tile holding 2026-05-20, each
    // asked for both marketplaces.
    expect(fetchDay).toHaveBeenCalledTimes(4);
    const repaired = fetchDay.mock.calls
      .map((c) => c[0])
      .filter((q) => q.from.getTime() <= day('2026-05-20').getTime() && q.to.getTime() >= day('2026-05-20').getTime());
    expect(repaired).toHaveLength(2);
  });

  it('asks for nothing when the store-wide history is complete', async () => {
    const { rec } = recorder();
    const fetchDay = vi.fn(okDay);

    const result = await runTrafficSync(base({
      recorder: rec,
      traffic: trafficStore({ storedDays: completeDayCoverage() }).store,
      fetchDay,
    }) as never);

    // The refresh window only: two calls, one per marketplace.
    expect(fetchDay).toHaveBeenCalledTimes(2);
    expect(result.chunks.repair.completed).toBe(0);
  });
});

describe('runTrafficSync — backfill pass', () => {
  it('fetches the per-listing days that had impressions but no rows, newest first', async () => {
    const { rec } = recorder();
    const fetchListing = vi.fn(okListing);

    const result = await runTrafficSync(base({
      recorder: rec,
      traffic: trafficStore({
        withImpressions: [day('2026-06-01'), day('2026-06-03'), day('2026-06-02')],
        listingDates: [day('2026-06-02')],
      }).store,
      fetchListing,
    }) as never);

    const asked = fetchListing.mock.calls.map((c) => c[0].date.toISOString().slice(0, 10));
    // The refresh day first, then the owed days newest-first. 06-02 already has
    // rows and is not re-fetched.
    expect(asked).toEqual(['2026-09-04', '2026-06-03', '2026-06-01']);
    expect(result.owed).toBe(0);
  });

  /**
   * A day the store saw no impressions on produces no per-listing rows however
   * often it is fetched. Treating it as outstanding would retry it every run
   * for as long as the data is kept.
   */
  it('never owes a day that had no impressions', async () => {
    const { rec } = recorder();
    const fetchListing = vi.fn(okListing);

    await runTrafficSync(base({
      recorder: rec,
      traffic: trafficStore({ withImpressions: [], listingDates: [] }).store,
      fetchListing,
    }) as never);

    expect(fetchListing.mock.calls.map((c) => c[0].date.toISOString().slice(0, 10))).toEqual([
      '2026-09-04',
    ]);
  });

  /**
   * eBay allows 100 traffic_report calls a day and a per-listing backfill costs
   * one per day of history. Being refused would be worse than stopping: the
   * client retries, every remaining chunk is marked failed, and three such
   * ticks abandon the rest of the backfill for good.
   */
  it('stops at its request budget and reports what is left', async () => {
    const { rec, finished } = recorder();
    const fetchListing = vi.fn(okListing);
    const owedDays = [day('2026-06-01'), day('2026-06-02'), day('2026-06-03'), day('2026-06-04')];

    const result = await runTrafficSync(base({
      recorder: rec,
      traffic: trafficStore({ withImpressions: owedDays, listingDates: [] }).store,
      // 2 for the refresh window, 1 for its listing day, then 2 owed days.
      maxRequests: 5,
      fetchListing,
    }) as never);

    expect(result.requests).toBe(5);
    expect(result.owed).toBe(2);
    expect(finished[0].status).toBe('ok');
    expect(finished[0].message).toContain('2 day(s) of history left');
  });

  it('does not charge an attempt to a day it never tried', async () => {
    const { rec } = recorder();
    const chunks = chunkStore();
    const owedDays = [day('2026-06-01'), day('2026-06-02'), day('2026-06-03')];

    await runTrafficSync(base({
      recorder: rec,
      chunks: chunks.store,
      traffic: trafficStore({ withImpressions: owedDays, listingDates: [] }).store,
      maxRequests: 4,
      fetchListing: vi.fn(okListing),
    }) as never);

    const backfill = chunks.runs.get('traffic:listing:backfill') ?? [];
    expect(backfill.filter((c) => c.status === 'done')).toHaveLength(1);
    expect(backfill.filter((c) => c.status === 'pending' && c.attempts === 0)).toHaveLength(2);
  });

  it('carries an unfinished backfill across runs without re-fetching what landed', async () => {
    const { rec } = recorder();
    const chunks = chunkStore();
    const owedDays = [day('2026-06-01'), day('2026-06-02')];
    // The store now reports 06-02 as fetched, as it would after the first run.
    const first = trafficStore({ withImpressions: owedDays, listingDates: [] }).store;
    const second = trafficStore({ withImpressions: owedDays, listingDates: [day('2026-06-02')] }).store;
    const fetchListing = vi.fn(okListing);

    await runTrafficSync(base({
      recorder: rec, chunks: chunks.store, traffic: first, maxRequests: 4, fetchListing,
    }) as never);
    await runTrafficSync(base({
      recorder: rec, chunks: chunks.store, traffic: second, maxRequests: 80, fetchListing,
    }) as never);

    const asked = fetchListing.mock.calls.map((c) => c[0].date.toISOString().slice(0, 10));
    expect(asked.filter((d) => d === '2026-06-02')).toHaveLength(1);
    expect(asked).toContain('2026-06-01');
  });
});

describe('runTrafficSync — reporting', () => {
  it('keeps going after a bad day and says so on the successful run', async () => {
    const { rec, finished } = recorder();
    let call = 0;
    const fetchListing = vi.fn(async ({ date }: { date: Date }) => {
      call++;
      if (call === 2) throw new Error('eBay request failed with status 500');
      return [listingRow(date)];
    });

    const result = await runTrafficSync(base({
      recorder: rec, days: 3, fetchListing,
    }) as never);

    expect(result.chunks.refresh).toMatchObject({ failed: 1 });
    expect(finished[0].status).toBe('ok');
    expect(finished[0].message).toContain('1 chunk(s) did not complete');
  });

  it('reports a day eBay truncated at 200 listings', async () => {
    const { rec, finished } = recorder();

    const result = await runTrafficSync(base({
      recorder: rec,
      fetchListing: vi.fn(async ({ date }: { date: Date }) => [listingRow(date, true)]),
    }) as never);

    expect(result.truncatedDays).toBe(1);
    expect(finished[0].message).toContain("1 day(s) hit eBay's 200-listing cap");
  });

  /**
   * A chunked run tolerates a bad tile on purpose. Tolerating *every* tile
   * failing would log a healthy-looking run that fetched nothing, and the
   * freshness banner would call the data current.
   */
  it('fails the run when no chunk completed at all', async () => {
    const { rec, finished } = recorder();

    await expect(runTrafficSync(base({
      recorder: rec,
      fetchDay: vi.fn(async () => { throw new Error('eBay request failed with status 500'); }),
      fetchListing: vi.fn(async () => { throw new Error('eBay request failed with status 500'); }),
    }) as never)).rejects.toBeInstanceOf(TrafficSyncError);

    expect(finished[0].status).toBe('failed');
  });

  it('clamps a window older than eBay serves and keeps the excluded part visible', async () => {
    const { rec, finished } = recorder();

    const result = await runTrafficSync(base({
      recorder: rec, days: 900, maxRequests: 2,
    }) as never);

    // eBay's own floor on this date is 20240904; 730 days lands a day inside
    // it, which is deliberate -- the boundary moves daily and overshooting it
    // is a hard 400 for the whole chunk.
    expect(result.from.toISOString()).toBe('2024-09-05T00:00:00.000Z');
    expect(result.to.toISOString()).toBe('2026-09-04T00:00:00.000Z');
    expect(finished[0].message).toContain('is older than eBay serves');
  });
});
