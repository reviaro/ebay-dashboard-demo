import { reportingNow } from '@/lib/demo/server';
import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { errorResponse } from '@/lib/ebay/route-helpers';
import { CURRENT_RUN_STATUSES, describeSyncState } from '@/lib/ebay/sync/freshness';

export const dynamic = 'force-dynamic';

/**
 * How current the order data is.
 *
 * Separate from `/api/ebay/status`, which answers whether the account is
 * connected. Connection health and data freshness fail independently: a
 * perfectly connected account that nobody has synced in a week is stale, and
 * that is exactly what this reports.
 *
 * `/orders` shows two sources merged, so both halves are returned -- the last
 * eBay sync and the last CSV upload. One number over a mixed list would imply
 * the CSV rows are as current as the API ones.
 */
async function handleGET() {

  try {
    const [lastRun, lastSuccess, orders, lastUpload] = await Promise.all([
      // Restricted to this logger's own statuses -- see CURRENT_RUN_STATUSES.
      // Otherwise a legacy error could mislabel the current sync as failed.
      prisma.ebaySyncLog.findFirst({
        where: { type: 'orders', status: { in: [...CURRENT_RUN_STATUSES] } },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.ebaySyncLog.findFirst({
        where: { type: 'orders', status: 'ok' },
        orderBy: { finishedAt: 'desc' },
      }),
      prisma.ebayOrder.aggregate({ _max: { syncedAt: true }, _count: { _all: true } }),
      prisma.uploadRecord.findFirst({
        where: { type: 'sales' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const state = describeSyncState({
      lastRun: lastRun
        ? {
            status: lastRun.status,
            startedAt: lastRun.startedAt,
            finishedAt: lastRun.finishedAt,
            count: lastRun.count,
            message: lastRun.message,
          }
        : null,
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      inferredSyncedAt: orders._max.syncedAt ?? null,
      now: reportingNow(),
    });

    return NextResponse.json({
      orders: {
        ...state,
        orderCount: orders._count._all,
      },
      csv: {
        lastUploadAt: lastUpload?.createdAt ?? null,
        filename: lastUpload?.filename ?? null,
        rowCount: lastUpload?.rowCount ?? null,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = withStore('view', handleGET);
