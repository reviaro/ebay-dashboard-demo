import { reportingNow, isDemoMode } from '@/lib/demo/server';
import { withStore } from '@/lib/stores/route';
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { aggregateListings } from "@/lib/traffic/aggregate";
import { generateSuggestedTasks } from "@/lib/task-generator";

async function handleGET() {
  try {
    // Per-listing traffic for the last 30 days, from the eBay Analytics API.
    // Not PerformanceMetric: its `impressions` is a lifetime-to-date total, so
    // every listing clears the thresholds on day one.
    const thirtyDaysAgo = reportingNow();
    if (isDemoMode()) {
      thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29);
      thirtyDaysAgo.setUTCHours(0, 0, 0, 0);
    } else {
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    }

    const rows = await prisma.ebayTrafficListing.findMany({
      where: { date: { gte: thirtyDaysAgo } },
    });

    const perListing = aggregateListings(rows).map((l) => ({
      itemId: l.listingId,
      impressions: l.impressions,
      pageViews: l.views,
      ctr: l.ctr,
      conversionRate: l.conversionRate,
    }));

    const suggestions = generateSuggestedTasks(perListing);

    return NextResponse.json(suggestions);
  } catch (error) {
    console.error("Failed to generate task suggestions:", error);
    return NextResponse.json({ error: "Failed to generate task suggestions" }, { status: 500 });
  }
}

export const GET = withStore('view', handleGET);
