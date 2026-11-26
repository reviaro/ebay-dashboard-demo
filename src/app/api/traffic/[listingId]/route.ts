import { withStore } from '@/lib/stores/route';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { aggregateDaily, aggregateListings } from "@/lib/traffic/aggregate";

export const dynamic = "force-dynamic";

/**
 * One listing's traffic history: a real daily series, one row per day the sync
 * has fetched.
 *
 * Uploaded CSV traffic is not included -- those rows are lifetime-to-date
 * totals, so charting them beside daily counts would draw a step change that
 * never happened. See `lib/traffic/aggregate.ts`.
 */
async function handleGET(_req: NextRequest, { params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;

  const rows = await prisma.ebayTrafficListing.findMany({
    where: { listingId },
    orderBy: { date: "asc" },
  });

  const series = rows.map((row) => ({
    date: row.date,
    listingId: row.listingId,
    title: row.title,
    impressionsTotal: row.impressionsTotal,
    viewsTotal: row.viewsTotal,
    transactions: row.transactions,
  }));

  const [totals] = aggregateListings(series);

  return NextResponse.json({
    listingId,
    totals: totals ?? {
      listingId,
      title: null,
      impressions: 0,
      views: 0,
      ctr: 0,
      transactions: 0,
      conversionRate: 0,
    },
    daily: aggregateDaily(series).map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      impressions: d.impressions,
      views: d.views,
      ctr: d.ctr,
    })),
  });
}

export const GET = withStore('view', handleGET);
