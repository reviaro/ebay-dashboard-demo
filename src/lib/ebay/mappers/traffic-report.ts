/**
 * Sell Analytics `traffic_report` -> traffic rows.
 *
 * The response is a small spreadsheet: a header naming the dimension and the
 * metrics, then records of positional values. Four response-shape caveats
 * need explicit handling because each can fail quietly:
 *
 *   1. **Metrics come back in eBay's order, not the requested one.** Requesting
 *      `TRANSACTION,LISTING_IMPRESSION_TOTAL` returns impressions first. Every
 *      value here is mapped through `header.metrics[].key`.
 *   2. **`dimension` takes ONE value, but the header echoes whatever you sent.**
 *      `dimension=LISTING,DAY` returns listing-keyed rows with a header claiming
 *      both keys; `DAY,LISTING` returns day-keyed rows with the same header.
 *      So there is no listing x day request, and a caller
 *      trusting the header reads a listing id as a date. `parseTrafficReport`
 *      refuses any response whose header does not name exactly the dimension
 *      that was asked for.
 *   3. **Some metrics return zero records at `dimension=LISTING`** -- no error,
 *      no warning -- and a single one of them empties the entire response. They
 *      are listed in `LISTING_UNSUPPORTED_METRICS` and kept out of
 *      `LISTING_METRICS`, with a test asserting the exclusion.
 *   4. **A LISTING request is capped at 200 rows** and ignores `limit`/`offset`,
 *      so a full page means "eBay stopped", not "ask for the next one". Only a
 *      single-day window minimizes truncation risk; a full day can still be
 *      incomplete when it reaches the cap.
 *
 * Rates are deliberately not read. eBay publishes CLICK_THROUGH_RATE and
 * SALES_CONVERSION_RATE as fractions rounded to two decimals, which cannot
 * preserve enough precision for reliable reporting. The counts are exact, so
 * rates are computed from them at read
 * time -- which is also the only correct way to aggregate a rate across days.
 */

export class TrafficReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrafficReportError';
  }
}

export type TrafficDimension = 'DAY' | 'LISTING';

/** Metrics served by the DAY dimension. */
export const DAY_METRICS = [
  'LISTING_IMPRESSION_SEARCH_RESULTS_PAGE',
  'LISTING_IMPRESSION_STORE',
  'LISTING_IMPRESSION_TOTAL',
  'LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE',
  'LISTING_VIEWS_SOURCE_STORE',
  'LISTING_VIEWS_SOURCE_DIRECT',
  'LISTING_VIEWS_SOURCE_OTHER_EBAY',
  'LISTING_VIEWS_SOURCE_OFF_EBAY',
  'LISTING_VIEWS_TOTAL',
  'TRANSACTION',
] as const;

/**
 * Metrics that return an empty `records` array at `dimension=LISTING`, with an
 * empty `warnings` array and a 200 status. Including any one of them empties
 * the whole response, so they must never be added to `LISTING_METRICS`.
 */
export const LISTING_UNSUPPORTED_METRICS = [
  'LISTING_IMPRESSION_TOTAL',
  'LISTING_VIEWS_SOURCE_DIRECT',
  'LISTING_VIEWS_SOURCE_OTHER_EBAY',
  'LISTING_VIEWS_SOURCE_OFF_EBAY',
] as const;

/** What is left, and all of it verified to return rows per listing. */
export const LISTING_METRICS = [
  'LISTING_IMPRESSION_SEARCH_RESULTS_PAGE',
  'LISTING_IMPRESSION_STORE',
  'LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE',
  'LISTING_VIEWS_SOURCE_STORE',
  'LISTING_VIEWS_TOTAL',
  'TRANSACTION',
] as const;

/** eBay stops a LISTING response here and offers no way past it. */
export const LISTING_ROW_CAP = 200;

export interface TrafficRow {
  /** The dimension value: a day label for DAY, a listing id for LISTING. */
  key: string;
  metrics: Record<string, number>;
}

