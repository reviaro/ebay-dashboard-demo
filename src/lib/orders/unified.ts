/**
 * One order list from two sources.
 *
 * CSV exports (`Sale`) can preserve historical orders. The Sell Fulfillment
 * API (`EbayOrder`) only reaches back 90 days,
 * but is authoritative for everything it covers. Neither table alone is the
 * order history, so this module merges them at read time rather than writing
 * one into the other. The CSV stays the historical/fallback path, and nothing
 * here is destructive or needs a migration.
 *
 * The join key is `Sale.orderNumber == EbayOrder.id`.
 *
 * Precedence: the API wins on money, status, dates, and identity; the CSV
 * supplies only what the API payload does not carry -- `brand` and the ship-to
 * fields, which the mapper deliberately drops as buyer PII.
 */

import { extractMakeFromTitle } from '@/lib/csv-parser';

/** The `Sale` columns this merge reads. */
export interface SaleRow {
  id: number;
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

/** The `EbayOrder` columns this merge reads. JSON columns arrive as text. */
export interface EbayOrderRow {
  id: string;
  creationDate: Date;
  orderFulfillmentStatus: string;
  orderPaymentStatus: string;
  pricingSummary: string;
  lineItems: string;
}

export interface UnifiedOrder {
  /** Stable identity for React keys: the order number, or `sale:<id>`. */
  key: string;
  /** Which source supplied the money fields. */
  source: 'api' | 'csv';
  orderNumber: string | null;
  saleDate: Date;
  itemTitle: string;
  brand: string;
  itemNumber: string | null;
  soldFor: number;
  shipping: number;
  eBayTax: number;
  totalPrice: number;
  quantity: number;
  lineItemCount: number;
  promoted: boolean;
  shipToState: string | null;
  shipToCountry: string | null;
  /** Null on CSV-only rows: the export carries no status. */
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  refunded: boolean;
}

const PACIFIC_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The calendar day eBay would report an order on.
 *
 * eBay cuts seller reports in Pacific time. Formatting into that zone and
 * re-parsing the Y-M-D is what makes this DST-correct -- subtracting a fixed
 * offset would put 17 of the overlapping orders on the wrong day, and some of
 * those land in a different month.
 */
export function ebayReportDate(creationDate: Date): Date {
  return new Date(`${PACIFIC_DAY.format(creationDate)}T00:00:00.000Z`);
}

/** Money arrives as decimal strings; keep sums off float noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * eBay money is `{ value: "12.34" }`; the current mapper flattens it to a bare
 * number. Both appear in the stored JSON, so both are read here.
 */
function amount(money: unknown): number {
  if (typeof money === 'number') return money;
  const value = (money as { value?: string } | undefined)?.value;
  return value === undefined ? 0 : Number(value);
}

interface LineItem {
  legacyItemId?: string;
  title?: string;
  quantity?: number;
  /** Nested form written by the legacy integration. */
  lineItemCost?: { value?: string };
  /** Flat form, written by the current mapper. */
  cost?: number;
  /** `amount` is `{ value }` in the old payload, a bare number in the new one. */
  ebayCollectAndRemitTaxes?: { amount?: { value?: string } | number }[];
  /** Nested form, written by the removed integration. */
  properties?: { soldViaAdCampaign?: boolean };
  /** Flat form, written by the current mapper. */
  soldViaAdCampaign?: boolean;
}

interface Pricing {
  subtotal: number;
  delivery: number;
  /** Null when the payload carries no usable tax figure. */
  tax: number | null;
}

/**
 * `EbayOrder.pricingSummary` holds two generations of JSON.
 *
 * Legacy rows store eBay's own nested shape. Everything the current mapper
 * writes is flattened to `{ total, subtotal, delivery, tax, currency }`.
 * Reading only one shape silently values the other at $0 and understates
 * revenue when both generations are present.
 *
 * Detection is structural rather than by `syncedAt`, and an unrecognised
 * payload throws: a silent zero is indistinguishable from a genuinely free
 * order.
 */
function parsePricing(json: string, orderId: string): Pricing {
  const pricing = JSON.parse(json) as Record<string, unknown>;

  if (pricing.priceSubtotal !== undefined) {
    return {
      subtotal: amount(pricing.priceSubtotal),
      delivery: amount(pricing.deliveryCost),
      // The nested form keeps tax on the line items, not here.
      tax: null,
    };
  }

  if (typeof pricing.subtotal === 'number') {
    return {
      subtotal: pricing.subtotal,
      delivery: typeof pricing.delivery === 'number' ? pricing.delivery : 0,
      // eBay reports US sales tax under the line items' collect-and-remit
      // block, so this is 0 on every order the current mapper has written.
      tax: typeof pricing.tax === 'number' && pricing.tax > 0 ? pricing.tax : null,
    };
  }

  throw new Error(
    `Unrecognised pricing summary on order ${orderId}: ${Object.keys(pricing).join(', ') || '(empty)'}`,
  );
}

function fromApi(order: EbayOrderRow, csv: SaleRow | undefined): UnifiedOrder {
  const pricing = parsePricing(order.pricingSummary, order.id);
  const lineItems = JSON.parse(order.lineItems) as LineItem[];

  const soldFor = round2(pricing.subtotal);
  const shipping = round2(pricing.delivery);

  // Two fields the current mapper's allow-list drops: collect-and-remit tax
  // and the ad-campaign flag. Where the payload has them the API wins; where
  // it does not, the CSV fills in -- the same rule that governs brand and
  // ship-to. Extending the mapper would let the API supply both again.
  const taxedItems = lineItems.filter(item => Array.isArray(item.ebayCollectAndRemitTaxes));
  const apiTax = taxedItems.length
    ? round2(taxedItems.reduce(
        (sum, item) => sum + item.ebayCollectAndRemitTaxes!.reduce((t, tax) => t + amount(tax.amount), 0),
        0,
      ))
    : pricing.tax;
  const eBayTax = apiTax ?? csv?.eBayTax ?? 0;

  const flaggedItems = lineItems.filter(
    item => typeof item.soldViaAdCampaign === 'boolean' || item.properties !== undefined,
  );
  const apiPromoted = flaggedItems.length
    ? flaggedItems.some(
        item => item.soldViaAdCampaign === true || item.properties?.soldViaAdCampaign === true,
      )
    : null;

  const title = lineItems[0]?.title ?? csv?.itemTitle ?? '';

  return {
    key: order.id,
    source: 'api',
    orderNumber: order.id,
    saleDate: ebayReportDate(order.creationDate),
    itemTitle: title,
    brand: csv?.brand?.trim() || extractMakeFromTitle(title),
    itemNumber: lineItems[0]?.legacyItemId ?? csv?.itemNumber ?? null,
    soldFor,
    shipping,
    eBayTax,
    // Not `pricingSummary.total` -- that excludes collect-and-remit tax, so
    // using it as the order total would quietly cut reported revenue.
    totalPrice: round2(soldFor + shipping + eBayTax),
    quantity: lineItems.reduce((sum, item) => sum + (item.quantity ?? 0), 0),
    lineItemCount: lineItems.length,
    promoted: apiPromoted ?? csv?.promoted ?? false,
    shipToState: csv?.shipToState ?? null,
    shipToCountry: csv?.shipToCountry ?? null,
    paymentStatus: order.orderPaymentStatus,
    fulfillmentStatus: order.orderFulfillmentStatus,
    refunded: order.orderPaymentStatus !== 'PAID',
  };
}

function fromCsv(sale: SaleRow): UnifiedOrder {
  return {
    // Some rows have no order number; keying those on the row id keeps them from
    // collapsing into a single bucket.
    key: sale.orderNumber || `sale:${sale.id}`,
    source: 'csv',
    orderNumber: sale.orderNumber || null,
    saleDate: sale.saleDate,
    itemTitle: sale.itemTitle,
    brand: sale.brand,
    itemNumber: sale.itemNumber,
    soldFor: sale.soldFor,
    shipping: sale.shipping,
    eBayTax: sale.eBayTax,
    totalPrice: sale.totalPrice,
    quantity: sale.quantity,
    lineItemCount: 1,
    promoted: sale.promoted,
    shipToState: sale.shipToState,
    shipToCountry: sale.shipToCountry,
    paymentStatus: null,
    fulfillmentStatus: null,
    refunded: false,
  };
}

/**
 * Merge CSV sales and API orders into one list, newest first.
 *
 * Every row from both sources appears exactly once. Where an order exists on
 * both sides the API row wins and absorbs the CSV's brand and ship-to.
 */
export function mergeOrders(sales: SaleRow[], orders: EbayOrderRow[]): UnifiedOrder[] {
  const csvByOrderNumber = new Map<string, SaleRow>();
  for (const sale of sales) {
    if (sale.orderNumber) csvByOrderNumber.set(sale.orderNumber, sale);
  }

  const merged = orders.map(order => fromApi(order, csvByOrderNumber.get(order.id)));
  const claimed = new Set(orders.map(order => order.id));

  for (const sale of sales) {
    if (sale.orderNumber && claimed.has(sale.orderNumber)) continue;
    merged.push(fromCsv(sale));
  }

  return merged.sort((a, b) => b.saleDate.getTime() - a.saleDate.getTime());
}

export interface OrderFilter {
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  /** Keep the empty-title / zero-value rows the dashboard normally hides. */
  includeJunk?: boolean;
}

/**
 * The filter the `Sale` queries used to express in SQL.
 *
 * It moves into JS because the merged list has no table to query: an API
 * order's date is derived from its Pacific calendar day, so it cannot be
 * filtered by a `WHERE` clause on `creationDate`. The merged set is filtered
 * in memory.
 */
export function filterOrders(rows: UnifiedOrder[], filter: OrderFilter): UnifiedOrder[] {
  // SQLite's LIKE is case-insensitive for ASCII, so the search behaves the
  // same way it did as a Prisma `contains`.
  const search = filter.search?.trim().toLowerCase();

  return rows.filter(row => {
    if (!filter.includeJunk && (row.soldFor <= 0 || row.itemTitle === '')) return false;
    if (filter.dateFrom && row.saleDate.getTime() < filter.dateFrom.getTime()) return false;
    if (filter.dateTo && row.saleDate.getTime() > filter.dateTo.getTime()) return false;
    if (!search) return true;

    return (
      row.itemTitle.toLowerCase().includes(search) ||
      (row.orderNumber ?? '').toLowerCase().includes(search) ||
      row.brand.toLowerCase().includes(search)
    );
  });
}
