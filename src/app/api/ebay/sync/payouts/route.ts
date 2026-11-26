import { withStore } from '@/lib/stores/route';
import { withStoreData } from '@/lib/stores/context';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getEbayConfig, getEbayStores } from '@/lib/ebay/server';
import { errorResponse, guardOrigin } from '@/lib/ebay/route-helpers';
import { createPrismaFinanceStore } from '@/lib/ebay/sync/prisma-finance-writer';
import { runPayoutSync } from '@/lib/ebay/sync/run-payout';
import { createPrismaSyncLog } from '@/lib/ebay/sync/prisma-sync-log';
import { createPrismaSyncLockStore } from '@/lib/ebay/prisma-sync-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Used only if no `EbaySyncSetting` row exists yet for payouts. */
const DEFAULT_DAYS = 14;

/** Manual payout sync, using the domain's already-configured lookback window. */
async function handlePOST(request: Request) {

  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  try {
    const setting = await prisma.ebaySyncSetting.findUnique({ where: { storeId_domain: withStoreData({ domain: 'payouts' }) } });
    const days = setting?.lookbackDays ?? DEFAULT_DAYS;

    const result = await runPayoutSync({
      lockStore: createPrismaSyncLockStore(prisma),
      recorder: createPrismaSyncLog(prisma),
      finance: createPrismaFinanceStore(prisma),
      trigger: 'manual',
      days,
      resolve: () => ({ config: getEbayConfig(), accounts: getEbayStores().accounts }),
    });

    return NextResponse.json({
      ok: true,
      requestedDays: days,
      payoutRows: result.payoutRows,
      from: result.from.toISOString(),
      to: result.to.toISOString(),
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = withStore('admin', handlePOST);