export interface ParsedTrafficReport {
  dimension: TrafficDimension;
  rows: TrafficRow[];
  /** Listing id -> title, for the rows eBay chose to annotate. */
  titles: Map<string, string>;
  /** eBay's "data current as of" stamp, absent on an empty response. */
  reportUpdatedAt: Date | null;
  /** True when the response came back at `LISTING_ROW_CAP`. */
  truncated: boolean;
}

export interface TrafficDayRow {
  date: Date;
  marketplaceId: string;
  impressionsSearch: number;
  impressionsStore: number;
  impressionsTotal: number;
  viewsSearch: number;
  viewsStore: number;
  viewsDirect: number;
  viewsOtherEbay: number;
  viewsOffEbay: number;
  viewsTotal: number;
  transactions: number;
  reportUpdatedAt: Date | null;
}

export interface TrafficListingRow {
  date: Date;
  marketplaceId: string;
  listingId: string;
  title: string | null;
  impressionsSearch: number;
  impressionsStore: number;
  impressionsTotal: number;
  viewsSearch: number;
  viewsStore: number;
  viewsTotal: number;
  transactions: number;
  truncated: boolean;
}

interface RawValue {
  value?: unknown;
  applicable?: boolean;
}

interface RawRecord {
  dimensionValues?: RawValue[];
  metricValues?: RawValue[];
}

interface RawResponse {
  header?: {
    dimensionKeys?: { key?: string }[];
    metrics?: { key?: string }[];
  };
  records?: RawRecord[];
  dimensionMetadata?: {
    metadataRecords?: { value?: RawValue; metadataValues?: RawValue[] }[];
  }[];
  lastUpdatedDate?: string;
}

const DAY_LABEL = /^(\d{4})(\d{2})(\d{2})$/;

/**
 * eBay's day label -> the date it names, at UTC midnight.
 *
 * The label is a calendar day in the marketplace's reporting timezone -- the
 * response's own `startDate` is 07:00Z, i.e. Pacific midnight -- so it is a
 * date, not an instant, and reconstructing an instant from it would be a lie
 * about an hour that does not exist in the data. UTC midnight is also what the
 * CSV upload path writes, so API days and uploaded snapshots line up.
 */
export function reportDay(label: string): Date {
  const match = DAY_LABEL.exec(label);
  if (!match) {
    throw new TrafficReportError(`"${label}" is not an eBay day label (YYYYMMDD).`);
  }

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  // Rejects 20261303 and 20260231, which Date.UTC would roll over instead.
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    throw new TrafficReportError(`"${label}" is not a real date.`);
  }

  return date;
}

/** A value eBay marks not applicable is absent data, which counts as zero. */
function numberOf(cell: RawValue | undefined): number {
  if (!cell || cell.applicable === false) return 0;
  const value = Number(cell.value);
  return Number.isFinite(value) ? value : 0;
}

export function parseTrafficReport(
  response: unknown,
  expected: TrafficDimension
): ParsedTrafficReport {
  const raw = (response ?? {}) as RawResponse;
  const keys = (raw.header?.dimensionKeys ?? []).map((d) => d.key ?? '?');

  // See note 2: the header is echoed from the request, so this is the only
  // place a mismatch can be caught before values are read into the wrong column.
  if (keys.length !== 1 || keys[0] !== expected) {
    throw new TrafficReportError(
      `Asked for the ${expected} dimension and got a report grouped by ${keys.join(', ') || 'nothing'}. ` +
        `eBay groups by the first dimension only, whatever the header claims.`
    );
  }

  const metricKeys = (raw.header?.metrics ?? []).map((m) => m.key ?? '');
  const records = raw.records ?? [];

  const rows: TrafficRow[] = records.map((record) => {
    const metrics: Record<string, number> = {};
    metricKeys.forEach((key, index) => {
      if (key) metrics[key] = numberOf(record.metricValues?.[index]);
    });

    return { key: String(record.dimensionValues?.[0]?.value ?? ''), metrics };
  });

  const titles = new Map<string, string>();
  for (const block of raw.dimensionMetadata ?? []) {
    for (const entry of block.metadataRecords ?? []) {
      // The id arrives as a number here and as a string in `dimensionValues`.
      const id = entry.value?.value;
      const title = entry.metadataValues?.[0]?.value;
      if (id !== undefined && id !== null && typeof title === 'string' && title) {
        titles.set(String(id), title);
      }
    }
  }

  return {
    dimension: expected,
    rows,
    titles,
    reportUpdatedAt: raw.lastUpdatedDate ? new Date(raw.lastUpdatedDate) : null,
    truncated: expected === 'LISTING' && records.length >= LISTING_ROW_CAP,
  };
}

