import { withStore } from '@/lib/stores/route';
import { withStoreData } from '@/lib/stores/context';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getEbayConfig, getEbayStores } from '@/lib/ebay/server';
import { errorResponse, guardOrigin } from '@/lib/ebay/route-helpers';
import { createPrismaChunkStore } from '@/lib/ebay/sync/prisma-chunk-store';
import { createPrismaFinanceStore } from '@/lib/ebay/sync/prisma-finance-writer';
import { runFinanceSync } from '@/lib/ebay/sync/run-finance';
import { createPrismaSyncLog } from '@/lib/ebay/sync/prisma-sync-log';
import { createPrismaSyncLockStore } from '@/lib/ebay/prisma-sync-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Used only if no `EbaySyncSetting` row exists yet for finances. */
const DEFAULT_DAYS = 14;

/**
 * Manual finance sync.
 *
 * Unlike orders, `days` here only sizes the settling-refresh window -- the
 * calendar-month backfill in `runFinanceSync` runs every time regardless of
 * this value -- so there is no picker in the UI for it. It uses the domain's
 * already-configured lookback, the same number the scheduled worker uses.
 */
async function handlePOST(request: Request) {

  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  try {
    const setting = await prisma.ebaySyncSetting.findUnique({ where: { storeId_domain: withStoreData({ domain: 'finances' }) } });
    const days = setting?.lookbackDays ?? DEFAULT_DAYS;

    const result = await runFinanceSync({
      lockStore: createPrismaSyncLockStore(prisma),
      recorder: createPrismaSyncLog(prisma),
      chunks: createPrismaChunkStore(prisma),
      finance: createPrismaFinanceStore(prisma),
      trigger: 'manual',
      days,
      resolve: () => ({ config: getEbayConfig(), accounts: getEbayStores().accounts }),
    });

    return NextResponse.json({
      ok: true,
      requestedDays: days,
      transactionRows: result.transactionRows,
      backfillCompleted: result.backfill.completed,
      backfillOwed: result.owed,
      from: result.from.toISOString(),
      to: result.to.toISOString(),
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = withStore('admin', handlePOST);
