/**
 * What traffic is missing, worked out from the stored rows themselves.
 *
 * The backfill needs to know which days it still owes. It could track that in
 * a checkpoint table, but the data is a better record than a parallel ledger:
 * a day with rows is fetched, a day without is not, and no bookkeeping can
 * drift away from that. It also fills holes in the middle, which a cursor
 * marching backwards from the oldest stored day cannot.
 *
 * The one subtlety is that "no per-listing rows" does not always mean "not
 * fetched". A day on which the store had no impressions at all legitimately
 * produces no listing rows, and treating it as outstanding would make the
 * backfill retry it every run, forever. So per-listing days are owed only
 * where the store-wide table says there *were* impressions — which is cheap to
 * know, because store-wide traffic comes 90 days at a time.
 */

import { chunkRange, utcDay, type DateRange } from '../ebay/ranges';

const MS_PER_DAY = 86_400_000;

const key = (date: Date) => utcDay(date).toISOString().slice(0, 10);

/** Every UTC day in an inclusive range, oldest first. */
export function daysIn(range: DateRange): Date[] {
  const days: Date[] = [];
  const to = utcDay(range.to).getTime();
  for (let t = utcDay(range.from).getTime(); t <= to; t += MS_PER_DAY) {
    days.push(new Date(t));
  }
  return days;
}

/** Days of `range` with nothing stored for them, newest first. */
export function missingDays(range: DateRange, have: Date[]): Date[] {
  const stored = new Set(have.map(key));
  return daysIn(range)
    .filter((day) => !stored.has(key(day)))
    .reverse();
}

/**
 * Per-listing days still owed, newest first.
 *
 * `withImpressions` is the store-wide side: days the report says had traffic.
 * `fetched` is the set of days already carrying per-listing rows. A day with
 * no impressions is never owed, however empty its listing rows are.
 */
export function listingDaysOwed(withImpressions: Date[], fetched: Date[]): Date[] {
  const done = new Set(fetched.map(key));
  return withImpressions
    .filter((day) => !done.has(key(day)))
    .sort((a, b) => b.getTime() - a.getTime());
}

/**
 * The request windows that contain at least one missing day.
 *
 * Tiled exactly as a full-range fetch would tile it, so a repair asks for the
 * same windows the original run did rather than inventing new boundaries that
 * would re-fetch neighbours for no reason. Newest first, because the recent
 * end of a gap is the half anyone is looking at.
 */
export function windowsCovering(
  range: DateRange,
  missing: Date[],
  chunkDays: number
): DateRange[] {
  if (missing.length === 0) return [];

  const wanted = new Set(missing.map(key));

  return chunkRange(range, chunkDays, 'newest-first').filter((window) =>
    daysIn(window).some((day) => wanted.has(key(day)))
  );
}