/**
 * Reads one metric, refusing to substitute a zero for a metric eBay did not
 * return at all. A missing column and a genuine zero look identical once
 * stored, and this integration has already been bitten by data that read as
 * plausible rather than as broken.
 */
function required(row: TrafficRow, key: string): number {
  const value = row.metrics[key];
  if (value === undefined) {
    throw new TrafficReportError(`The report did not include ${key}.`);
  }
  return value;
}

const byDate = (a: { date: Date }, b: { date: Date }) => a.date.getTime() - b.date.getTime();

/**
 * Store-wide rows, oldest first.
 *
 * eBay orders records by metric value rather than by date -- a 90-day response
 * opened on 20260609 and ended on 20260704 -- so anything charting them in
 * arrival order draws nonsense. Sorting here means no caller has to know that.
 */
export function toDayRows(parsed: ParsedTrafficReport, marketplaceId: string): TrafficDayRow[] {
  if (parsed.dimension !== 'DAY') {
    throw new TrafficReportError(`toDayRows needs a DAY report, got ${parsed.dimension}.`);
  }

  return parsed.rows
    .map((row) => ({
      date: reportDay(row.key),
      marketplaceId,
      impressionsSearch: required(row, 'LISTING_IMPRESSION_SEARCH_RESULTS_PAGE'),
      impressionsStore: required(row, 'LISTING_IMPRESSION_STORE'),
      impressionsTotal: required(row, 'LISTING_IMPRESSION_TOTAL'),
      viewsSearch: required(row, 'LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE'),
      viewsStore: required(row, 'LISTING_VIEWS_SOURCE_STORE'),
      viewsDirect: required(row, 'LISTING_VIEWS_SOURCE_DIRECT'),
      viewsOtherEbay: required(row, 'LISTING_VIEWS_SOURCE_OTHER_EBAY'),
      viewsOffEbay: required(row, 'LISTING_VIEWS_SOURCE_OFF_EBAY'),
      viewsTotal: required(row, 'LISTING_VIEWS_TOTAL'),
      transactions: required(row, 'TRANSACTION'),
      reportUpdatedAt: parsed.reportUpdatedAt,
    }))
    .sort(byDate);
}

/**
 * Per-listing rows for one day.
 *
 * The day is passed in rather than read from the response: a LISTING report
 * carries listing ids and nothing else, so the only thing that makes these
 * rows daily is that the request asked for a single day.
 */
export function toListingRows(
  parsed: ParsedTrafficReport,
  marketplaceId: string,
  date: Date
): TrafficListingRow[] {
  if (parsed.dimension !== 'LISTING') {
    throw new TrafficReportError(`toListingRows needs a LISTING report, got ${parsed.dimension}.`);
  }

  return parsed.rows.map((row) => {
    const impressionsSearch = required(row, 'LISTING_IMPRESSION_SEARCH_RESULTS_PAGE');
    const impressionsStore = required(row, 'LISTING_IMPRESSION_STORE');

    return {
      date,
      marketplaceId,
      listingId: row.key,
      title: parsed.titles.get(row.key) ?? null,
      impressionsSearch,
      impressionsStore,
      // LISTING_IMPRESSION_TOTAL is one of the metrics eBay refuses at this
      // dimension. On the DAY dimension, where it is served, it equalled
      // search + store.
      impressionsTotal: impressionsSearch + impressionsStore,
      viewsSearch: required(row, 'LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE'),
      viewsStore: required(row, 'LISTING_VIEWS_SOURCE_STORE'),
      viewsTotal: required(row, 'LISTING_VIEWS_TOTAL'),
      transactions: required(row, 'TRANSACTION'),
      truncated: parsed.truncated,
    };
  });
}
