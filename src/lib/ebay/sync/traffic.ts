/**
 * Fetches traffic from the Sell Analytics report.
 *
 * Two requests, because eBay serves one dimension at a time:
 *
 *   - **DAY** gives store-wide totals and accepts up to a 90-day window.
 *   - **LISTING** gives per-listing totals for whatever window is asked for,
 *     but caps the response at 200 rows and ignores `limit`/`offset`. A single
 *     day minimizes truncation risk and is the only way to get a per-listing
 *     series, since the
 *     `dimension` parameter refuses to combine LISTING with DAY.
 *
 * Both the marketplace and the date range are mandatory filters. Omitting
 * either produces error 50022.
 */

import type { EbayClient } from '../client';
import { daysInRange } from '../ranges';
import {
  DAY_METRICS,
  LISTING_METRICS,
  parseTrafficReport,
  toDayRows,
  toListingRows,
  type TrafficDayRow,
  type TrafficListingRow,
} from '../mappers/traffic-report';

const TRAFFIC_PATH = '/sell/analytics/v1/traffic_report';

/**
 * Which marketplaces a store's traffic can land on.
 *
 * A store configured for EBAY_US may have traffic on EBAY_MOTORS_US while
 * purchases post to EBAY_US. Querying one filter for
 * both is not an option: the response carries no marketplace dimension, so a
 * combined filter silently sums them and there is no way to split the total
 * back apart. Each marketplace is therefore a separate request and a separate
 * row.
 */
const MARKETPLACE_SIBLINGS: Record<string, readonly string[]> = {
  EBAY_US: ['EBAY_US', 'EBAY_MOTORS_US'],
};

export function trafficMarketplaces(configured: string): string[] {
  return [...(MARKETPLACE_SIBLINGS[configured] ?? [configured])];
}

/** eBay's date format for the report filter: a bare UTC calendar day. */
export function dayLabel(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function filterFor(marketplaceId: string, from: Date, to: Date): string {
  return `marketplace_ids:{${marketplaceId}},date_range:[${dayLabel(from)}..${dayLabel(to)}]`;
}

export class TrafficFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrafficFetchError';
  }
}

/**
 * Store-wide traffic for a range of at most 90 days.
 *
 * The response must carry a row for every day asked for. It normally does --
 * even a marketplace with no activity returns a row of zeros per day -- so a
 * short response can otherwise leave missing days behind a completed chunk.
 * Rejecting it here ensures the chunk is retried, even when the API returns a
 * 200 status with incomplete records.
 */
export async function fetchDayTraffic(options: {
  client: EbayClient;
  marketplaceId: string;
  from: Date;
  to: Date;
}): Promise<TrafficDayRow[]> {
  const { client, marketplaceId, from, to } = options;

  const response = await client.get(TRAFFIC_PATH, {
    query: {
      dimension: 'DAY',
      filter: filterFor(marketplaceId, from, to),
      metric: DAY_METRICS.join(','),
    },
  });

  const rows = toDayRows(parseTrafficReport(response, 'DAY'), marketplaceId);
  const expected = daysInRange({ from, to });

  if (rows.length !== expected) {
    throw new TrafficFetchError(
      `${marketplaceId} returned ${rows.length} day(s) for a ${expected}-day window ` +
        `(${dayLabel(from)}..${dayLabel(to)}).`
    );
  }

  return rows;
}

/**
 * Per-listing traffic for one day.
 *
 * The metric list is `LISTING_METRICS` and must stay that way: four of the
 * metrics the DAY dimension serves make this request return an empty
 * `records` array instead -- with a 200 status, no error and no warning -- and
 * one of them in the list empties the whole response.
 */
export async function fetchListingTraffic(options: {
  client: EbayClient;
  marketplaceId: string;
  date: Date;
}): Promise<TrafficListingRow[]> {
  const { client, marketplaceId, date } = options;

  const response = await client.get(TRAFFIC_PATH, {
    query: {
      dimension: 'LISTING',
      filter: filterFor(marketplaceId, date, date),
      metric: LISTING_METRICS.join(','),
    },
  });

  return toListingRows(parseTrafficReport(response, 'LISTING'), marketplaceId, date);
}
