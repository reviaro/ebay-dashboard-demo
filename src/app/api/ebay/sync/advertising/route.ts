import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getEbayConfig, getEbayStores } from '@/lib/ebay/server';
import { errorResponse, guardOrigin } from '@/lib/ebay/route-helpers';
import { createPrismaAdCampaignStore } from '@/lib/ebay/sync/prisma-ad-campaign-writer';
import { runAdsSync } from '@/lib/ebay/sync/run-ads';
import { createPrismaSyncLog } from '@/lib/ebay/sync/prisma-sync-log';
import { createPrismaSyncLockStore } from '@/lib/ebay/prisma-sync-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manual advertising sync. No `days` to accept: campaigns are fetched as a
 * full snapshot, same as inventory.
 */
async function handlePOST(request: Request) {

  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  try {
    const result = await runAdsSync({
      lockStore: createPrismaSyncLockStore(prisma),
      recorder: createPrismaSyncLog(prisma),
      adCampaigns: createPrismaAdCampaignStore(prisma),
      trigger: 'manual',
      resolve: () => ({ config: getEbayConfig(), accounts: getEbayStores().accounts }),
    });

    return NextResponse.json({
      ok: true,
      campaigns: result.campaigns,
      running: result.running,
      ended: result.ended,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = withStore('admin', handlePOST);
