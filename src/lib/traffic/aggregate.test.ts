import { describe, expect, it } from 'vitest';
import { aggregateDaily, aggregateListings, type CountRow, type ListingRow } from './aggregate';

const listing = (date: string, listingId: string, impressions: number, views: number, transactions = 0): ListingRow => ({
  date: new Date(date), listingId, title: `Listing ${listingId}`,
  impressionsTotal: impressions, viewsTotal: views, transactions,
});

const day = (date: string, impressions: number, views: number): CountRow => ({
  date: new Date(date), impressionsTotal: impressions, viewsTotal: views,
});

describe('aggregateListings', () => {
  it('sums a listing across the days in the window', () => {
    const [total] = aggregateListings([
      listing('2026-09-01T00:00:00.000Z', '406', 100, 5, 1),
      listing('2026-09-02T00:00:00.000Z', '406', 200, 9, 2),
    ]);

    expect(total).toMatchObject({ impressions: 300, views: 14, transactions: 3 });
  });

  /**
   * The bug this replaces: `/api/traffic` summed each snapshot's stored CTR and
   * divided by the number of snapshots, which weights a day with 4 impressions
   * the same as one with 4,000.
   */
  it('computes CTR from the summed counts rather than averaging stored rates', () => {
    const [total] = aggregateListings([
      listing('2026-09-01T00:00:00.000Z', '406', 4, 2),      // 50%
      listing('2026-09-02T00:00:00.000Z', '406', 4000, 40),  // 1%
    ]);

    // 42 views over 4004 impressions is 1.05%, not the 25.5% an average gives.
    expect(total.ctr).toBeCloseTo(1.049, 2);
  });

  it('reports zero rather than dividing by nothing', () => {
    const [total] = aggregateListings([listing('2026-09-01T00:00:00.000Z', '406', 0, 0)]);

    expect(total).toMatchObject({ ctr: 0, conversionRate: 0 });
  });

  it('measures conversion against views', () => {
    const [total] = aggregateListings([listing('2026-09-01T00:00:00.000Z', '406', 1000, 50, 5)]);

    expect(total.conversionRate).toBeCloseTo(10, 5);
  });

  it('keeps a title from whichever day carried one', () => {
    const [total] = aggregateListings([
      { ...listing('2026-09-01T00:00:00.000Z', '406', 10, 1), title: null },
      listing('2026-09-02T00:00:00.000Z', '406', 10, 1),
    ]);

    expect(total.title).toBe('Listing 406');
  });

  it('orders by impressions, busiest first', () => {
    const totals = aggregateListings([
      listing('2026-09-01T00:00:00.000Z', 'quiet', 10, 1),
      listing('2026-09-01T00:00:00.000Z', 'busy', 900, 20),
    ]);

    expect(totals.map((t) => t.listingId)).toEqual(['busy', 'quiet']);
  });
});

describe('aggregateDaily', () => {
  it('sums a day across marketplaces and orders oldest first', () => {
    const daily = aggregateDaily([
      day('2026-09-02T00:00:00.000Z', 1500, 40),
      day('2026-09-02T00:00:00.000Z', 0, 0),
      day('2026-09-01T00:00:00.000Z', 1200, 30),
    ]);

    expect(daily.map((d) => [d.date.toISOString().slice(0, 10), d.impressions])).toEqual([
      ['2026-09-01', 1200],
      ['2026-09-02', 1500],
    ]);
  });

  it('derives the day’s CTR from its own counts', () => {
    expect(aggregateDaily([day('2026-09-01T00:00:00.000Z', 1000, 25)])[0].ctr).toBeCloseTo(2.5, 5);
  });
});
