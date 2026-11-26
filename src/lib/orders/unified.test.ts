import { describe, expect, it } from 'vitest';
import { ebayReportDate, filterOrders, mergeOrders, type EbayOrderRow, type SaleRow } from './unified';

// All orders, identifiers, dates, and amounts below are synthetic fixtures.

/** A CSV-derived Sale row, shaped like the Prisma model. */
function sale(overrides: Partial<SaleRow> = {}): SaleRow {
  return {
    id: 1,
    orderNumber: '12-34567-89012',
    saleDate: new Date('2024-03-27T00:00:00.000Z'),
    itemTitle: 'Volvo Demo Headlight Assembly',
    brand: 'Volvo',
    itemNumber: '111222333',
    soldFor: 100,
    shipping: 12,
    eBayTax: 7,
    totalPrice: 119,
    shipToState: 'VA',
    shipToCountry: 'United States',
    promoted: false,
    quantity: 1,
    ...overrides,
  };
}

/** An API-derived EbayOrder row; JSON columns are stored as text. */
function order(overrides: Partial<EbayOrderRow> = {}): EbayOrderRow {
  return {
    id: '12-34567-89012',
    creationDate: new Date('2024-03-27T18:00:00.000Z'),
    orderFulfillmentStatus: 'FULFILLED',
    orderPaymentStatus: 'PAID',
    pricingSummary: JSON.stringify({
      priceSubtotal: { value: '100.00', currency: 'USD' },
      deliveryCost: { value: '12.00', currency: 'USD' },
      total: { value: '112.00', currency: 'USD' },
    }),
    lineItems: JSON.stringify([lineItem()]),
    ...overrides,
  };
}

function lineItem(overrides: Record<string, unknown> = {}) {
  return {
    lineItemId: 'li-1',
    legacyItemId: '111222333',
    title: 'Volvo Demo Headlight Assembly',
    quantity: 1,
    lineItemCost: { value: '100.00', currency: 'USD' },
    ebayCollectAndRemitTaxes: [{ taxType: 'STATE_SALES_TAX', amount: { value: '7.00', currency: 'USD' } }],
    properties: { soldViaAdCampaign: false },
    ...overrides,
  };
}

describe('ebayReportDate', () => {
  // Seller reports use Pacific calendar dates. Interpreting these as UTC
  // dates can move orders across day or month boundaries in the rollup.
  it('keeps the Pacific calendar day for an order created late in UTC', () => {
    // 2024-03-28 01:30 UTC is 2024-03-27 18:30 PDT.
    expect(ebayReportDate(new Date('2024-03-28T01:30:00.000Z')).toISOString())
      .toBe('2024-03-27T00:00:00.000Z');
  });

  it('handles standard time as well as daylight time', () => {
    // 2024-01-15 03:00 UTC is 2024-01-14 19:00 PST.
    expect(ebayReportDate(new Date('2024-01-15T03:00:00.000Z')).toISOString())
      .toBe('2024-01-14T00:00:00.000Z');
  });

  it('leaves a midday order on its own day', () => {
    expect(ebayReportDate(new Date('2024-03-27T18:00:00.000Z')).toISOString())
      .toBe('2024-03-27T00:00:00.000Z');
  });
});

