/**
 * One traffic sync, however it was triggered.
 *
 * Same shape as `runOrdersSync` and `runInventorySync` -- lease outside, run
 * record inside -- and three passes within that, sharing one request budget:
 *
 *   1. **Refresh** the recent window. eBay keeps revising the last few days
 *      after publishing them, so this re-fetches them every run. Its run key is
 *      derived from the range, which moves daily, so a checkpoint can never
 *      mark a still-settling day "done" and stop refreshing it.
 *   2. **Repair** store-wide gaps: any day inside eBay's two years with no row,
 *      re-requested in the same 90-day tiles a full fetch would have used. This
 *      is what heals a window that came back empty under a 200 status.
 *   3. **Backfill** the per-listing days still owed, newest first, until the
 *      budget runs out.
 *
 * **eBay allows 100 `traffic_report` calls per day** (checked through
 * `/developer/analytics/v1_beta/rate_limit/`), and there is no listing-by-day
 * request, so two years of per-listing history costs ~730 calls. A backfill
 * therefore spans days by nature: each run does what it can afford and the next
 * continues. Stopping at a budget rather than letting eBay refuse matters --
 * being refused would have the client retry, mark chunk after chunk failed, and
 * after three ticks abandon the rest of the backfill permanently.
 *
 * Passes 2 and 3 work out what is outstanding from the stored rows rather than
 * from a cursor or a fixed window -- see `lib/traffic/coverage.ts`. That fills
 * holes in the middle, needs nobody to choose a backfill range in advance, and
 * cannot drift away from what is actually in the database.
 */

import type { AccountStore } from '../stores';
import type { EbayConfig } from '../config';
import { createEbayClient } from '../client';
import { createTokenProvider } from '../access-token';
import { exchangeWithEbay } from '../token-exchange';
import { makeOwnerId, withSyncLock, type SyncLockStore } from '../sync-lock';
import { recordSyncRun, type SyncRunRecorder } from './run-log';
import { runChunked, type ChunkedResult, type ChunkStore } from './checkpoints';
import { addDays, chunkRange, clampToRetention, DOMAIN_WINDOWS, utcDay, type DateRange } from '../ranges';
import { dayLabel, fetchDayTraffic, fetchListingTraffic, trafficMarketplaces } from './traffic';
import type { TrafficStore } from './prisma-traffic-writer';
import type { TrafficDayRow, TrafficListingRow } from '../mappers/traffic-report';
import { listingDaysOwed, missingDays, windowsCovering } from '../../traffic/coverage';

export const TRAFFIC_LOCK = 'traffic';

/**
 * Stable keys, unlike the refresh pass.
 *
 * These two are tiled from what is missing rather than from a window, so a day
 * only appears once it is outstanding and stops appearing once it has rows. A
 * fixed key cannot suppress work here the way it would for a moving window, and
 * it is what gives a permanently broken day an attempt count that eventually
 * stops it being retried forever.
 */
const REPAIR_KEY = 'traffic:day:repair';
const BACKFILL_KEY = 'traffic:listing:backfill';

/**
 * Requests one run may spend when nobody says otherwise. The scheduler passes
 * eBay's real remaining allowance instead; this is the fallback for when that
 * cannot be read.
 */
export const DEFAULT_MAX_REQUESTS = 60;

export class TrafficSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrafficSyncError';
  }
}

export interface RunTrafficSyncResult {
  from: Date;
  to: Date;
  /** The part of the requested window older than eBay's two years, if any. */
  excluded: DateRange | null;
  dayRows: number;
  listingRows: number;
  /** Days whose per-listing report came back at eBay's 200-row cap. */
  truncatedDays: number;
  /** Calls actually spent against eBay's daily traffic_report allowance. */
  requests: number;
  /** Per-listing days still outstanding when this run stopped. */
  owed: number;
  chunks: { refresh: ChunkedResult; repair: ChunkedResult; backfill: ChunkedResult };
}

const unfinished = (result: ChunkedResult) => result.failed + result.exhausted;

const NOTHING: ChunkedResult = { completed: 0, failed: 0, skipped: 0, exhausted: 0, remaining: 0 };

