/**
 * One finance sync, however it was triggered.
 *
 * Same lease -> run-record shape as `runOrdersSync` / `runTrafficSync`. Two
 * passes:
 *
 *   1. **Refresh** the last `days`. Financial postings lag order creation, so
 *      this re-fetches the settling window every run. Not chunked -- 14 days is
 *      one request window -- so a failure here fails the run outright.
 *   2. **Backfill** older history, up to `DOMAIN_WINDOWS.finances.maxAgeDays`
 *      (730), tiled on a **fixed calendar-month grid** and checkpointed in
 *      `EbaySyncChunk` under a stable key. The grid is the point: a given month
 *      is always the same `(rangeStart, rangeEnd)` no matter what day the run
 *      falls on, so `EbaySyncChunk` rows are reused run to run rather than a new
 *      set being minted every day (which is what a `today`-anchored
 *      `chunkRange` window would do under a stable key). This chunk status *is*
 *      the coverage record -- there is no separate derived-from-rows module,
 *      because unlike traffic's DAY dimension a finance month can legitimately
 *      hold zero transactions, so row presence cannot tell "fetched, empty"
 *      from "not fetched".
 *
 * The finance API lives on `config.financeApiBaseUrl` (`apiz.ebay.com`); the
 * client built here is pointed at it.
 */

import type { AccountStore } from '../stores';
import type { EbayConfig } from '../config';
import { createEbayClient } from '../client';
import { createTokenProvider } from '../access-token';
import { exchangeWithEbay } from '../token-exchange';
import { makeOwnerId, withSyncLock, type SyncLockStore } from '../sync-lock';
import { recordSyncRun, type SyncRunRecorder } from './run-log';
import { runChunked, type ChunkedResult, type ChunkStore } from './checkpoints';
import { addDays, DOMAIN_WINDOWS, utcDay, type DateRange } from '../ranges';
import { fetchTransactionWindow } from './finance';
import type { FinanceStore } from './prisma-finance-writer';

export const FINANCE_LOCK = 'finances';
const BACKFILL_KEY = 'finance:backfill';

const NOTHING: ChunkedResult = { completed: 0, failed: 0, skipped: 0, exhausted: 0, remaining: 0 };

export class FinanceSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceSyncError';
  }
}

export interface RunFinanceSyncResult {
  /** Start of the settling-window refresh. */
  from: Date;
  to: Date;
  transactionRows: number;
  backfill: ChunkedResult;
  /** Backfill months not accounted for this run: failed, exhausted, or unreached. */
  owed: number;
}

/** What a successful run should still admit to. */
export function describeFinanceRun(result: RunFinanceSyncResult): string | null {
  const notes: string[] = [];
  const stalled = result.backfill.failed + result.backfill.exhausted;
  if (stalled > 0) notes.push(`${stalled} backfill month(s) did not complete`);
  if (result.backfill.remaining > 0) {
    notes.push(`${result.backfill.remaining} backfill month(s) left, continuing next run`);
  }
  return notes.length > 0 ? notes.join('; ') : null;
}

/**
 * Full calendar-month tiles covering every month `[from, to]` touches.
 *
 * Boundaries are the 1st and last day of a month at UTC midnight, so they never
 * move with `today`. The oldest month over-reaches into pre-retention days and
 * the newest into the refresh window by a little; eBay simply returns what it
 * has for the out-of-range days, and the refresh pass re-writes the overlap
 * (upserts, no duplication).
 */
export function calendarMonthTiles(from: Date, to: Date): DateRange[] {
  const tiles: DateRange[] = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  const endKey = to.getUTCFullYear() * 12 + to.getUTCMonth();

  while (year * 12 + month <= endKey) {
    tiles.push({
      from: new Date(Date.UTC(year, month, 1)),
      to: new Date(Date.UTC(year, month + 1, 0)),
    });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return tiles;
}

export async function runFinanceSync(options: {
  lockStore: SyncLockStore;
  recorder: SyncRunRecorder;
  chunks: ChunkStore;
  finance: FinanceStore;
  trigger: string;
  /** Days back from today, inclusive, for the settling-window refresh. */
  days: number;
  resolve: () => { config: EbayConfig; accounts: AccountStore };
  /** Injected for tests; production passes the real fetcher. */
  fetchTransactions?: typeof fetchTransactionWindow;
  now?: () => Date;
}): Promise<RunFinanceSyncResult> {
  const {
    lockStore, recorder, chunks, finance, trigger, days, resolve,
    fetchTransactions = fetchTransactionWindow,
    now = () => new Date(),
  } = options;

  return withSyncLock({
    store: lockStore,
    name: FINANCE_LOCK,
    owner: makeOwnerId(trigger),
    run: () =>
      recordSyncRun({
        recorder,
        type: 'finances',
        count: (result: RunFinanceSyncResult) => result.transactionRows,
        message: describeFinanceRun,
        run: async () => {
          const { config, accounts } = resolve();
          const tokens = createTokenProvider({ config, accounts, exchange: exchangeWithEbay });
          const client = createEbayClient({
            config: { ...config, apiBaseUrl: config.financeApiBaseUrl },
            getAccessToken: () => tokens.getAccessToken(),
          });
          // One connected account per config today; the row key just needs to
          // be stable. Revisit if multi-account sync ships.
          const account = await accounts.find(config.environment);
          if (!account?.id) throw new Error('A connected eBay account ID is required.');
          const accountId = account.id;
          const today = utcDay(now());
          const window = DOMAIN_WINDOWS.finances;

          let transactionRows = 0;

          // ---- 1. Refresh the settling window -----------------------------
          const refreshFrom = addDays(today, -(days - 1));
          const refreshed = await fetchTransactions({
            client, accountId, marketplaceId: config.marketplaceId, from: refreshFrom, to: today,
          });
          transactionRows += await finance.saveTransactions(refreshed);

          // ---- 2. Backfill older history on a fixed month grid -----------
          const retentionStart = addDays(today, -(window.maxAgeDays - 1));
          const backfillTo = addDays(refreshFrom, -1);
          const tiles =
            retentionStart.getTime() > backfillTo.getTime()
              ? []
              : calendarMonthTiles(retentionStart, backfillTo);

          const backfill =
            tiles.length === 0
              ? NOTHING
              : await runChunked({
                  store: chunks,
                  runKey: BACKFILL_KEY,
                  domain: FINANCE_LOCK,
                  ranges: tiles,
                  work: async (chunk) => {
                    const rows = await fetchTransactions({
                      client, accountId, marketplaceId: config.marketplaceId,
                      from: chunk.rangeStart, to: chunk.rangeEnd,
                    });
                    transactionRows += await finance.saveTransactions(rows);
                  },
                });

          const result: RunFinanceSyncResult = {
            from: refreshFrom,
            to: today,
            transactionRows,
            backfill,
            owed: backfill.failed + backfill.exhausted + backfill.remaining,
          };

          // A chunked run tolerates a bad tile. Nothing committed at all while
          // tiles failed is a different thing: logging it `ok` with zero rows
          // would tell the freshness banner the backfill is healthy when no
          // month of it was fetched.
          if (backfill.completed === 0 && backfill.failed + backfill.exhausted > 0) {
            throw new FinanceSyncError(
              `No finance backfill month completed: ${describeFinanceRun(result) ?? 'every month failed'}.`
            );
          }

          return result;
        },
      }),
  });
}
