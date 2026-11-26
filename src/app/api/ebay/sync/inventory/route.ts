import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getEbayConfig, getEbayStores } from '@/lib/ebay/server';
import { errorResponse, guardOrigin } from '@/lib/ebay/route-helpers';
import { createPrismaOfferStore } from '@/lib/ebay/sync/prisma-offer-writer';
import { runInventorySync } from '@/lib/ebay/sync/run-inventory';
import { createPrismaSyncLog } from '@/lib/ebay/sync/prisma-sync-log';
import { createPrismaSyncLockStore } from '@/lib/ebay/prisma-sync-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manual inventory sync.
 *
 * The Active Inventory Report is a full snapshot, not a date-windowed fetch,
 * so unlike orders there is no `days` to accept -- see `run-inventory.ts`.
 */
async function handlePOST(request: Request) {

  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  try {
    // Lease, run record and nesting all live in runInventorySync, shared with
    // the scheduled worker so the two triggers cannot drift apart.
    const result = await runInventorySync({
      lockStore: createPrismaSyncLockStore(prisma),
      recorder: createPrismaSyncLog(prisma),
      offers: createPrismaOfferStore(prisma),
      trigger: 'manual',
      resolve: () => ({ config: getEbayConfig(), accounts: getEbayStores().accounts }),
    });

    return NextResponse.json({
      ok: true,
      active: result.active,
      sold: result.sold,
      ended: result.ended,
      total: result.total,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = withStore('admin', handlePOST);