describe('mergeOrders', () => {
  describe('an order present in both sources', () => {
    it('takes the money from the API, whose totals reconcile', () => {
      // A CSV total can be incomplete; the API subtotal, delivery, and tax
      // provide the full amount in this synthetic reconciliation fixture.
      const [row] = mergeOrders(
        [sale({ soldFor: 100, shipping: 12, eBayTax: 7, totalPrice: 9 })],
        [order()],
      );

      expect(row.soldFor).toBe(100);
      expect(row.shipping).toBe(12);
      expect(row.eBayTax).toBe(7);
      expect(row.totalPrice).toBe(119);
      expect(row.source).toBe('api');
    });

    it('takes the tax the API reports as collected and remitted', () => {
      const [row] = mergeOrders(
        [sale({ eBayTax: 10 })],
        [order({ lineItems: JSON.stringify([lineItem({
          ebayCollectAndRemitTaxes: [{ taxType: 'STATE_SALES_TAX', amount: { value: '11.20', currency: 'USD' } }],
        })]) })],
      );

      expect(row.eBayTax).toBe(11.2);
    });

    it('keeps the brand and ship-to that only the CSV carries', () => {
      const [row] = mergeOrders([sale({ brand: 'Volvo', shipToState: 'VA' })], [order()]);

      expect(row.brand).toBe('Volvo');
      expect(row.shipToState).toBe('VA');
      expect(row.shipToCountry).toBe('United States');
    });

    it('dates the order by its Pacific calendar day', () => {
      const [row] = mergeOrders(
        [sale({ saleDate: new Date('2024-03-27T00:00:00.000Z') })],
        [order({ creationDate: new Date('2024-03-28T01:30:00.000Z') })],
      );

      expect(row.saleDate.toISOString()).toBe('2024-03-27T00:00:00.000Z');
    });

    it('emits one row, not one per source', () => {
      expect(mergeOrders([sale()], [order()])).toHaveLength(1);
    });
  });

  describe('an order the API truncated in the CSV export', () => {
    // This synthetic order has two line items, while its CSV row contains
    // only one. The API supplies the complete subtotal and quantity.
    it('sums every line item rather than trusting the CSV row', () => {
      const [row] = mergeOrders(
        [sale({ soldFor: 100, quantity: 1 })],
        [order({
          pricingSummary: JSON.stringify({
            priceSubtotal: { value: '250.00', currency: 'USD' },
            deliveryCost: { value: '12.00', currency: 'USD' },
            total: { value: '262.00', currency: 'USD' },
          }),
          lineItems: JSON.stringify([
            lineItem({ quantity: 1 }),
            lineItem({ lineItemId: 'li-2', title: 'Volvo Demo Radio', quantity: 1, lineItemCost: { value: '150.00', currency: 'USD' } }),
          ]),
        })],
      );

      expect(row.soldFor).toBe(250);
      expect(row.quantity).toBe(2);
      expect(row.lineItemCount).toBe(2);
    });
  });

  describe('a refunded order', () => {
    it('carries the payment status through instead of dropping the order', () => {
      const [row] = mergeOrders([], [order({ orderPaymentStatus: 'FULLY_REFUNDED' })]);

      expect(row.paymentStatus).toBe('FULLY_REFUNDED');
      expect(row.refunded).toBe(true);
      expect(row.soldFor).toBe(100);
    });

    it('does not mark a paid order as refunded', () => {
      const [row] = mergeOrders([], [order()]);
      expect(row.refunded).toBe(false);
    });
  });

  describe('an order only the API has', () => {
    it('derives the brand from the listing title', () => {
      const [row] = mergeOrders([], [order()]);

      expect(row.source).toBe('api');
      expect(row.brand).toBe('Volvo');
    });

    it('has no ship-to, because the API payload carries no buyer address', () => {
      const [row] = mergeOrders([], [order()]);

      expect(row.shipToState).toBeNull();
      expect(row.shipToCountry).toBeNull();
    });

    it('takes promoted from the ad-campaign flag on the line item', () => {
      const [row] = mergeOrders([], [order({
        lineItems: JSON.stringify([lineItem({ properties: { soldViaAdCampaign: true } })]),
      })]);

      expect(row.promoted).toBe(true);
    });
  });

  describe('an order only the CSV has', () => {
    it('passes the row through untouched', () => {
      const [row] = mergeOrders([sale({ orderNumber: '99-00000-00000' })], []);

      expect(row.source).toBe('csv');
      expect(row.soldFor).toBe(100);
      expect(row.totalPrice).toBe(119);
      expect(row.paymentStatus).toBeNull();
    });
  });

  describe('CSV rows with no order number', () => {
    // Rows with a null or empty orderNumber must stay separate rather than
    // collapsing into a single merge bucket.
    it('keeps every unkeyable row rather than collapsing them together', () => {
      const rows = mergeOrders(
        [
          sale({ id: 1, orderNumber: null, soldFor: 10 }),
          sale({ id: 2, orderNumber: null, soldFor: 20 }),
          sale({ id: 3, orderNumber: '', soldFor: 30 }),
        ],
        [],
      );

      expect(rows).toHaveLength(3);
      expect(rows.map(r => r.soldFor).sort((a, b) => a - b)).toEqual([10, 20, 30]);
    });
  });

  it('returns the newest order first', () => {
    const rows = mergeOrders(
      [
        sale({ id: 1, orderNumber: 'a', saleDate: new Date('2024-01-01T00:00:00.000Z') }),
        sale({ id: 2, orderNumber: 'b', saleDate: new Date('2024-03-01T00:00:00.000Z') }),
      ],
      [],
    );

    expect(rows.map(r => r.orderNumber)).toEqual(['b', 'a']);
  });
});

