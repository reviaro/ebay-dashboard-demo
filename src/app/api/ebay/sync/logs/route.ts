import { withStore } from '@/lib/stores/route';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { errorResponse } from '@/lib/ebay/route-helpers';
import { CURRENT_RUN_STATUSES } from '@/lib/ebay/sync/freshness';

export const dynamic = 'force-dynamic';

/**
 * Recent sync runs, newest first.
 *
 * Restricted to this logger's status vocabulary: legacy rows written with
 * `success`/`error` must not be shown as current sync activity. Messages were
 * redacted when written.
 */
async function handleGET(request: NextRequest) {

  try {
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 20), 1), 100);

    const runs = await prisma.ebaySyncLog.findMany({
      where: { status: { in: [...CURRENT_RUN_STATUSES] } },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({
      runs: runs.map((run) => ({
        id: run.id,
        type: run.type,
        status: run.status,
        count: run.count,
        message: run.message,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = withStore('view', handleGET);