const merge = (a: ChunkedResult, b: ChunkedResult): ChunkedResult => ({
  completed: a.completed + b.completed,
  failed: a.failed + b.failed,
  skipped: a.skipped + b.skipped,
  exhausted: a.exhausted + b.exhausted,
  remaining: a.remaining + b.remaining,
});

/**
 * What a *successful* run should still admit to.
 *
 * Each of these is a case where the data is real but incomplete, and each would
 * otherwise be invisible: a window clamped to eBay's retention, a chunk that
 * failed while its neighbours committed, a day where eBay stopped at 200
 * listings, and history still to fetch.
 */
export function describeTrafficRun(result: RunTrafficSyncResult): string | null {
  const notes: string[] = [];

  if (result.excluded) {
    notes.push(
      `${dayLabel(result.excluded.from)}..${dayLabel(result.excluded.to)} is older than eBay serves`
    );
  }

  const stalled =
    unfinished(result.chunks.refresh) +
    unfinished(result.chunks.repair) +
    unfinished(result.chunks.backfill);
  if (stalled > 0) notes.push(`${stalled} chunk(s) did not complete`);

  if (result.truncatedDays > 0) {
    notes.push(`${result.truncatedDays} day(s) hit eBay's 200-listing cap`);
  }

  if (result.owed > 0) {
    notes.push(`${result.owed} day(s) of history left, continuing next run`);
  }

  return notes.length > 0 ? notes.join('; ') : null;
}

