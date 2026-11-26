import { describe, expect, it } from 'vitest';
import { daysIn, listingDaysOwed, missingDays, windowsCovering } from './coverage';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const label = (date: Date) => date.toISOString().slice(0, 10);

describe('daysIn', () => {
  it('includes both ends', () => {
    expect(daysIn({ from: d('2026-09-01'), to: d('2026-09-03') }).map(label)).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03',
    ]);
  });

  it('treats a single day as one day, not none', () => {
    expect(daysIn({ from: d('2026-09-01'), to: d('2026-09-01') })).toHaveLength(1);
  });
});

describe('missingDays', () => {
  it('finds holes in the middle, not just at the ends', () => {
    const missing = missingDays(
      { from: d('2026-09-01'), to: d('2026-09-05') },
      [d('2026-09-01'), d('2026-09-02'), d('2026-09-05')]
    );

    expect(missing.map(label)).toEqual(['2026-09-04', '2026-09-03']);
  });

  it('returns newest first, so a budget-limited repair starts where it matters', () => {
    const missing = missingDays({ from: d('2026-09-01'), to: d('2026-09-04') }, []);

    expect(missing.map(label)).toEqual([
      '2026-09-04', '2026-09-03', '2026-09-02', '2026-09-01',
    ]);
  });

  it('ignores the time of day on a stored timestamp', () => {
    const missing = missingDays(
      { from: d('2026-09-01'), to: d('2026-09-01') },
      [new Date('2026-09-01T13:45:00.000Z')]
    );

    expect(missing).toEqual([]);
  });
});

describe('listingDaysOwed', () => {
  it('owes a day that had impressions but no per-listing rows', () => {
    const owed = listingDaysOwed([d('2026-09-01'), d('2026-09-02')], [d('2026-09-01')]);

    expect(owed.map(label)).toEqual(['2026-09-02']);
  });

  /**
   * The reason this takes the store-wide days rather than the calendar: a day
   * on which nothing was seen produces no per-listing rows however many times
   * it is fetched, so a calendar-based backfill would retry it every run for
   * as long as the data is kept.
   */
  it('never owes a day the store saw no impressions on', () => {
    const owed = listingDaysOwed([d('2026-09-02')], []);

    expect(owed.map(label)).toEqual(['2026-09-02']);
    expect(listingDaysOwed([], [])).toEqual([]);
  });

  it('returns newest first', () => {
    const owed = listingDaysOwed([d('2026-09-01'), d('2026-09-03'), d('2026-09-02')], []);

    expect(owed.map(label)).toEqual(['2026-09-03', '2026-09-02', '2026-09-01']);
  });
});

describe('windowsCovering', () => {
  const range = { from: d('2026-06-01'), to: d('2026-08-29') };

  it('asks for nothing when nothing is missing', () => {
    expect(windowsCovering(range, [], 30)).toEqual([]);
  });

  /**
   * Tiled the same way a full fetch would tile it, so a repair re-requests the
   * window the gap belongs to rather than inventing a new boundary around it.
   */
  it('returns only the tiles that contain a gap', () => {
    const windows = windowsCovering(range, [d('2026-07-05')], 30);

    expect(windows.map((w) => [label(w.from), label(w.to)])).toEqual([
      ['2026-07-01', '2026-07-30'],
    ]);
  });

  it('returns several tiles newest first when the gap spans them', () => {
    const windows = windowsCovering(range, [d('2026-06-10'), d('2026-08-01')], 30);

    expect(windows.map((w) => label(w.from))).toEqual(['2026-07-31', '2026-06-01']);
  });
});
