import { describe, expect, it, vi } from 'vitest';
import type { EbayClient } from '../client';
import {
  dayLabel,
  fetchDayTraffic,
  fetchListingTraffic,
  trafficMarketplaces,
  TrafficFetchError,
} from './traffic';
import { LISTING_UNSUPPORTED_METRICS } from '../mappers/traffic-report';

const cell = (v: number) => ({ value: v, applicable: true });

function client(response: unknown): { client: EbayClient; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn().mockResolvedValue(response);
  return { client: { get, request: vi.fn() } as unknown as EbayClient, get };
}

const DAY_RESPONSE = {
  header: {
    dimensionKeys: [{ key: 'DAY' }],
    metrics: [
      { key: 'LISTING_IMPRESSION_SEARCH_RESULTS_PAGE' },
      { key: 'LISTING_IMPRESSION_STORE' },
      { key: 'LISTING_IMPRESSION_TOTAL' },
      { key: 'LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE' },
      { key: 'LISTING_VIEWS_SOURCE_STORE' },
      { key: 'LISTING_VIEWS_SOURCE_DIRECT' },
      { key: 'LISTING_VIEWS_SOURCE_OTHER_EBAY' },
      { key: 'LISTING_VIEWS_SOURCE_OFF_EBAY' },
      { key: 'LISTING_VIEWS_TOTAL' },
      { key: 'TRANSACTION' },
    ],
  },
  records: [
    {
      dimensionValues: [{ value: '20260803', applicable: true }],
      metricValues: [1200, 0, 1200, 12, 0, 4, 1, 3, 20, 2].map(cell),
    },
  ],
  lastUpdatedDate: '2026-09-01T12:00:00.000Z',
};

/** A DAY response covering a whole window, which is what eBay normally sends. */
const dayResponseFor = (labels: string[]) => ({
  ...DAY_RESPONSE,
  records: labels.map((label) => ({
    dimensionValues: [{ value: label, applicable: true }],
    metricValues: [1200, 0, 1200, 12, 0, 4, 1, 3, 20, 2].map(cell),
  })),
});

const AUGUST_WEEK = ['20260801', '20260802', '20260803', '20260804', '20260805', '20260806', '20260807'];

const LISTING_RESPONSE = {
  header: {
    dimensionKeys: [{ key: 'LISTING' }],
    metrics: [
      { key: 'LISTING_IMPRESSION_SEARCH_RESULTS_PAGE' },
      { key: 'LISTING_IMPRESSION_STORE' },
      { key: 'LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE' },
      { key: 'LISTING_VIEWS_SOURCE_STORE' },
      { key: 'LISTING_VIEWS_TOTAL' },
      { key: 'TRANSACTION' },
    ],
  },
  records: [
    {
      dimensionValues: [{ value: '100000000010', applicable: true }],
      metricValues: [300, 0, 6, 0, 10, 0].map(cell),
    },
  ],
};

describe('dayLabel', () => {
  it('writes the UTC calendar day eBay expects in a filter', () => {
    expect(dayLabel(new Date('2026-08-03T00:00:00.000Z'))).toBe('20260803');
    expect(dayLabel(new Date('2026-01-09T23:59:59.000Z'))).toBe('20260109');
  });
});

describe('trafficMarketplaces', () => {
  /**
   * Filtering EBAY_US alone can omit traffic for listings on eBay Motors.
   */
  it('includes eBay Motors for a US store', () => {
    expect(trafficMarketplaces('EBAY_US')).toEqual(['EBAY_US', 'EBAY_MOTORS_US']);
  });

  it('falls back to the configured marketplace alone for anywhere else', () => {
    expect(trafficMarketplaces('EBAY_GB')).toEqual(['EBAY_GB']);
  });
});

describe('fetchDayTraffic', () => {
  it('sends both mandatory filters and one marketplace per request', async () => {
    const { client: c, get } = client(dayResponseFor(AUGUST_WEEK));

    await fetchDayTraffic({
      client: c,
      marketplaceId: 'EBAY_MOTORS_US',
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-07T00:00:00.000Z'),
    });

    // Both filters are mandatory; either one missing produces error 50022.
    expect(get.mock.calls[0][1].query.filter).toBe(
      'marketplace_ids:{EBAY_MOTORS_US},date_range:[20260801..20260807]'
    );
    expect(get.mock.calls[0][1].query.dimension).toBe('DAY');
  });

  it('returns store rows for the marketplace it asked about', async () => {
    const { client: c } = client(DAY_RESPONSE);

    const rows = await fetchDayTraffic({
      client: c,
      marketplaceId: 'EBAY_MOTORS_US',
      from: new Date('2026-08-03T00:00:00.000Z'),
      to: new Date('2026-08-03T00:00:00.000Z'),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      marketplaceId: 'EBAY_MOTORS_US',
      impressionsTotal: 1200,
      viewsTotal: 20,
      transactions: 2,
    });
  });

  /**
   * An incomplete `records` array can accompany a 200 status. It must not mark
   * a partially populated window complete.
   */
  it('refuses a window that came back short of the days it asked for', async () => {
    const { client: c } = client(DAY_RESPONSE);

    await expect(fetchDayTraffic({
      client: c,
      marketplaceId: 'EBAY_MOTORS_US',
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-07T00:00:00.000Z'),
    })).rejects.toBeInstanceOf(TrafficFetchError);
  });

  it('refuses an empty response outright', async () => {
    const { client: c } = client({ ...DAY_RESPONSE, records: [] });

    await expect(fetchDayTraffic({
      client: c,
      marketplaceId: 'EBAY_MOTORS_US',
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-01T00:00:00.000Z'),
    })).rejects.toThrow(/returned 0 day\(s\)/);
  });
});

describe('fetchListingTraffic', () => {
  it('asks for a single day, because a wider window is silently truncated', async () => {
    const { client: c, get } = client(LISTING_RESPONSE);

    await fetchListingTraffic({
      client: c,
      marketplaceId: 'EBAY_MOTORS_US',
      date: new Date('2026-08-03T00:00:00.000Z'),
    });

    expect(get.mock.calls[0][1].query.filter).toBe(
      'marketplace_ids:{EBAY_MOTORS_US},date_range:[20260803..20260803]'
    );
  });

  /**
   * Any one of these in the metric list makes eBay return an empty `records`
   * array with a 200 status, no error and no warning -- a per-listing traffic
   * page that is simply blank.
   */
  it('never asks for a metric that empties the response', async () => {
    const { client: c, get } = client(LISTING_RESPONSE);

    await fetchListingTraffic({
      client: c,
      marketplaceId: 'EBAY_MOTORS_US',
      date: new Date('2026-08-03T00:00:00.000Z'),
    });

    const requested = String(get.mock.calls[0][1].query.metric).split(',');
    for (const poison of LISTING_UNSUPPORTED_METRICS) {
      expect(requested).not.toContain(poison);
    }
  });

  it('stamps every row with the day that was requested', async () => {
    const { client: c } = client(LISTING_RESPONSE);

    const rows = await fetchListingTraffic({
      client: c,
      marketplaceId: 'EBAY_MOTORS_US',
      date: new Date('2026-08-03T00:00:00.000Z'),
    });

    expect(rows[0]).toMatchObject({
      date: new Date('2026-08-03T00:00:00.000Z'),
      listingId: '100000000010',
      impressionsTotal: 300,
    });
  });
});
