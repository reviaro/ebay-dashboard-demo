import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getEbayConfig, getEbayStores } from '@/lib/ebay/server';
import { errorResponse, guardOrigin } from '@/lib/ebay/route-helpers';
import { createPrismaOrderWriter } from '@/lib/ebay/sync/prisma-order-writer';
import { runOrdersSync } from '@/lib/ebay/sync/run-orders';
import { createPrismaSyncLog } from '@/lib/ebay/sync/prisma-sync-log';
import { createPrismaSyncLockStore } from '@/lib/ebay/prisma-sync-lock';
import { DOMAIN_WINDOWS } from '@/lib/ebay/ranges';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Periods the UI offers. 90 is eBay's filtered-discovery limit for orders. */
const ALLOWED_DAYS = [1, 7, 30, 90] as const;

/**
 * Manual orders sync.
 *
 * POST because it changes local state, which also means the origin guard and
 * the session check both apply. It is still a read-only operation as far as
 * eBay is concerned: every request it makes is a GET.
 */
async function handlePOST(request: Request) {

  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  let days = 7;
  try {
    const body = (await request.json().catch(() => ({}))) as { days?: unknown };
    if (body.days !== undefined) {
      const requested = Number(body.days);
      if (!ALLOWED_DAYS.includes(requested as (typeof ALLOWED_DAYS)[number])) {
        return NextResponse.json(
          {
            error: `days must be one of ${ALLOWED_DAYS.join(', ')}.`,
            code: 'bad_request',
          },
          { status: 400 }
        );
      }
      days = requested;
    }
  } catch {
    return NextResponse.json(
      { error: 'Expected a JSON body.', code: 'bad_request' },
      { status: 400 }
    );
  }

  try {
    // Lease, run record and nesting all live in runOrdersSync, shared with the
    // scheduled worker so the two triggers cannot drift apart.
    const result = await runOrdersSync({
      lockStore: createPrismaSyncLockStore(prisma),
      recorder: createPrismaSyncLog(prisma),
      writer: createPrismaOrderWriter(prisma),
      trigger: 'manual',
      days,
      resolve: () => ({ config: getEbayConfig(), accounts: getEbayStores().accounts }),
    });

    return NextResponse.json({
      ok: true,
      requestedDays: days,
      maxDays: DOMAIN_WINDOWS.orders.maxAgeDays,
      fetched: result.fetched,
      stored: result.stored,
      skipped: result.skipped.length,
      // Surfaced so the UI can say what actually happened rather than implying
      // the full requested range was imported.
      clamped: result.clamped,
      truncated: result.truncated,
      outOfRetention: result.outOfRetention,
      from: result.effectiveFrom.toISOString(),
      to: result.effectiveTo.toISOString(),
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = withStore('admin', handlePOST);
