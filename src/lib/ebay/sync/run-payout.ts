/**
 * Daily payout sync. Independent of the transaction sync, since a payout groups many
 * transactions and posts on its own schedule.
 *
 * `payoutId` on each transaction is written by `run-finance.ts` straight from
 * the mapped transaction row (the mapper reads it from `references[]` as
 * `PAYOUT_ID`) -- this module only persists the
 * payout records themselves. It is a single window, not a checkpointed
 * backfill: `EbayPayout` is supplementary/reconciliation data.
 *
 * **Backfill depth.** The `payout` list endpoint accepts a date range of at
 * most **36 months** in one request (a wider range is rejected -- errorId
 * 135019; older than five years is 135013). This runner issues a single
 * window, so `--days 1095` is the deepest one-pass backfill. A shorter pull can
 * leave older payouts unsynced and create count differences against a wider
 * `payout_summary` window. Use `--days 1095` for a full
 * backfill; the daily cron only needs its 14-day settling window.
 *
 * The finance API lives on `config.financeApiBaseUrl` (`apiz.ebay.com`).
 */

import type { AccountStore } from '../stores';
import type { EbayConfig } from '../config';
import { createEbayClient } from '../client';
import { createTokenProvider } from '../access-token';
import { exchangeWithEbay } from '../token-exchange';
import { makeOwnerId, withSyncLock, type SyncLockStore } from '../sync-lock';
import { recordSyncRun, type SyncRunRecorder } from './run-log';
import { addDays, utcDay } from '../ranges';
import { fetchPayoutWindow } from './finance';
import type { FinanceStore } from './prisma-finance-writer';

export const PAYOUT_LOCK = 'payouts';

export interface RunPayoutSyncResult {
  from: Date;
  to: Date;
  payoutRows: number;
}

export async function runPayoutSync(options: {
  lockStore: SyncLockStore;
  recorder: SyncRunRecorder;
  finance: FinanceStore;
  trigger: string;
  /** Days back from today, inclusive. */
  days: number;
  resolve: () => { config: EbayConfig; accounts: AccountStore };
  fetchPayouts?: typeof fetchPayoutWindow;
  now?: () => Date;
}): Promise<RunPayoutSyncResult> {
  const {
    lockStore, recorder, finance, trigger, days, resolve,
    fetchPayouts = fetchPayoutWindow, now = () => new Date(),
  } = options;

  return withSyncLock({
    store: lockStore,
    name: PAYOUT_LOCK,
    owner: makeOwnerId(trigger),
    run: () =>
      recordSyncRun({
        recorder,
        type: 'payouts',
        count: (result: RunPayoutSyncResult) => result.payoutRows,
        run: async () => {
          const { config, accounts } = resolve();
          const tokens = createTokenProvider({ config, accounts, exchange: exchangeWithEbay });
          const client = createEbayClient({
            config: { ...config, apiBaseUrl: config.financeApiBaseUrl },
            getAccessToken: () => tokens.getAccessToken(),
          });
          const account = await accounts.find(config.environment);
          if (!account?.id) throw new Error('A connected eBay account ID is required.');
          const accountId = account.id;

          const today = utcDay(now());
          const from = addDays(today, -(days - 1));
          const rows = await fetchPayouts({ client, accountId, from, to: today });
          const payoutRows = await finance.savePayouts(rows);

          return { from, to: today, payoutRows };
        },
      }),
  });
}
