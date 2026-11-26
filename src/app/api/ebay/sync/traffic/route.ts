import { withStore } from '@/lib/stores/route';
import { withStoreData } from '@/lib/stores/context';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getEbayConfig, getEbayStores } from '@/lib/ebay/server';
import { errorResponse, guardOrigin } from '@/lib/ebay/route-helpers';
import { createEbayClient } from '@/lib/ebay/client';
import { createTokenProvider } from '@/lib/ebay/access-token';
import { exchangeWithEbay } from '@/lib/ebay/token-exchange';
import { createPrismaChunkStore } from '@/lib/ebay/sync/prisma-chunk-store';
import { createPrismaTrafficStore } from '@/lib/ebay/sync/prisma-traffic-writer';
import { runTrafficSync, describeTrafficRun } from '@/lib/ebay/sync/run-traffic';
import { fetchTrafficBudget, REFRESH_RESERVE } from '@/lib/ebay/sync/traffic-budget';
import { createPrismaSyncLog } from '@/lib/ebay/sync/prisma-sync-log';
import { createPrismaSyncLockStore } from '@/lib/ebay/prisma-sync-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Used only if no `EbaySyncSetting` row exists yet for traffic. */
const DEFAULT_DAYS = 7;

/**
 * Remaining traffic calls, less a reserve for the next refresh. Null if
 * eBay's rate-limit endpoint doesn't answer -- same fallback as the
 * scheduled worker (`scripts/sync-due.ts`), which this mirrors.
 */
async function trafficBudget(): Promise<number | null> {
  try {
    const config = getEbayConfig();
    const accounts = getEbayStores().accounts;
    const tokens = createTokenProvider({ config, accounts, exchange: exchangeWithEbay });
    const client = createEbayClient({ config, getAccessToken: () => tokens.getAccessToken() });
    const budget = await fetchTrafficBudget(client);
    if (!budget) return null;
    return budget.remaining > REFRESH_RESERVE ? budget.remaining - REFRESH_RESERVE : budget.remaining;
  } catch {
    return null;
  }
}

/**
 * Manual traffic sync.
 *
 * `days` here only sizes the settling-refresh window -- repair and backfill
 * run every time regardless of this value -- so, like finances, there is no
 * picker for it; it uses the domain's already-configured lookback.
 *
 * Also checks eBay's live remaining allowance before running, exactly like
 * the scheduled worker, so a manual click on top of the hourly cron cannot
 * overspend the 100-call daily budget.
 */
async function handlePOST(request: Request) {

  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  try {
    const budget = await trafficBudget();
    if (budget !== null && budget < 1) {
      return NextResponse.json(
        { error: "eBay's daily traffic allowance is spent for today.", code: 'no_allowance' },
        { status: 429 }
      );
    }

    const setting = await prisma.ebaySyncSetting.findUnique({ where: { storeId_domain: withStoreData({ domain: 'traffic' }) } });
    const days = setting?.lookbackDays ?? DEFAULT_DAYS;

    const result = await runTrafficSync({
      lockStore: createPrismaSyncLockStore(prisma),
      recorder: createPrismaSyncLog(prisma),
      chunks: createPrismaChunkStore(prisma),
      traffic: createPrismaTrafficStore(prisma),
      trigger: 'manual',
      days,
      maxRequests: budget ?? undefined,
      resolve: () => ({ config: getEbayConfig(), accounts: getEbayStores().accounts }),
    });

    return NextResponse.json({
      ok: true,
      requestedDays: days,
      dayRows: result.dayRows,
      listingRows: result.listingRows,
      requests: result.requests,
      owed: result.owed,
      note: describeTrafficRun(result),
      from: result.from.toISOString(),
      to: result.to.toISOString(),
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = withStore('admin', handlePOST);
