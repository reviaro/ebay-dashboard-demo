/**
 * Date-window validation and chunking for eBay API requests.
 *
 * eBay caps how much history each API will return and how wide a single request
 * may be. Those two limits are different things and are handled separately:
 *
 *   - `maxAgeDays`   how far back the API has data at all (retention).
 *   - `maxChunkDays` how wide one request may be (request window).
 *
 * Plan §4: a requested range is never silently shortened. `clampToRetention`
 * reports the excluded portion so the caller can surface it before proceeding.
 *
 * All arithmetic is in whole UTC days, and ranges are inclusive of both ends:
 * 2026-01-01..2026-01-07 is 7 days. Working in UTC keeps a DST transition from
 * shifting a window by an hour and dropping or duplicating a day.
 */

const MS_PER_DAY = 86_400_000;

export interface DateRange {
  from: Date;
  to: Date;
}

export type ChunkOrder = 'oldest-first' | 'newest-first';

export class InvalidRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRangeError';
  }
}

/** Truncates a timestamp to UTC midnight of the same calendar day. */
export function utcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

/** Inclusive day count: a single-day range is 1, not 0. */
export function daysInRange(range: DateRange): number {
  const from = utcDay(range.from).getTime();
  const to = utcDay(range.to).getTime();
  return Math.floor((to - from) / MS_PER_DAY) + 1;
}

/** Exported because callers building a lookback window need the same arithmetic. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Splits a range into contiguous windows of at most `maxChunkDays` each.
 *
 * Chunks tile the input exactly: no gap, no overlap, no lost day. The final
 * chunk carries the remainder. `newest-first` reverses the emission order for
 * user-triggered refreshes without changing any chunk's boundaries, so a
 * backfill and a refresh of the same range hit identical windows.
 */
export function chunkRange(
  range: DateRange,
  maxChunkDays: number,
  order: ChunkOrder = 'oldest-first'
): DateRange[] {
  if (!Number.isFinite(maxChunkDays) || maxChunkDays < 1) {
    throw new InvalidRangeError(
      `Chunk size must be at least 1 day, got ${maxChunkDays}`
    );
  }

  const from = utcDay(range.from);
  const to = utcDay(range.to);

  if (from.getTime() > to.getTime()) {
    throw new InvalidRangeError(
      `Range start ${from.toISOString().slice(0, 10)} is after end ${to
        .toISOString()
        .slice(0, 10)}`
    );
  }

  const size = Math.floor(maxChunkDays);
  const chunks: DateRange[] = [];

  for (let cursor = from; cursor.getTime() <= to.getTime(); ) {
    // -1 because the range is inclusive: a 7-day chunk spans day 0 through 6.
    const candidateEnd = addDays(cursor, size - 1);
    const end = candidateEnd.getTime() > to.getTime() ? to : candidateEnd;
    chunks.push({ from: cursor, to: end });
    cursor = addDays(end, 1);
  }

  return order === 'newest-first' ? chunks.reverse() : chunks;
}

export interface RetentionOptions {
  /** How many days of history the API exposes, counting today as day 1. */
  maxAgeDays: number;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

export interface ClampResult {
  /** The portion we may actually request, or null if none of it survives. */
  effective: DateRange | null;
  /** The portion outside retention, for reporting to the operator. */
  excluded: DateRange | null;
  /** True when the request had to be narrowed for any reason. */
  clamped: boolean;
}

/**
 * Intersects a requested range with what the API can actually serve.
 *
 * Deliberately returns the excluded portion instead of quietly dropping it: the
 * caller is expected to tell the operator what will not be imported before the
 * run starts.
 */
export function clampToRetention(
  requested: DateRange,
  options: RetentionOptions
): ClampResult {
  const now = options.now ?? new Date();
  const today = utcDay(now);
  const from = utcDay(requested.from);
  const to = utcDay(requested.to);

  if (from.getTime() > to.getTime()) {
    throw new InvalidRangeError(
      `Range start ${from.toISOString().slice(0, 10)} is after end ${to
        .toISOString()
        .slice(0, 10)}`
    );
  }

  // Counting today as day 1, so a 90-day window reaches back 89 days.
  const earliest = addDays(today, -(options.maxAgeDays - 1));

  // Entirely older than retention: nothing is requestable.
  if (to.getTime() < earliest.getTime()) {
    return { effective: null, excluded: { from, to }, clamped: true };
  }

  const effectiveFrom = from.getTime() < earliest.getTime() ? earliest : from;
  // Clamp against the exact instant, not the calendar day. `to` above is
  // day-truncated only for the retention comparison above; using it as the
  // upper bound would silently drop everything after midnight on the final
  // day -- including "now" itself, which is what every caller actually
  // passes and is exactly the case that must not be dropped.
  const effectiveTo = requested.to.getTime() > now.getTime() ? now : requested.to;

  const excluded =
    effectiveFrom.getTime() > from.getTime()
      ? { from, to: addDays(effectiveFrom, -1) }
      : null;

  return {
    effective: { from: effectiveFrom, to: effectiveTo },
    excluded,
    clamped:
      effectiveFrom.getTime() !== from.getTime() ||
      effectiveTo.getTime() !== requested.to.getTime(),
  };
}

export interface DomainWindow {
  /** Widest single request this API accepts. */
  maxChunkDays: number;
  /** How far back this API exposes data. */
  maxAgeDays: number;
}

/**
 * Per-domain limits from the plan's capability map.
 *
 * Where eBay documents no hard cap (finances, inventory), a conservative chunk
 * is used anyway to bound memory, retry cost, and the blast radius of a failed
 * window.
 */
export const DOMAIN_WINDOWS = {
  /** Fulfillment order discovery filters expose only the last 90 days. */
  orders: { maxChunkDays: 30, maxAgeDays: 90 },
  /**
   * Analytics traffic accepts at most 90 days per request and two years of
   * history. A conservative 730-day age limit stays inside the moving boundary.
   */
  traffic: { maxChunkDays: 90, maxAgeDays: 730 },
  /** Promoted Listings priority reports with a day dimension cap at 7 days. */
  adsPriorityDaily: { maxChunkDays: 7, maxAgeDays: 730 },
  /** Other ad report types tolerate wider windows. */
  ads: { maxChunkDays: 30, maxAgeDays: 730 },
  /** Finances documents no hard window; chunked conservatively. */
  finances: { maxChunkDays: 30, maxAgeDays: 730 },
  payouts: { maxChunkDays: 90, maxAgeDays: 730 },
} as const satisfies Record<string, DomainWindow>;
