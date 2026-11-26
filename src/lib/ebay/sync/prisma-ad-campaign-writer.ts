import { withStoreData } from '@/lib/stores/context';
/**
 * Persists Promoted Listings campaigns.
 *
 * Batched into `$transaction`s for the same reason as `prisma-finance-writer.ts`:
 * SQLite syncs to disk per statement, so upserting one row at a time
 * measures in single-digit rows/second. One transaction per batch is one sync.
 *
 * Campaigns are keyed on eBay's `campaignId`.
 */

import type { PrismaClient } from '@prisma/client';
import type { MappedAdCampaign } from './ad-campaign';

export interface AdCampaignStore {
  saveCampaigns(rows: MappedAdCampaign[], seenAt: Date): Promise<number>;
  fundingModelByCampaign(): Promise<Map<string, string>>;
}

/** Bounded so one transaction cannot hold the single SQLite writer too long. */
const BATCH_SIZE = 250;

function batches<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) out.push(rows.slice(i, i + BATCH_SIZE));
  return out;
}

export function createPrismaAdCampaignStore(prisma: PrismaClient): AdCampaignStore {
  return {
    async saveCampaigns(rows: MappedAdCampaign[], seenAt: Date): Promise<number> {
      for (const batch of batches(rows)) {
        await prisma.$transaction(
          batch.map((row) => {
            const { campaignId, ...rest } = row;
            return prisma.ebayAdCampaign.upsert({
              where: { storeId_campaignId: withStoreData({ campaignId: campaignId }) },
              create: withStoreData({ campaignId, ...rest, lastSeenAt: seenAt }),
              update: { ...rest, lastSeenAt: seenAt },
            });
          })
        );
      }
      return rows.length;
    },

    async fundingModelByCampaign(): Promise<Map<string, string>> {
      const rows = await prisma.ebayAdCampaign.findMany({
        select: { campaignId: true, fundingModel: true },
      });
      const map = new Map<string, string>();
      for (const row of rows) {
        map.set(row.campaignId, row.fundingModel);
      }
      return map;
    },
  };
}
