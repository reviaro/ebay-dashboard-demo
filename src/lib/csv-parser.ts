import Papa from 'papaparse';
import { normalizeBrand, matchBrandWord } from './brand-normalizer';

const parseNumber = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text || text === '--') return 0;
  const negative = /^\(.*\)$/.test(text);
  const parsed = Number(text.replace(/[$,%()\s]/g, '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0;
};

const parseReportDate = (value: unknown) => {
  const date = new Date(String(value ?? '').trim());
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid report date: ${value}`);
  return date;
};

const parseReportWithHeader = (csvContent: string, marker: string) => {
  const lines = csvContent.replace(/^\uFEFF/, '').split(/\r?\n/);
  // eBay varies column casing between report versions; match the marker
  // trim + case-insensitively so a re-cased header row is still found.
  const needle = marker.trim().toLowerCase();
  const headerIndex = lines.findIndex(line => line.toLowerCase().includes(needle));
  if (headerIndex < 0) throw new Error(`Could not find ${marker} header`);
  const result = Papa.parse<Record<string, string>>(lines.slice(headerIndex).join('\n'), {
    header: true,
    skipEmptyLines: true,
  });
  if (result.errors.length) throw new Error(result.errors[0].message);
  return result.data;
};

export interface TransactionReportRecord {
  transactionDate: Date; type: string; orderNumber: string | null; itemId: string | null;
  transactionId: string | null; itemTitle: string | null; quantity: number; itemSubtotal: number;
  shipping: number; tax: number; finalValueFeeFixed: number; finalValueFeeVariable: number;
  regulatoryFee: number; veryHighInadFee: number; belowStandardFee: number; internationalFee: number; otherFee: number; grossAmount: number;
  netAmount: number; currency: string; description: string | null;
}

export function parseTransactionReport(csvContent: string): TransactionReportRecord[] {
  return parseReportWithHeader(csvContent, 'Transaction creation date').map(row => ({
    transactionDate: parseReportDate(row['Transaction creation date']),
    type: row['Type']?.trim() || 'Unknown',
    orderNumber: row['Order number'] && row['Order number'] !== '--' ? row['Order number'] : null,
    itemId: row['Item ID'] && row['Item ID'] !== '--' ? String(row['Item ID']) : null,
    transactionId: row['Transaction ID'] && row['Transaction ID'] !== '--' ? String(row['Transaction ID']) : null,
    itemTitle: row['Item title'] && row['Item title'] !== '--' ? row['Item title'] : null,
    quantity: Math.trunc(parseNumber(row['Quantity'])),
    itemSubtotal: parseNumber(row['Item subtotal']),
    shipping: parseNumber(row['Shipping and handling']),
    tax: parseNumber(row['eBay collected tax']) + parseNumber(row['Seller collected tax']),
    finalValueFeeFixed: parseNumber(row['Final Value Fee - fixed']),
    finalValueFeeVariable: parseNumber(row['Final Value Fee - variable']),
    regulatoryFee: parseNumber(row['Regulatory operating fee']),
    veryHighInadFee: parseNumber(row['Very high "item not as described" fee']),
    belowStandardFee: parseNumber(row['Below standard performance fee']),
    internationalFee: parseNumber(row['International fee']),
    otherFee: row['Type'] === 'Other fee' ? parseNumber(row['Net amount']) : 0,
    grossAmount: parseNumber(row['Gross transaction amount']),
    netAmount: parseNumber(row['Net amount']),
    currency: row['Payout currency'] || row['Transaction currency'] || 'USD',
    description: row['Description'] && row['Description'] !== '--' ? row['Description'].trim() : null,
  }));
}

export interface PromotedListingRecord {
  reportStart: Date; reportEnd: Date; campaignName: string; campaignId: string; campaignStatus: string | null;
  itemId: string; title: string; price: number; quantityAvailable: number; promotedImpressions: number;
  promotedClicks: number; promotedSoldQuantity: number; organicSoldQuantity: number; totalSoldQuantity: number;
  conversionRate: number; contributionRate: number; attributedSales: number; adFees: number; roas: number;
  organicClicks: number; organicImpressions: number;
}

export function parsePromotedListingReport(csvContent: string): PromotedListingRecord[] {
  let rawRows: Record<string, string>[];
  try {
    rawRows = parseReportWithHeader(csvContent, 'Campaign name');
  } catch (error) {
    // A file that is not a Promoted Listings report (no recognizable header
    // row) yields nothing rather than throwing — the /api/upload route turns
    // an empty result into a 400 with a "wrong report" message.
    if (error instanceof Error && error.message.includes('Could not find')) return [];
    throw error;
  }

  // eBay renames these columns between report versions. Look each field up by a
  // trim + lowercase key, trying the current long Seller-Hub string first and
  // then the shorter alias people also see. `pick` mirrors the COGS CSV import.
  const lowerKeyed = (row: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key.trim().toLowerCase()] = typeof value === 'string' ? value : String(value ?? '');
    }
    return out;
  };
  const pick = (row: Record<string, string>, ...names: string[]): string => {
    for (const name of names) {
      const value = row[name.trim().toLowerCase()];
      if (value != null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };

  return rawRows
    .map(lowerKeyed)
    .filter(row => pick(row, 'Item ID'))
    .map(row => ({
      reportStart: parseReportDate(pick(row, 'Start date')),
      reportEnd: parseReportDate(pick(row, 'End date')),
      campaignName: pick(row, 'Campaign name') || 'Unnamed campaign',
      campaignId: pick(row, 'Campaign ID'),
      campaignStatus: pick(row, 'Status') || null,
      itemId: pick(row, 'Item ID'),
      title: pick(row, 'Title') || 'Untitled listing',
      price: parseNumber(pick(row, 'Price (Current or Last Price)')),
      quantityAvailable: Math.trunc(parseNumber(pick(row, 'Quantity available'))),
      promotedImpressions: Math.trunc(parseNumber(pick(row, 'Promoted Listings Impressions (via eBay Placements)', 'Impressions'))),
      promotedClicks: Math.trunc(parseNumber(pick(row, 'Total Promoted Listings Clicks', 'Clicks'))),
      promotedSoldQuantity: Math.trunc(parseNumber(pick(row, 'Total Promoted Listings Sold quantity', 'Promoted Listings Sold quantity', 'Sold quantity'))),
      organicSoldQuantity: Math.trunc(parseNumber(pick(row, 'Organic Sold Quantity'))),
      totalSoldQuantity: Math.trunc(parseNumber(pick(row, 'Total Quantity Sold'))),
      conversionRate: parseNumber(pick(row, 'Promoted Listings Conversion rate (Promoted Listings Sold quantity/Promoted Listings Clicks)')),
      contributionRate: parseNumber(pick(row, 'Promoted Listings Contribution (Promoted Listings Sold quantity/Total Quantity Sold)')),
      attributedSales: parseNumber(pick(row, 'Total Promoted Listings Sales (in billing currency)', 'Sales')),
      adFees: parseNumber(pick(row, 'Ad fees (in billing currency)', 'Ad fees')),
      roas: parseNumber(pick(row, 'Return on Ad spend (Sales/Ad fees)')),
      organicClicks: Math.trunc(parseNumber(pick(row, 'Organic Clicks'))),
      organicImpressions: Math.trunc(parseNumber(pick(row, 'Organic Impressions'))),
    }));
}

// Real eBay "Paid & Shipped" CSV fields
export interface EBaySalesReportRow {
  'Sales Record Number': string;
  'Item Number': string;
  'Item Title': string;
  'Sold For': string;
  'Shipping And Handling': string;
  'Total Price': string;
  'Ship To Country': string;
  'Buyer Country': string;
  'Sale Date': string;
  'Quantity': string;
  [key: string]: any;
}

export interface ActiveListingRow {
  itemId: string;
  title: string;
  sku: string;
  price: number;
  quantity: number;
  soldQuantity: number;
  views: number;
  watchers: number;
}

export interface TrafficReportRow {
  itemId: string;
  title?: string;
  impressions: number;
  pageViews: number;
  ctr: number;
  salesConversionRate: number;
}

export interface EBayReportData {
  type: 'sales' | 'active' | 'traffic';
  rows: any[];
}

const HEADER_MAPS = {
  active: {
    'Item number': 'itemId',
    'Title': 'title',
    'Custom label (SKU)': 'sku',
    // eBay uses "Current price" (fixed price) or "Start price" as fallback
    'Current price': 'price',
    'Start price': 'price_fallback',
    'Available quantity': 'quantity',
    'Sold quantity': 'soldQuantity',
    'Watchers': 'watchers',
  },
  traffic: {
    'eBay item ID': 'itemId',
    'Listing title': 'title',
    'Total impressions': 'impressions',
    'Click-through rate = Page views from eBay site/Total impressions': 'ctr',
    'Total page views': 'pageViews',
    'Sales conversion rate = Quantity sold/Total page views': 'salesConversionRate',
  }
};

export function extractMakeFromTitle(title: string): string {
  if (!title) return 'Unknown';
  // Titles are typically: "1998-01 Dodge RAM ..." or "2008-2012 Ford Escape ..."
  // Strip leading year range (e.g., "2008-2012 " or "00-03 ")
  const withoutYear = title.replace(/^\d{2,4}[-–]\d{2,4}\s+/, '').trim();
  const words = withoutYear.split(/\s+/);
  for (const word of words) {
    const match = matchBrandWord(word);
    if (match) return match;
  }
  // Fallback: first word, but only if it looks like a plausible brand name
  // (rejects emoji, bare numbers, and other junk that polluted brand stats)
  const fallback = words[0] || '';
  if (!/^[A-Za-z][A-Za-z'-]+$/.test(fallback)) return 'Unknown';
  return normalizeBrand(fallback);
}

export interface SaleRecord {
  recordNumber: number | null;
  orderNumber: string | null;
  saleDate: Date;
  itemTitle: string;
  brand: string;
  itemNumber: string | null;
  soldFor: number;
  shipping: number;
  eBayTax: number;
  totalPrice: number;
  shipToState: string | null;
  shipToCountry: string | null;
  promoted: boolean;
  quantity: number;
}

export function parseSnapshotDateFromFilename(filename: string): Date | null {
  const toUtcDate = (year: string, month: string, day: string) => {
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const isoMatch = filename.match(/(20\d{2})[-_](\d{2})[-_](\d{2})(?!\d)/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = toUtcDate(year, month, day);
    if (date) return date;
  }

  const monthMatch = filename.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*-(\d{1,2})-(20\d{2})/i);
  if (!monthMatch) return null;
  const [, month, day, year] = monthMatch;
  const parsed = new Date(`${month} ${day}, ${year} UTC`);
  return Number.isNaN(parsed.getTime()) ? null : new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function getColumnValue(row: Record<string, unknown>, ...aliases: string[]): string {
  const normalize = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const normalizedAliases = aliases.map(normalize);
  const matchedValues = Object.entries(row)
    .filter(([key]) => normalizedAliases.includes(normalize(key)))
    .map(([, value]) => String(value ?? '').trim());
  return matchedValues.find(Boolean) || '';
}

function parseSaleDate(dateStr: string): Date {
  if (!dateStr) throw new Error('Sale row is missing a sale date');
  // eBay format: "Dec-31-25" or "Dec-31-2025"
  const match = dateStr.match(/([A-Za-z]+)-(\d+)-(\d+)/);
  if (match) {
    const [, month, day, year] = match;
    const fullYear = year.length === 2 ? (parseInt(year) > 50 ? 1900 + parseInt(year) : 2000 + parseInt(year)) : parseInt(year);
    const d = new Date(`${month} ${day}, ${fullYear}`);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) throw new Error(`Invalid sale date: ${dateStr}`);
  return d;
}

export function salesSourceKey(sale: Pick<SaleRecord, 'recordNumber' | 'orderNumber' | 'itemNumber' | 'itemTitle' | 'saleDate'>): string {
  const identity = sale.orderNumber || `record-${sale.recordNumber ?? 'unknown'}`;
  const item = sale.itemNumber || sale.itemTitle.trim().toLowerCase();
  return `sale-v2:${identity}:${item}`;
}

export function parseSalesRows(rows: any[]): SaleRecord[] {
  const parseMoney = (v: any) => parseFloat((v || '').toString().replace(/[^0-9.]/g, '')) || 0;
  return rows
    .filter(row => {
      if (!getColumnValue(row, 'Sales Record Number', 'Order Number', 'Item Number')) return false;
      return Boolean(getColumnValue(row, 'Sale Date', 'Paid On Date', 'Shipped On Date'));
    })
    .map(row => ({
      recordNumber: parseInt(getColumnValue(row, 'Sales Record Number')) || null,
      orderNumber: getColumnValue(row, 'Order Number') || null,
      saleDate: parseSaleDate(getColumnValue(row, 'Sale Date', 'Paid On Date', 'Shipped On Date')),
      itemTitle: row['Item Title'] || '',
      brand: normalizeBrand(row['Brand'] || extractMakeFromTitle(row['Item Title'] || '')),
      itemNumber: row['Item Number'] ? String(row['Item Number']) : null,
      soldFor: parseMoney(row['Sold For']),
      shipping: parseMoney(row['Shipping And Handling']),
      eBayTax: parseMoney(row['eBay Collected Tax']),
      totalPrice: parseMoney(row['Total Price']),
      shipToState: row['Ship To State'] || null,
      shipToCountry: row['Ship To Country'] || null,
      promoted: (row['Sold Via Promoted Listings'] || '').toLowerCase() === 'yes',
      quantity: parseInt(row['Quantity']) || 1,
    }));
}

export const parseEBayCSV = (csvContent: string, typeHint?: string): Promise<EBayReportData> => {
  return new Promise((resolve, reject) => {
    // eBay reports often have store metadata rows above the real header row.
    // Scan the first 20 lines for a row containing known header keywords and
    // strip everything above it so Papa Parse picks the right header row.
    const HEADER_MARKERS = ['Sales Record Number', 'Item number', 'Listing ID', 'Sold For', 'eBay item ID', 'Listing title'];
    const rawLines = csvContent.split('\n');
    let headerLineIndex = 0;
    for (let i = 0; i < Math.min(rawLines.length, 20); i++) {
      if (HEADER_MARKERS.some(marker => rawLines[i].includes(marker))) {
        headerLineIndex = i;
        break;
      }
    }
    const trimmedContent = rawLines.slice(headerLineIndex).join('\n');

    Papa.parse(trimmedContent, {
      header: true,
      skipEmptyLines: true,
      delimiter: '', // auto-detect (handles both CSV and TSV exports)
      complete: (results) => {
        const headers = results.meta.fields || [];

        // Respect explicit type hint from the user's UI selection
        const isActive = typeHint === 'active' || (headers.includes('Item number') && (headers.includes('Available quantity') || headers.includes('Views')));
        const isTraffic = typeHint === 'traffic' || (headers.includes('eBay item ID') && headers.includes('Total impressions'));

        if (isActive && !isTraffic) {
          const rows = results.data.map((row: any) => {
            const parsePrice = (v: any) => parseFloat((v || '').replace(/[^0-9.]/g, '')) || 0;
            const normalized: any = {
              itemId: String(row['Item number'] || '').trim(),
              title: row['Title'] || '',
              sku: row['Custom label (SKU)'] || null,
              // "Current price" for fixed listings; fall back to "Start price"
              price: parsePrice(row['Current price'] || row['Start price']),
              quantity: parseInt(row['Available quantity']) || 0,
              soldQuantity: parseInt(row['Sold quantity']) || 0,
              views: 0, // not included in active listings export
              watchers: parseInt(row['Watchers']) || 0,
            };
            return normalized as ActiveListingRow;
          });
          resolve({ type: 'active', rows });

        } else if (isTraffic) {
          // Strip Excel formula prefix from item IDs: ="12345" → "12345"
          const cleanId = (v: any) => String(v || '').replace(/^=?"?/, '').replace(/"$/, '').trim();

          const rows = results.data.map((row: any) => {
            const normalized: any = {};
            Object.entries(HEADER_MAPS.traffic).forEach(([csvHeader, apiKey]) => {
              let value = row[csvHeader];
              if (apiKey === 'itemId') {
                value = cleanId(value);
              } else if (['impressions', 'pageViews'].includes(apiKey)) {
                value = parseInt(value?.replace ? value.replace(/,/g, '') : value) || 0;
              } else if (['ctr', 'salesConversionRate'].includes(apiKey)) {
                value = parseFloat(String(value || '').replace('%', '')) || 0;
              }
              normalized[apiKey] = value;
            });
            return normalized as TrafficReportRow;
          });
          resolve({ type: 'traffic', rows });

        } else {
          // Sales report (eBay Paid & Shipped CSV)
          resolve({ type: 'sales', rows: results.data });
        }
      },
      error: (error: Error) => {
        reject(error);
      },
    });
  });
};

export const calculateMetrics = (data: EBaySalesReportRow[]) => {
  const EXCHANGE_RATES = {
    CAD: 0.74,
    GBP: 1.27,
  };

  const normalizeToUSD = (row: EBaySalesReportRow) => {
    // Real eBay CSV uses "Sold For" field
    const salePriceStr = row['Sold For'] || row['Sale price'] || '0';
    const country = row['Ship To Country'] || row['Ship to country'] || 'United States';

    const rowExchangeRate = row['Exchange rate'] ? parseFloat(row['Exchange rate']) : null;

    const price = typeof salePriceStr === 'string'
      ? parseFloat(salePriceStr.replace(/[^0-9.]/g, ''))
      : (salePriceStr || 0);

    if (rowExchangeRate) {
      return price * rowExchangeRate;
    }

    if (typeof salePriceStr === 'string') {
      if (salePriceStr.includes('C $') || country === 'Canada') {
        return price * EXCHANGE_RATES.CAD;
      }
      if (salePriceStr.includes('£') || country === 'United Kingdom') {
        return price * EXCHANGE_RATES.GBP;
      }
    }

    return price;
  };

  const totalRevenue = data.reduce((sum, row) => sum + normalizeToUSD(row), 0);
  const salesCount = data.length;

  const totalCost = data.reduce((sum, row) => {
    const normalizedSalePrice = normalizeToUSD(row);
    const cost = row['Cost']
      ? (typeof row['Cost'] === 'string' ? parseFloat(row['Cost'].replace(/[^0-9.]/g, '')) : row['Cost'])
      : normalizedSalePrice * 0.2;
    return sum + (cost || 0);
  }, 0);

  const averageSalePrice = salesCount > 0 ? totalRevenue / salesCount : 0;

  // Use "Ship To Country" (real eBay field) with fallback to old field name
  const intlSales = data.filter(row => {
    const country = row['Ship To Country'] || row['Ship to country'] || 'United States';
    return country && country !== 'United States';
  });
  const intlSalesCount = intlSales.length;
  const internationalRate = salesCount > 0 ? (intlSalesCount / salesCount) * 100 : 0;

  const canadaSalesCount = data.filter(row => {
    const country = row['Ship To Country'] || row['Ship to country'] || '';
    return country === 'Canada';
  }).length;

  const ukSalesCount = data.filter(row => {
    const country = row['Ship To Country'] || row['Ship to country'] || '';
    return country === 'United Kingdom';
  }).length;

  const targetRegionRate = salesCount > 0 ? ((canadaSalesCount + ukSalesCount) / salesCount) * 100 : 0;

  // Extract brand/make from Item Title (real eBay CSV has no Brand field)
  const brands: Record<string, number> = {};
  data.forEach(row => {
    const brand = normalizeBrand(row['Brand'] || extractMakeFromTitle(row['Item Title'] || ''));
    brands[brand] = (brands[brand] || 0) + 1;
  });
  const topBrand = Object.entries(brands).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

  return {
    revenue: totalRevenue,
    salesCount,
    averageSalePrice,
    cost: totalCost,
    internationalRate,
    targetRegionRate,
    canadaSalesCount,
    ukSalesCount,
    topBrand,
  };
};
