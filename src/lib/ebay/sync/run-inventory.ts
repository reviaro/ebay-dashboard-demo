/**
 * One inventory sync, however it was triggered.
 *
 * The same shape as `runOrdersSync`: lease outside, run record inside, and
 * configuration resolved within the record so a failure before eBay is
 * contacted is still logged. Sharing that shape is deliberate -- the ordering
 * is a property of a sync, not of the domain being synced.
 */

import type { AccountStore } from '../stores';
import type { EbayConfig } from '../config';
import { createEbayClient } from '../client';
import { createTokenProvider } from '../access-token';
import { exchangeWithEbay } from '../token-exchange';
import { makeOwnerId, withSyncLock, type SyncLockStore } from '../sync-lock';
import { recordSyncRun, type SyncRunRecorder } from './run-log';
import { reconcileOffers } from './reconcile-offers';
import { syncInventory } from './inventory';
import type { OfferStore } from './prisma-offer-writer';

export const INVENTORY_LOCK = 'inventory';

export interface RunInventorySyncResult {
  taskId: string;
  active: number;
  sold: number;
  ended: number;
  total: number;
}

export async function runInventorySync(options: {
  lockStore: SyncLockStore;
  recorder: SyncRunRecorder;
  offers: OfferStore;
  trigger: string;
  resolve: () => { config: EbayConfig; accounts: AccountStore };
  now?: () => Date;
}): Promise<RunInventorySyncResult> {
  const { lockStore, recorder, offers, trigger, resolve, now = () => new Date() } = options;

  return withSyncLock({
    store: lockStore,
    name: INVENTORY_LOCK,
    owner: makeOwnerId(trigger),
    run: () =>
      recordSyncRun({
        recorder,
        type: 'inventory',
        count: (result) => result.active,
        run: async () => {
          const { config, accounts } = resolve();
          const tokens = createTokenProvider({ config, accounts, exchange: exchangeWithEbay });
          const client = createEbayClient({
            config,
            getAccessToken: () => tokens.getAccessToken(),
          });

          const at = now();
          const { listings, taskId } = await syncInventory({ client });

          const [known, soldListingIds] = await Promise.all([
            offers.known(),
            offers.soldListingIds(),
          ]);

          const reconciled = reconcileOffers({ report: listings, known, soldListingIds, now: at });
          await offers.save(reconciled, at);

          const count = (status: string) => reconciled.filter((o) => o.status === status).length;
          return {
            taskId,
            active: count('active'),
            sold: count('sold'),
            ended: count('ended'),
            total: reconciled.length,
          };
        },
      }),
  });
}
