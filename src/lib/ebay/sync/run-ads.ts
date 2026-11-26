/**
 * One advertising sync, however it was triggered.
 *
 * The same shape as `runInventorySync`: lease outside, run record inside, and
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
import { fetchAdCampaigns, type MappedAdCampaign } from './ad-campaign';
import type { AdCampaignStore } from './prisma-ad-campaign-writer';

export const ADS_LOCK = 'advertising';

export interface RunAdsSyncResult {
  campaigns: number;
  running: number;
  ended: number;
}

export async function runAdsSync(opts: {
  lockStore: SyncLockStore;
  recorder: SyncRunRecorder;
  adCampaigns: AdCampaignStore;
  trigger: string;
  resolve: () => { config: EbayConfig; accounts: AccountStore };
  fetchCampaigns?: typeof fetchAdCampaigns;
  now?: () => Date;
}): Promise<RunAdsSyncResult> {
  const {
    lockStore,
    recorder,
    adCampaigns,
    trigger,
    resolve,
    fetchCampaigns: fetch = fetchAdCampaigns,
    now = () => new Date(),
  } = opts;

  return withSyncLock({
    store: lockStore,
    name: ADS_LOCK,
    owner: makeOwnerId(trigger),
    run: () =>
      recordSyncRun({
        recorder,
        type: 'advertising',
        count: (r) => r.campaigns,
        run: async () => {
          const { config, accounts } = resolve();
          const tokens = createTokenProvider({ config, accounts, exchange: exchangeWithEbay });
          const client = createEbayClient({
            config,
            getAccessToken: () => tokens.getAccessToken(),
          });

          const rows = await fetch({ client });
          const seenAt = now();
          await adCampaigns.saveCampaigns(rows, seenAt);

          return {
            campaigns: rows.length,
            running: rows.filter((r: MappedAdCampaign) => r.campaignStatus === 'RUNNING').length,
            ended: rows.filter((r: MappedAdCampaign) => r.campaignStatus === 'ENDED').length,
          };
        },
      }),
  });
}
