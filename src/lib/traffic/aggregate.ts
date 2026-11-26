/**
 * Rolls daily traffic rows up for display.
 *
 * Two jobs, both of which have to happen in one place because getting either
 * wrong is invisible:
 *
 *   - **Sum across the right axis.** A listing's figure for a window is the sum
 *     of its days; a day's figure is the sum of its marketplaces.
 *   - **Compute rates from the summed counts, never from stored rates.**
 *     Averaging a per-day CTR weights a day with 4 impressions the same as one
 *     with 4,000, and eBay's own rate fields are fractions rounded to two
 *     decimals, losing precision. Only counts are stored,
 *     so the rate is derived here or not at all.
 *
 * The uploaded CSV traffic in `PerformanceMetric` is deliberately not part of
 * this. Those rows are **lifetime-to-date totals per listing**, restated by
 * every upload. Adding them to daily counts adds a different quantity, and
 * summing snapshots multiplies a lifetime figure by the number of uploads.
 * Use API backfill for daily coverage within its retention window.
 */

/** The counts any API traffic row carries, whichever dimension it came from. */
export interface CountRow {
  date: Date;
  impressionsTotal: number;
  viewsTotal: number;
}

export interface ListingRow extends CountRow {
  listingId: string;
  title: string | null;
  transactions: number;
}

export interface ListingTotals {
  listingId: string;
  title: string | null;
  impressions: number;
  views: number;
  /** Views per impression, as a percentage. */
  ctr: number;
  transactions: number;
  /** Sales per view, as a percentage. */
  conversionRate: number;
}

export interface DailyTotals {
  date: Date;
  impressions: number;
  views: number;
  ctr: number;
}

const percent = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/** One row per listing, busiest first. */
export function aggregateListings(rows: ListingRow[]): ListingTotals[] {
  const byListing = new Map<string, ListingTotals>();

  for (const row of rows) {
    const existing = byListing.get(row.listingId);
    if (existing) {
      existing.title ??= row.title;
      existing.impressions += row.impressionsTotal;
      existing.views += row.viewsTotal;
      existing.transactions += row.transactions;
      continue;
    }
    byListing.set(row.listingId, {
      listingId: row.listingId,
      title: row.title,
      impressions: row.impressionsTotal,
      views: row.viewsTotal,
      ctr: 0,
      transactions: row.transactions,
      conversionRate: 0,
    });
  }

  return [...byListing.values()]
    .map((entry) => ({
      ...entry,
      ctr: percent(entry.views, entry.impressions),
      conversionRate: percent(entry.transactions, entry.views),
    }))
    .sort((a, b) => b.impressions - a.impressions);
}

/**
 * One row per day, oldest first, for charting.
 *
 * Fed the store-wide DAY rows rather than a sum of the per-listing ones: the
 * DAY dimension counts every listing, while a LISTING response stops at 200
 * and would quietly under-report the store's own trend on a busy day. Rows for
 * the same day on different marketplaces are summed, which is the one place
 * summing marketplaces is right -- they are separate requests precisely so
 * that choice stays here rather than being made silently by eBay.
 */
export function aggregateDaily(rows: CountRow[]): DailyTotals[] {
  const byDate = new Map<string, { date: Date; impressions: number; views: number }>();

  for (const row of rows) {
    const key = dayKey(row.date);
    const existing = byDate.get(key);
    if (existing) {
      existing.impressions += row.impressionsTotal;
      existing.views += row.viewsTotal;
      continue;
    }
    byDate.set(key, { date: row.date, impressions: row.impressionsTotal, views: row.viewsTotal });
  }

  return [...byDate.values()]
    .map((day) => ({ ...day, ctr: percent(day.views, day.impressions) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
