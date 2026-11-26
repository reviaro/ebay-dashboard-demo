/**
 * Sell Fulfillment order -> `EbayOrder` row.
 *
 * Pure and synchronous, so every branch is testable without a network or a
 * database.
 *
 * **Buyer PII is deliberately dropped here.** eBay returns the buyer's email,
 * full name and contact address on every order, and the line items carry the
 * delivery address. None of it is needed to show revenue, fees or margins.
 * Data minimization reduces disclosure risk, so the mapper keeps only
 * `buyerUsername` -- enough
 * to identify an order in a support conversation -- and allow-lists the line
 * item fields rather than passing the API object through.
 *
 * `EbayOrder.buyerEmail` exists in the schema from the earlier CSV-era design.
 * It is left permanently null rather than dropped, because removing a column
 * from a populated SQLite table is a rewrite and requires migration planning.
 */

export class OrderMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderMappingError';
  }
}

export interface MappedOrder {
  id: string;
  legacyOrderId: string | null;
  creationDate: Date;
  lastModifiedDate: Date;
  orderFulfillmentStatus: string;
  orderPaymentStatus: string;
  sellerId: string | null;
  buyerUsername: string | null;
  /** Always null. See the note above. */
  buyerEmail: null;
  pricingSummary: string;
  totalAmount: number;
  currency: string;
  tax: number;
  lineItems: string;
  fulfillmentHrefs: string | null;
  syncedAt: Date;
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Money sums are added in floats; keep them at cents. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** eBay sends money as `{ value: "12.34", currency: "USD" }`. */
function amount(value: unknown): number {
  const parsed = Number(asRecord(value).value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currencyOf(value: unknown, fallback: string): string {
  return optionalString(asRecord(value).currency) ?? fallback;
}

function requiredDate(value: unknown, field: string, orderId: string): Date {
  const parsed = new Date(String(value));
  if (!(value && Number.isFinite(parsed.getTime()))) {
    throw new OrderMappingError(
      `Order ${orderId} has an unusable ${field}: ${JSON.stringify(value)}`
    );
  }
  return parsed;
}

export function mapOrder(
  raw: unknown,
  syncedAt: Date = new Date()
): MappedOrder {
  const order = asRecord(raw);

  const id = optionalString(order.orderId);
  if (!id) {
    throw new OrderMappingError('Order is missing orderId; refusing to store it.');
  }

  const pricing = asRecord(order.pricingSummary);
  const currency = currencyOf(pricing.total, 'USD');

  // Allow-list, not pass-through: a future eBay field carrying buyer detail
  // must not silently start being persisted.
  const lineItems = (Array.isArray(order.lineItems) ? order.lineItems : []).map(
    (item) => {
      const line = asRecord(item);
      // Still an allow-list, and still field-by-field: `properties` and
      // `ebayCollectAndRemitTaxes` are reduced to the one boolean and the one
      // number the dashboard needs, so nothing else eBay may add to either
      // object rides along.
      const taxes = Array.isArray(line.ebayCollectAndRemitTaxes)
        ? line.ebayCollectAndRemitTaxes.map((tax) => ({
            amount: amount(asRecord(tax).amount),
          }))
        : undefined;

      return {
        lineItemId: optionalString(line.lineItemId),
        legacyItemId: optionalString(line.legacyItemId),
        title: optionalString(line.title),
        sku: optionalString(line.sku),
        quantity: Number(line.quantity) || 0,
        cost: amount(line.lineItemCost),
        soldViaAdCampaign: asRecord(line.properties).soldViaAdCampaign === true,
        ...(taxes ? { ebayCollectAndRemitTaxes: taxes } : {}),
      };
    }
  );

  // eBay reports US sales tax per line item under collect-and-remit, and sends
  // no `pricingSummary.tax` at all on those orders -- which is why every order
  // synced before this carried $0 tax. Non-US orders use the top-level field.
  const collectAndRemitTax = lineItems.reduce(
    (sum, line) =>
      sum + (line.ebayCollectAndRemitTaxes ?? []).reduce((t, tax) => t + tax.amount, 0),
    0
  );
  const tax = collectAndRemitTax > 0 ? round2(collectAndRemitTax) : amount(pricing.tax);

  const buyer = asRecord(order.buyer);

  return {
    id,
    legacyOrderId: optionalString(order.legacyOrderId),
    creationDate: requiredDate(order.creationDate, 'creationDate', id),
    lastModifiedDate: requiredDate(
      order.lastModifiedDate ?? order.creationDate,
      'lastModifiedDate',
      id
    ),
    orderFulfillmentStatus:
      optionalString(order.orderFulfillmentStatus) ?? 'UNKNOWN',
    orderPaymentStatus: optionalString(order.orderPaymentStatus) ?? 'UNKNOWN',
    sellerId: optionalString(order.sellerId),
    buyerUsername: optionalString(buyer.username),
    buyerEmail: null,
    pricingSummary: JSON.stringify({
      total: amount(pricing.total),
      subtotal: amount(pricing.priceSubtotal),
      delivery: amount(pricing.deliveryCost),
      tax,
      currency,
    }),
    totalAmount: amount(pricing.total),
    currency,
    tax,
    lineItems: JSON.stringify(lineItems),
    fulfillmentHrefs: Array.isArray(order.fulfillmentHrefs)
      ? JSON.stringify(order.fulfillmentHrefs)
      : null,
    syncedAt,
  };
}
