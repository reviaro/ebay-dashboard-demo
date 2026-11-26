import { reportingNow } from '@/lib/demo/server';
import { withStore } from '@/lib/stores/route';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { aggregateDaily, aggregateListings } from "@/lib/traffic/aggregate";
import { CURRENT_RUN_STATUSES, describeSyncState } from "@/lib/ebay/sync/freshness";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 30;
/** eBay serves two years; asking for more would return the same rows. */
const MAX_DAYS = 730;

function windowStart(days: number): Date {
  const today = reportingNow();
  const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  // Inclusive of today, matching how the sync asks eBay for a window.
  return new Date(utcToday - (days - 1) * 86_400_000);
}

/**
 * Per-listing traffic over a window, plus the store's daily trend.
 *
 * Reads only the API tables. The uploaded CSV traffic in `PerformanceMetric`
 * is lifetime-to-date per listing rather than a daily count, so it cannot be
 * added to these numbers -- and every date it covers is inside the two years
 * the API serves, so a backfill supplies the same period at real daily
 * resolution. See `lib/traffic/aggregate.ts`.
 *
 * Freshness and coverage are returned with the numbers rather than assumed. A
 * window reaching back further than anything that has been synced would
 * otherwise draw an empty chart that looks exactly like a store nobody visits.
 */
async function handleGET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(searchParams.get("days") ?? String(DEFAULT_DAYS), 10) || DEFAULT_DAYS));
  const search = searchParams.get("search") ?? "";
  const from = windowStart(days);

  const [listingRows, storeDays, coverage, lastRun, lastSuccess] = await Promise.all([
    prisma.ebayTrafficListing.findMany({ where: { date: { gte: from } } }),
    prisma.ebayTrafficDay.findMany({ where: { date: { gte: from } } }),
    prisma.ebayTrafficDay.aggregate({ _min: { date: true }, _max: { syncedAt: true } }),
    // Restricted to this logger's vocabulary so legacy errors cannot be
    // mistaken for a failure of the current traffic sync.
    prisma.ebaySyncLog.findFirst({
      where: { type: "traffic", status: { in: [...CURRENT_RUN_STATUSES] } },
      orderBy: { startedAt: "desc" },
    }),
    prisma.ebaySyncLog.findFirst({
      where: { type: "traffic", status: "ok" },
      orderBy: { finishedAt: "desc" },
    }),
  ]);

  let listings = aggregateListings(listingRows);

  // Titles the report did not annotate, filled from whatever knows them.
  const missing = listings.filter((l) => !l.title).map((l) => l.listingId);
  if (missing.length > 0) {
    const inventory = await prisma.inventory.findMany({
      where: { itemId: { in: missing } },
      select: { itemId: true, title: true },
    });
    const titles = new Map(inventory.map((i) => [i.itemId, i.title]));
    listings = listings.map((l) => ({ ...l, title: l.title ?? titles.get(l.listingId) ?? null }));
  }

  if (search) {
    const q = search.toLowerCase();
    listings = listings.filter(
      (l) => l.listingId.includes(q) || (l.title ?? "").toLowerCase().includes(q)
    );
  }

  const total = listings.length;
  const paged = listings.slice((page - 1) * limit, page * limit);

  const noteCounts = await prisma.listingNote.groupBy({
    by: ["listingId"],
    where: { listingId: { in: paged.map((l) => l.listingId) } },
    _count: { id: true },
  });
  const noteMap = new Map(noteCounts.map((n) => [n.listingId, n._count.id]));

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
    inferredSyncedAt: coverage._max.syncedAt ?? null,
    now: reportingNow(),
  });

  const earliest = coverage._min.date;

  return NextResponse.json({
    listings: paged.map((l) => ({ ...l, noteCount: noteMap.get(l.listingId) ?? 0 })),
    total,
    page,
    days,
    daily: aggregateDaily(storeDays).map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      impressions: d.impressions,
      views: d.views,
      ctr: d.ctr,
    })),
    sync: {
      state: state.state,
      lastSyncedAt: state.lastSyncedAt,
      message: state.message,
      /** Oldest day ever synced, so the page can say what the window misses. */
      earliestSyncedDate: earliest ? earliest.toISOString().slice(0, 10) : null,
      /** True when the chosen window starts before anything that was synced. */
      windowExceedsData: earliest ? earliest.getTime() > from.getTime() : true,
      // Days eBay stopped at its 200-listing cap are a real gap in the
      // per-listing table, and one nothing else would ever show.
      truncatedDays: new Set(
        listingRows.filter((row) => row.truncated).map((row) => row.date.toISOString().slice(0, 10))
      ).size,
    },
  });
}

export const GET = withStore('view', handleGET);