export async function runTrafficSync(options: {
  lockStore: SyncLockStore;
  recorder: SyncRunRecorder;
  chunks: ChunkStore;
  traffic: TrafficStore;
  trigger: string;
  /** Days back from today, inclusive, for the settling-window refresh. */
  days: number;
  /** Cap on eBay calls for this run; the scheduler passes the real allowance. */
  maxRequests?: number;
  resolve: () => { config: EbayConfig; accounts: AccountStore };
  /** Injected for tests; production passes the real fetchers. */
  fetchDay?: typeof fetchDayTraffic;
  fetchListing?: typeof fetchListingTraffic;
  now?: () => Date;
}): Promise<RunTrafficSyncResult> {
  const {
    lockStore, recorder, chunks, traffic, trigger, days, resolve,
    maxRequests = DEFAULT_MAX_REQUESTS,
    fetchDay = fetchDayTraffic, fetchListing = fetchListingTraffic, now = () => new Date(),
  } = options;

  return withSyncLock({
    store: lockStore,
    name: TRAFFIC_LOCK,
    owner: makeOwnerId(trigger),
    run: () =>
      recordSyncRun({
        recorder,
        type: 'traffic',
        count: (result) => result.dayRows + result.listingRows,
        message: describeTrafficRun,
        run: async () => {
          const { config, accounts } = resolve();
          const tokens = createTokenProvider({ config, accounts, exchange: exchangeWithEbay });
          const client = createEbayClient({
            config,
            getAccessToken: () => tokens.getAccessToken(),
          });

          const at = now();
          const today = utcDay(at);
          const window = DOMAIN_WINDOWS.traffic;
          const marketplaces = trafficMarketplaces(config.marketplaceId);

          // Everything eBay will still serve: the ceiling for repair and backfill.
          const retention: DateRange = {
            from: addDays(today, -(window.maxAgeDays - 1)),
            to: today,
          };

          const { effective, excluded } = clampToRetention(
            { from: addDays(today, -(days - 1)), to: today },
            { maxAgeDays: window.maxAgeDays, now: today }
          );

          if (!effective) {
            throw new TrafficSyncError(
              `The whole ${days}-day window is older than the ${window.maxAgeDays} days eBay serves.`
            );
          }

          let dayRows = 0;
          let listingRows = 0;
          let truncatedDays = 0;
          let requests = 0;

          // Checked before a chunk rather than during one, so a half-fetched
          // day is never left looking complete.
          const affordable = (cost: number) => () => requests + cost <= maxRequests;

          const fetchDayWindow = async (chunk: { rangeStart: Date; rangeEnd: Date }) => {
            for (const marketplaceId of marketplaces) {
              requests++;
              const rows: TrafficDayRow[] = await fetchDay({
                client,
                marketplaceId,
                from: chunk.rangeStart,
                to: chunk.rangeEnd,
              });
              dayRows += await traffic.saveDays(rows, at);
            }
          };

          const fetchListingDay = async (chunk: { rangeStart: Date }) => {
            const active = await traffic.marketplacesWithImpressions(chunk.rangeStart);
            let truncated = false;

            for (const marketplaceId of active) {
              requests++;
              const rows: TrafficListingRow[] = await fetchListing({
                client,
                marketplaceId,
                date: chunk.rangeStart,
              });
              truncated ||= rows.some((row) => row.truncated);
              listingRows += await traffic.saveListings(rows, at);
            }

            if (truncated) truncatedDays++;
          };

          // ---- 1. Refresh the settling window ------------------------------
          // Newest first, so an interrupted run has today before last week.
          const refreshKey = `traffic:refresh:${dayLabel(effective.from)}..${dayLabel(effective.to)}`;

          const refreshDays = await runChunked({
            store: chunks,
            runKey: refreshKey,
            domain: TRAFFIC_LOCK,
            ranges: chunkRange(effective, window.maxChunkDays, 'newest-first'),
            canContinue: affordable(marketplaces.length),
            work: fetchDayWindow,
          });

          const refreshListings = await runChunked({
            store: chunks,
            runKey: `${refreshKey}:listing`,
            domain: TRAFFIC_LOCK,
            ranges: chunkRange(effective, 1, 'newest-first'),
            canContinue: affordable(1),
            work: fetchListingDay,
          });

          // ---- 2. Repair store-wide gaps -----------------------------------
          const stored = await traffic.storedDayDates(retention);
          const gaps = marketplaces.flatMap((marketplaceId) =>
            missingDays(
              retention,
              stored.filter((row) => row.marketplaceId === marketplaceId).map((row) => row.date)
            )
          );

          const repair =
            gaps.length === 0
              ? NOTHING
              : await runChunked({
                  store: chunks,
                  runKey: REPAIR_KEY,
                  domain: TRAFFIC_LOCK,
                  ranges: windowsCovering(retention, gaps, window.maxChunkDays),
                  canContinue: affordable(marketplaces.length),
                  work: fetchDayWindow,
                });

          // ---- 3. Backfill the per-listing days owed ------------------------
          // Read after the repair, so days it has just recovered are included.
          const [withImpressions, fetched] = await Promise.all([
            traffic.daysWithImpressions(retention),
            traffic.storedListingDates(retention),
          ]);
          const owed = listingDaysOwed(withImpressions, fetched);

          const backfill =
            owed.length === 0
              ? NOTHING
              : await runChunked({
                  store: chunks,
                  runKey: BACKFILL_KEY,
                  domain: TRAFFIC_LOCK,
                  ranges: owed.map((date) => ({ from: date, to: date })),
                  canContinue: affordable(1),
                  work: fetchListingDay,
                });

          const refresh = merge(refreshDays, refreshListings);

          const result: RunTrafficSyncResult = {
            from: effective.from,
            to: effective.to,
            excluded,
            dayRows,
            listingRows,
            truncatedDays,
            requests,
            // What is left after this run: days it could not afford, plus any
            // it tried and failed.
            owed: backfill.remaining + backfill.failed,
            chunks: { refresh, repair, backfill },
          };

          // A chunked run tolerates a bad tile so one failure does not cost the
          // tiles after it. Nothing committed at all is a different thing: that
          // is a broken sync, and logging it as `ok` with zero rows would make
          // the freshness banner report healthy data that was never fetched.
          const completed = refresh.completed + repair.completed + backfill.completed;
          const broken = unfinished(refresh) + unfinished(repair) + unfinished(backfill);

          if (completed === 0 && broken > 0) {
            throw new TrafficSyncError(
              `No traffic chunk completed: ${describeTrafficRun(result) ?? 'every chunk failed'}.`
            );
          }

          return result;
        },
      }),
  });
}
