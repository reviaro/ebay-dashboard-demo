import { describe, expect, it } from 'vitest';
import {
  DAY_METRICS,
  LISTING_METRICS,
  LISTING_ROW_CAP,
  LISTING_UNSUPPORTED_METRICS,
  parseTrafficReport,
  reportDay,
  toDayRows,
  toListingRows,
  TrafficReportError,
} from './traffic-report';

const metric = (key: string) => ({ localizedName: key, key, dataType: 'NUMBER' });
const value = (v: number) => ({ value: v, applicable: true });

/**
 * Synthetic DAY response, including the detail that matters: eBay
 * returns the metrics in its own canonical order, not the requested one.
 */
const DAY_RESPONSE = {
  header: {
    dimensionKeys: [{ localizedName: 'Day', key: 'DAY', dataType: 'DATE' }],
    metrics: [
      metric('LISTING_IMPRESSION_SEARCH_RESULTS_PAGE'),
      metric('LISTING_IMPRESSION_STORE'),
      metric('LISTING_IMPRESSION_TOTAL'),
      metric('LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE'),
      metric('LISTING_VIEWS_SOURCE_STORE'),
      metric('LISTING_VIEWS_SOURCE_DIRECT'),
      metric('LISTING_VIEWS_SOURCE_OTHER_EBAY'),
      metric('LISTING_VIEWS_SOURCE_OFF_EBAY'),
      metric('LISTING_VIEWS_TOTAL'),
      metric('TRANSACTION'),
    ],
  },
  records: [
    {
      dimensionValues: [{ value: '20260803', applicable: true }],
      metricValues: [1200, 0, 1200, 12, 0, 4, 1, 3, 20, 2].map(value),
    },
  ],
  warnings: [],
  startDate: '2026-08-01T07:00:00.000Z',
  endDate: '2026-08-08T06:59:59.000Z',
  lastUpdatedDate: '2026-09-01T12:00:00.000Z',
};

const LISTING_RESPONSE = {
  header: {
    dimensionKeys: [{ localizedName: 'Listing id', key: 'LISTING', dataType: 'STRING' }],
    metrics: [
      metric('LISTING_IMPRESSION_SEARCH_RESULTS_PAGE'),
      metric('LISTING_IMPRESSION_STORE'),
      metric('LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE'),
      metric('LISTING_VIEWS_SOURCE_STORE'),
      metric('LISTING_VIEWS_TOTAL'),
      metric('TRANSACTION'),
    ],
  },
  records: [
    {
      dimensionValues: [{ value: '100000000010', applicable: true }],
      metricValues: [300, 0, 6, 0, 10, 0].map(value),
    },
    {
      dimensionValues: [{ value: '100000000011', applicable: true }],
      metricValues: [80, 5, 2, 1, 3, 1].map(value),
    },
  ],
  dimensionMetadata: [
    {
      metadataHeader: {
        key: 'LISTING_ID',
        metadataKeys: [{ localizedName: 'Listing title', key: 'LISTING_TITLE', dataType: 'STRING' }],
      },
      metadataRecords: [
        {
          // eBay sends the id here as a NUMBER while dimensionValues are strings.
          value: { value: 100000000011, applicable: true },
          metadataValues: [{ value: 'Demo replacement switch', applicable: true }],
        },
      ],
    },
  ],
  warnings: [],
  startDate: '2026-08-03T07:00:00.000Z',
  endDate: '2026-08-04T06:59:59.000Z',
  lastUpdatedDate: '2026-09-01T12:05:00.000Z',
};

describe('parseTrafficReport', () => {
  it('maps metrics by header key, not by the order they were requested', () => {
    const parsed = parseTrafficReport(DAY_RESPONSE, 'DAY');

    // Requested order puts TRANSACTION first; eBay returns it ninth. Reading
    // positionally would report 2 impressions and 1200 transactions.
    expect(parsed.rows[0].metrics.LISTING_IMPRESSION_TOTAL).toBe(1200);
    expect(parsed.rows[0].metrics.TRANSACTION).toBe(2);
    expect(parsed.rows[0].metrics.LISTING_VIEWS_TOTAL).toBe(20);
  });

  /**
   * The trap that produces plausible wrong data rather than an error: eBay
   * accepts `dimension=LISTING,DAY`, echoes BOTH keys in the header, and then
   * groups by the first one only. A caller trusting the header would read a
   * listing id as a date.
   */
  it('refuses a response whose header claims a dimension that was not requested', () => {
    const twoDimensions = {
      ...LISTING_RESPONSE,
      header: {
        ...LISTING_RESPONSE.header,
        dimensionKeys: [
          { localizedName: 'Listing id', key: 'LISTING', dataType: 'STRING' },
          { localizedName: 'Day', key: 'DAY', dataType: 'DATE' },
        ],
      },
    };

    expect(() => parseTrafficReport(twoDimensions, 'LISTING')).toThrow(TrafficReportError);
    expect(() => parseTrafficReport(twoDimensions, 'LISTING')).toThrow(/LISTING, DAY/);
  });

  it('refuses a response grouped by a different dimension than the one asked for', () => {
    expect(() => parseTrafficReport(DAY_RESPONSE, 'LISTING')).toThrow(TrafficReportError);
  });

  it('reads the titles eBay attaches, matching ids across its number/string split', () => {
    const parsed = parseTrafficReport(LISTING_RESPONSE, 'LISTING');

    expect(parsed.titles.get('100000000011')).toBe('Demo replacement switch');
    expect(parsed.titles.has('100000000010')).toBe(false);
  });

  it('reports the settling stamp and an untruncated page', () => {
    const parsed = parseTrafficReport(LISTING_RESPONSE, 'LISTING');

    expect(parsed.reportUpdatedAt?.toISOString()).toBe('2026-09-01T12:05:00.000Z');
    expect(parsed.truncated).toBe(false);
  });

  /**
   * `limit` and `offset` are ignored by this endpoint, so a full page is not a
   * page — it is everything eBay will ever show for that day.
   */
  it('flags a LISTING page that came back at eBay’s row cap', () => {
    const full = {
      ...LISTING_RESPONSE,
      records: Array.from({ length: LISTING_ROW_CAP }, (_, i) => ({
        dimensionValues: [{ value: `1000000000${String(i).padStart(2, '0')}`, applicable: true }],
        metricValues: [1, 0, 0, 0, 0, 0].map(value),
      })),
    };

    expect(parseTrafficReport(full, 'LISTING').truncated).toBe(true);
  });

  it('treats a metric eBay marks not applicable as zero', () => {
    const withGap = {
      ...DAY_RESPONSE,
      records: [
        {
          dimensionValues: [{ value: '20260803', applicable: true }],
          metricValues: DAY_RESPONSE.records[0].metricValues.map((m, i) =>
            i === 9 ? { value: null, applicable: false } : m
          ),
        },
      ],
    };

    expect(parseTrafficReport(withGap, 'DAY').rows[0].metrics.TRANSACTION).toBe(0);
  });

  it('rejects a response that dropped a metric instead of defaulting it to zero', () => {
    const short = {
      ...DAY_RESPONSE,
      header: { ...DAY_RESPONSE.header, metrics: DAY_RESPONSE.header.metrics.slice(0, 3) },
      records: [
        {
          dimensionValues: [{ value: '20260803', applicable: true }],
          metricValues: [1200, 0, 1200].map(value),
        },
      ],
    };

    expect(() => toDayRows(parseTrafficReport(short, 'DAY'), 'EBAY_MOTORS_US')).toThrow(
      /did not include LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE/
    );
  });
});

