/**
 * Orders sync: Sell Fulfillment -> `EbayOrder`.
 *
 * Read-only by construction. It issues `GET` only, so the client's read-only
 * guard never has to fire in normal operation -- the guard exists for the case
 * where a future change gets it wrong, not as part of this flow.
 *
 * Filtered order discovery exposes only the last 90 days and tolerates a
 * limited window per request, so a requested range is clamped to what eBay
 * actually serves and then tiled into chunks. Clamping is reported rather than
 * silent: the operator asked for a range and is entitled to know it changed.
 *
 * The `lastmodifieddate` filter (rather than `creationdate`) is what makes a
 * re-run pick up an order that was edited after it was created -- a refund or a
 * status change on an old order still lands.
 */

import type { EbayClient } from '../client';
import { chunkRange, clampToRetention, utcDay, DOMAIN_WINDOWS, type DateRange } from '../ranges';
import { mapOrder, OrderMappingError, type MappedOrder } from '../mappers/orders';

export interface OrderWriter {
  /** Idempotent upsert keyed on the eBay order id. Returns rows written. */
  upsertMany(orders: MappedOrder[]): Promise<number>;
}

export interface SyncOrdersOptions {
  client: EbayClient;
  writer: OrderWriter;
  range: DateRange;
  pageSize?: number;
  /** Safety valve: a malformed cursor must not loop forever. */
  maxPages?: number;
  now?: Date;
}

export interface SyncOrdersResult {
  fetched: number;
  stored: number;
  /** Human-readable reasons, one per order that could not be mapped. */
  skipped: string[];
  effectiveFrom: Date;
  effectiveTo: Date;
  clamped: boolean;
  /** True when the page cap stopped the run before eBay ran out of orders. */
  truncated: boolean;
  /** True when the whole requested range predates what eBay serves. */
  outOfRetention: boolean;
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 200;

/** eBay wants `[from..to]` in its own bracketed interval syntax. */
function lastModifiedFilter(range: DateRange): string {
  return `lastmodifieddate:[${range.from.toISOString()}..${range.to.toISOString()}]`;
}

export async function syncOrders(
  options: SyncOrdersOptions
): Promise<SyncOrdersResult> {
  const {
    client,
    writer,
    range,
    pageSize = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    now = new Date(),
  } = options;

  const clamp = clampToRetention(range, {
    maxAgeDays: DOMAIN_WINDOWS.orders.maxAgeDays,
    now,
  });

  // Entirely outside what eBay serves. Report it rather than issuing requests
  // that can only come back empty.
  if (!clamp.effective) {
    return {
      fetched: 0,
      stored: 0,
      skipped: [],
      effectiveFrom: range.from,
      effectiveTo: range.to,
      clamped: true,
      truncated: false,
      outOfRetention: true,
    };
  }

  const effective = clamp.effective;

  // Newest first: a manual "sync now" should surface today's orders before it
  // works backwards, so the operator sees something useful immediately.
  const chunks = chunkRange(
    effective,
    DOMAIN_WINDOWS.orders.maxChunkDays,
    'newest-first'
  );

  // `chunkRange` tiles in whole UTC days, so every boundary it returns --
  // including the newest chunk's `to` -- lands on midnight. That is correct
  // for interior boundaries, but `effective.to` is (per `clampToRetention`)
  // the precise instant we actually want to reach, usually "now". Rounding
  // it down here would silently exclude everything since midnight on every
  // single run. Restore the exact instant on the one chunk whose day it
  // falls in.
  for (const chunk of chunks) {
    if (chunk.to.getTime() === utcDay(effective.to).getTime()) {
      chunk.to = effective.to;
    }
  }

  const result: SyncOrdersResult = {
    fetched: 0,
    stored: 0,
    skipped: [],
    effectiveFrom: effective.from,
    effectiveTo: effective.to,
    clamped: clamp.clamped,
    truncated: false,
    outOfRetention: false,
  };

  let pagesUsed = 0;

  for (const chunk of chunks) {
    let offset = 0;

    for (;;) {
      if (pagesUsed >= maxPages) {
        result.truncated = true;
        return result;
      }
      pagesUsed++;

      const page = (await client.get('/sell/fulfillment/v1/order', {
        query: {
          filter: lastModifiedFilter(chunk),
          limit: pageSize,
          offset,
        },
      })) as { orders?: unknown[] } | null;

      const orders = Array.isArray(page?.orders) ? page!.orders : [];
      result.fetched += orders.length;

      const mapped: MappedOrder[] = [];
      for (const raw of orders) {
        try {
          mapped.push(mapOrder(raw, now));
        } catch (error) {
          // One malformed order must not abandon the whole run; record it so
          // the operator can see something was left behind.
          result.skipped.push(
            error instanceof OrderMappingError
              ? error.message
              : `Unmappable order: ${String(error)}`
          );
        }
      }

      if (mapped.length > 0) {
        result.stored += await writer.upsertMany(mapped);
      }

      // A short page means the chunk is exhausted. Trusting this rather than
      // `total` avoids an extra request and survives a wrong total.
      if (orders.length < pageSize) break;
      offset += pageSize;
    }
  }

  return result;
}
