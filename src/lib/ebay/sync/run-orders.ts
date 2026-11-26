/**
 * One orders sync, however it was triggered.
 *
 * The HTTP route and the scheduled worker both go through here so they cannot
 * drift: the lease, the run record, and the order in which they nest are
 * properties of *a sync*, not of the button that started one.
 *
 * The nesting matters. Lock outside, log inside:
 *
 *   - a run refused because another holds the lease is not a run, and must not
 *     write a `failed` row -- otherwise the freshness banner reports "last
 *     sync failed" whenever two triggers overlap;
 *   - configuration is resolved *inside* the record, so a sync that dies
 *     before eBay is ever contacted still leaves a `failed` row. That is the
 *     failure most worth being able to look up later.
 */

import type { AccountStore } from '../stores';
import type { EbayConfig } from '../config';
import { createEbayClient } from '../client';
import { createTokenProvider } from '../access-token';
import { exchangeWithEbay } from '../token-exchange';
import { makeOwnerId, withSyncLock, type SyncLockStore } from '../sync-lock';
import { recordSyncRun, type SyncRunRecorder } from './run-log';
import { syncOrders, type OrderWriter, type SyncOrdersOptions, type SyncOrdersResult } from './orders';

export const ORDERS_LOCK = 'orders';

export interface RunOrdersSyncOptions {
  lockStore: SyncLockStore;
  recorder: SyncRunRecorder;
  /** How this run was started: `manual`, `cron`. Recorded in the lease owner. */
  trigger: string;
  days: number;
  /** Deferred so a configuration failure is caught inside the run record. */
  resolve: () => { config: EbayConfig; accounts: AccountStore };
  writer: OrderWriter;
  /** Injected for tests; production passes the real sync. */
  sync?: (options: SyncOrdersOptions) => Promise<SyncOrdersResult>;
  now?: () => Date;
}

export async function runOrdersSync(options: RunOrdersSyncOptions): Promise<SyncOrdersResult> {
  const {
    lockStore, recorder, trigger, days, resolve,
    writer, sync = syncOrders, now = () => new Date(),
  } = options;

  return withSyncLock({
    store: lockStore,
    name: ORDERS_LOCK,
    owner: makeOwnerId(trigger),
    run: () =>
      recordSyncRun({
        recorder,
        type: 'orders',
        count: (result) => result.stored,
        run: async () => {
          const { config, accounts } = resolve();

          const tokens = createTokenProvider({ config, accounts, exchange: exchangeWithEbay });
          const client = createEbayClient({
            config,
            getAccessToken: () => tokens.getAccessToken(),
          });

          const at = now();
          // Inclusive of today, so `days: 1` means today only.
          const from = new Date(at.getTime() - (days - 1) * 86_400_000);

          return sync({
            client,
            writer,
            range: { from, to: at },
            now: at,
          });
        },
      }),
  });
}