describe('reportDay', () => {
  it('reads eBay’s day label as UTC midnight, the way uploaded CSV dates are stored', () => {
    expect(reportDay('20260803').toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });

  it('refuses anything that is not a day label', () => {
    expect(() => reportDay('2026-08-03')).toThrow(TrafficReportError);
    expect(() => reportDay('20261303')).toThrow(TrafficReportError);
  });
});

describe('toDayRows', () => {
  it('builds one store row per day, oldest first', () => {
    const twoDays = {
      ...DAY_RESPONSE,
      // eBay orders records by metric value, not by date.
      records: [
        DAY_RESPONSE.records[0],
        {
          dimensionValues: [{ value: '20260801', applicable: true }],
          metricValues: [10, 0, 10, 1, 0, 0, 0, 0, 1, 0].map(value),
        },
      ],
    };

    const rows = toDayRows(parseTrafficReport(twoDays, 'DAY'), 'EBAY_MOTORS_US');

    expect(rows.map((r) => r.date.toISOString())).toEqual([
      '2026-08-01T00:00:00.000Z',
      '2026-08-03T00:00:00.000Z',
    ]);
    expect(rows[1]).toMatchObject({
      marketplaceId: 'EBAY_MOTORS_US',
      impressionsSearch: 1200,
      impressionsStore: 0,
      impressionsTotal: 1200,
      viewsSearch: 12,
      viewsStore: 0,
      viewsDirect: 4,
      viewsOtherEbay: 1,
      viewsOffEbay: 3,
      viewsTotal: 20,
      transactions: 2,
    });
    expect(rows[1].reportUpdatedAt?.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });
});

describe('toListingRows', () => {
  it('stamps the day the request asked for, since the rows carry only listing ids', () => {
    const rows = toListingRows(
      parseTrafficReport(LISTING_RESPONSE, 'LISTING'),
      'EBAY_MOTORS_US',
      reportDay('20260803')
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: new Date('2026-08-03T00:00:00.000Z'),
      marketplaceId: 'EBAY_MOTORS_US',
      listingId: '100000000010',
      title: null,
      impressionsSearch: 300,
      impressionsStore: 0,
      viewsSearch: 6,
      viewsTotal: 10,
      transactions: 0,
      truncated: false,
    });
    expect(rows[1].title).toBe('Demo replacement switch');
  });

  /** eBay does not serve LISTING_IMPRESSION_TOTAL per listing; it is the sum. */
  it('sums the impression total eBay withholds at this dimension', () => {
    const rows = toListingRows(
      parseTrafficReport(LISTING_RESPONSE, 'LISTING'),
      'EBAY_MOTORS_US',
      reportDay('20260803')
    );

    expect(rows[1].impressionsSearch).toBe(80);
    expect(rows[1].impressionsStore).toBe(5);
    expect(rows[1].impressionsTotal).toBe(85);
  });
});

describe('metric lists', () => {
  /**
   * Each of these returns ZERO records at dimension=LISTING -- no error, no
   * warning -- and one of them in the list empties the whole response. That is
   * how a per-listing traffic page would come back blank with nothing visibly
   * broken, so the exclusion is asserted rather than only commented.
   */
  it('keeps the metrics eBay silently refuses per listing out of the LISTING request', () => {
    for (const poison of LISTING_UNSUPPORTED_METRICS) {
      expect(LISTING_METRICS).not.toContain(poison);
    }
    expect(LISTING_UNSUPPORTED_METRICS).toContain('LISTING_IMPRESSION_TOTAL');
  });

  it('asks the DAY dimension for every metric it does serve', () => {
    for (const poison of LISTING_UNSUPPORTED_METRICS) {
      expect(DAY_METRICS).toContain(poison);
    }
  });
});