describe('filterOrders', () => {
  const rows = mergeOrders(
    [
      sale({ id: 1, orderNumber: 'a', itemTitle: 'Volvo Demo Headlight', brand: 'Volvo', saleDate: new Date('2024-01-10T00:00:00.000Z'), soldFor: 100 }),
      sale({ id: 2, orderNumber: 'b', itemTitle: 'Subaru Demo Amplifier', brand: 'Subaru', saleDate: new Date('2024-02-10T00:00:00.000Z'), soldFor: 200 }),
      sale({ id: 3, orderNumber: 'c', itemTitle: '', brand: 'Ford', saleDate: new Date('2024-02-11T00:00:00.000Z'), soldFor: 50 }),
      sale({ id: 4, orderNumber: 'd', itemTitle: 'Ford Demo Mirror', brand: 'Ford', saleDate: new Date('2024-02-12T00:00:00.000Z'), soldFor: 0 }),
    ],
    [],
  );

  it('drops the empty-title and zero-value rows the dashboard treats as junk', () => {
    expect(filterOrders(rows, {}).map(r => r.orderNumber)).toEqual(['b', 'a']);
  });

  it('matches a search against the title, order number and brand', () => {
    expect(filterOrders(rows, { search: 'volvo' }).map(r => r.orderNumber)).toEqual(['a']);
    expect(filterOrders(rows, { search: 'Amplifier' }).map(r => r.orderNumber)).toEqual(['b']);
    expect(filterOrders(rows, { search: 'b' }).map(r => r.orderNumber)).toEqual(['b']);
  });

  it('is case-insensitive, matching the SQL LIKE it replaces', () => {
    expect(filterOrders(rows, { search: 'SUBARU' }).map(r => r.orderNumber)).toEqual(['b']);
  });

  it('keeps only rows inside the date range, end date inclusive', () => {
    const within = filterOrders(rows, {
      dateFrom: new Date('2024-02-01T00:00:00.000Z'),
      dateTo: new Date('2024-02-10T23:59:59.999Z'),
    });
    expect(within.map(r => r.orderNumber)).toEqual(['b']);
  });
});

// Stored orders can contain nested or flattened JSON payloads. These
// synthetic fixtures cover both shapes, including flattened line items
// that omit tax and ad-campaign fields. An unreadable pricing shape must
// never silently become a zero-value order.
describe('mergeOrders across both stored payload shapes', () => {
  /** What the current mapper writes. */
  function currentShapeOrder(overrides: Partial<EbayOrderRow> = {}): EbayOrderRow {
    return {
      id: '90-10000-00002',
      creationDate: new Date('2024-06-12T18:00:00.000Z'),
      orderFulfillmentStatus: 'FULFILLED',
      orderPaymentStatus: 'PAID',
      pricingSummary: JSON.stringify({ total: 86, subtotal: 80, delivery: 6, tax: 0, currency: 'USD' }),
      lineItems: JSON.stringify([
        { lineItemId: '90000000000002', legacyItemId: '900000000104', title: 'Mercedes Demo Selector', sku: null, quantity: 1, cost: 80 },
      ]),
      ...overrides,
    };
  }

  it('reads money from the flattened summary the current mapper writes', () => {
    const [row] = mergeOrders([], [currentShapeOrder()]);

    expect(row.soldFor).toBe(80);
    expect(row.shipping).toBe(6);
  });

  it('reads the trimmed line item, which carries cost as a bare number', () => {
    const [row] = mergeOrders([], [currentShapeOrder()]);

    expect(row.quantity).toBe(1);
    expect(row.itemNumber).toBe('900000000104');
    expect(row.itemTitle).toBe('Mercedes Demo Selector');
  });

  // The current payload carries no collect-and-remit tax and no ad-campaign
  // flag, so the CSV -- which has both -- supplies them. Same precedence rule
  // as brand and ship-to: the CSV fills only what the API does not carry.
  it('falls back to the CSV for tax the current payload omits', () => {
    const [row] = mergeOrders(
      [sale({ orderNumber: '90-10000-00002', eBayTax: 4, soldFor: 80 })],
      [currentShapeOrder()],
    );

    expect(row.eBayTax).toBe(4);
    expect(row.totalPrice).toBe(90);
  });

  it('falls back to the CSV for the promoted flag the current payload omits', () => {
    const [row] = mergeOrders(
      [sale({ orderNumber: '90-10000-00002', promoted: true })],
      [currentShapeOrder()],
    );

    expect(row.promoted).toBe(true);
  });

  it('still prefers the API tax when the legacy payload actually carries one', () => {
    const [row] = mergeOrders([sale({ eBayTax: 10 })], [order()]);
    expect(row.eBayTax).toBe(7);
  });

  it('reports no tax for an API-only order the current payload cannot price', () => {
    const [row] = mergeOrders([], [currentShapeOrder()]);
    expect(row.eBayTax).toBe(0);
    expect(row.promoted).toBe(false);
  });

  // An unreadable payload must fail explicitly so that it cannot be confused
  // with a valid zero-value subtotal.
  it('refuses an unrecognised payload rather than valuing it at zero', () => {
    expect(() =>
      mergeOrders([], [order({ pricingSummary: JSON.stringify({ grandTotal: '99.00' }) })]),
    ).toThrow(/pricing/i);
  });

  // What the mapper writes once its allow-list keeps tax and the ad flag:
  // the flattened pricing summary, plus both fields on the trimmed line item.
  function repairedShapeOrder(overrides: Partial<EbayOrderRow> = {}): EbayOrderRow {
    return {
      id: '90-10000-00002',
      creationDate: new Date('2024-06-12T18:00:00.000Z'),
      orderFulfillmentStatus: 'FULFILLED',
      orderPaymentStatus: 'PAID',
      pricingSummary: JSON.stringify({ total: 86, subtotal: 80, delivery: 6, tax: 4, currency: 'USD' }),
      lineItems: JSON.stringify([
        {
          lineItemId: '90000000000002', legacyItemId: '900000000104',
          title: 'Mercedes Demo Selector', sku: null, quantity: 1, cost: 80,
          soldViaAdCampaign: true,
          ebayCollectAndRemitTaxes: [{ amount: 4 }],
        },
      ]),
      ...overrides,
    };
  }

  it('takes tax from a re-synced order rather than the CSV', () => {
    const [row] = mergeOrders(
      [sale({ orderNumber: '90-10000-00002', eBayTax: 99 })],
      [repairedShapeOrder()],
    );

    expect(row.eBayTax).toBe(4);
    expect(row.totalPrice).toBe(90);
  });

  it('takes the ad-campaign flag from a re-synced order rather than the CSV', () => {
    const [row] = mergeOrders(
      [sale({ orderNumber: '90-10000-00002', promoted: false })],
      [repairedShapeOrder()],
    );

    expect(row.promoted).toBe(true);
  });

  it('trusts an explicit false from a re-synced order over the CSV', () => {
    const [row] = mergeOrders(
      [sale({ orderNumber: '90-10000-00002', promoted: true })],
      [repairedShapeOrder({
        lineItems: JSON.stringify([{ legacyItemId: '1', title: 'Part', quantity: 1, cost: 80, soldViaAdCampaign: false }]),
      })],
    );

    expect(row.promoted).toBe(false);
  });

  it('prices an API-only re-synced order with its own tax', () => {
    const [row] = mergeOrders([], [repairedShapeOrder()]);

    expect(row.soldFor).toBe(80);
    expect(row.eBayTax).toBe(4);
    expect(row.promoted).toBe(true);
  });
});
