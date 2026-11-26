import { describe, expect, it } from 'vitest';
import { mapOrder, OrderMappingError } from './orders';

/** Shaped like a real Sell Fulfillment order, trimmed to what we map. */
function apiOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderId: '12-34567-89012',
    legacyOrderId: '987654321',
    creationDate: '2026-08-01T10:15:00.000Z',
    lastModifiedDate: '2026-08-02T11:20:00.000Z',
    orderFulfillmentStatus: 'FULFILLED',
    orderPaymentStatus: 'PAID',
    sellerId: 'seller-123',
    buyer: {
      username: 'buyer_bob',
      buyerRegistrationAddress: {
        email: 'bob@example.test',
        fullName: 'Bob Buyer',
        contactAddress: { city: 'Richmond', stateOrProvince: 'VA' },
      },
    },
    pricingSummary: {
      total: { value: '128.45', currency: 'USD' },
      priceSubtotal: { value: '110.00', currency: 'USD' },
      deliveryCost: { value: '10.00', currency: 'USD' },
      tax: { value: '8.45', currency: 'USD' },
    },
    lineItems: [
      {
        lineItemId: 'li-1',
        legacyItemId: '111222333',
        title: 'Volvo XC90 Headlight Assembly',
        sku: 'SKU-A',
        quantity: 1,
        lineItemCost: { value: '110.00', currency: 'USD' },
      },
    ],
    fulfillmentStartInstructions: [],
    fulfillmentHrefs: ['https://api.ebay.com/sell/fulfillment/v1/order/1/shipping_fulfillment/1'],
    ...overrides,
  };
}

describe('mapOrder', () => {
  it('maps the identity and status fields', () => {
    const row = mapOrder(apiOrder());

    expect(row.id).toBe('12-34567-89012');
    expect(row.legacyOrderId).toBe('987654321');
    expect(row.orderFulfillmentStatus).toBe('FULFILLED');
    expect(row.orderPaymentStatus).toBe('PAID');
    expect(row.sellerId).toBe('seller-123');
  });

  it('parses timestamps into Dates', () => {
    const row = mapOrder(apiOrder());
    expect(row.creationDate.toISOString()).toBe('2026-08-01T10:15:00.000Z');
    expect(row.lastModifiedDate.toISOString()).toBe('2026-08-02T11:20:00.000Z');
  });

  it('maps money as numbers with the currency', () => {
    const row = mapOrder(apiOrder());
    expect(row.totalAmount).toBe(128.45);
    expect(row.tax).toBe(8.45);
    expect(row.currency).toBe('USD');
  });

  describe('buyer PII', () => {
    // Names, addresses and phone numbers are not needed to show revenue and
    // fees, so the mapper does not carry them into the database.
    it('never stores the buyer email, even though the API supplies one', () => {
      const row = mapOrder(apiOrder());
      expect(row.buyerEmail).toBeNull();
    });

    it('keeps only the buyer username, which identifies an order for support', () => {
      const row = mapOrder(apiOrder());
      expect(row.buyerUsername).toBe('buyer_bob');
    });

    it('carries no name, address or phone anywhere in the mapped row', () => {
      const serialized = JSON.stringify(mapOrder(apiOrder()));
      expect(serialized).not.toContain('bob@example.test');
      expect(serialized).not.toContain('Bob Buyer');
      expect(serialized).not.toContain('Richmond');
    });

    it('drops buyer detail nested in line items too', () => {
      const row = mapOrder(
        apiOrder({
          lineItems: [
            {
              lineItemId: 'li-1',
              title: 'Part',
              quantity: 1,
              lineItemCost: { value: '10.00', currency: 'USD' },
              // Real orders carry the delivery address on the line item.
              deliveryAddress: { fullName: 'Bob Buyer', city: 'Richmond' },
            },
          ],
        })
      );

      expect(row.lineItems).not.toContain('Bob Buyer');
      expect(row.lineItems).not.toContain('Richmond');
    });
  });

  it('stores line items as JSON text with the fields the dashboard uses', () => {
    const items = JSON.parse(mapOrder(apiOrder()).lineItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      lineItemId: 'li-1',
      legacyItemId: '111222333',
      title: 'Volvo XC90 Headlight Assembly',
      sku: 'SKU-A',
      quantity: 1,
      cost: 110,
    });
  });

  it('stores the pricing summary as JSON text', () => {
    const pricing = JSON.parse(mapOrder(apiOrder()).pricingSummary);
    expect(pricing).toMatchObject({ total: 128.45, tax: 8.45, delivery: 10 });
  });

  it('defaults missing money to zero rather than NaN', () => {
    const row = mapOrder(apiOrder({ pricingSummary: {} }));
    expect(row.totalAmount).toBe(0);
    expect(row.tax).toBe(0);
    expect(Number.isNaN(row.totalAmount)).toBe(false);
  });

  it('tolerates an order with no line items', () => {
    const row = mapOrder(apiOrder({ lineItems: undefined }));
    expect(JSON.parse(row.lineItems)).toEqual([]);
  });

  it('tolerates a missing buyer block', () => {
    const row = mapOrder(apiOrder({ buyer: undefined }));
    expect(row.buyerUsername).toBeNull();
  });

  it.each([
    ['no orderId', { orderId: undefined }],
    ['no creationDate', { creationDate: undefined }],
    ['an unparseable creationDate', { creationDate: 'not-a-date' }],
  ])('rejects an order with %s', (_label, overrides) => {
    expect(() => mapOrder(apiOrder(overrides))).toThrow(OrderMappingError);
  });

  it('names the offending order id when a field is unusable', () => {
    expect(() => mapOrder(apiOrder({ creationDate: 'nope' }))).toThrow(
      /12-34567-89012/
    );
  });

  it('sets syncedAt so freshness is visible in the UI', () => {
    const at = new Date('2026-09-03T18:00:00Z');
    expect(mapOrder(apiOrder(), at).syncedAt).toEqual(at);
  });

  // eBay reports US sales tax only under the line items' collect-and-remit
  // block, never in `pricingSummary.tax`. Dropping that block left every
  // synced order with $0 tax, so the dashboard had to fall back to the CSV --
  // which does not cover orders newer than the last manual export.
  describe('collect-and-remit tax and the ad-campaign flag', () => {
    function usOrder(overrides: Record<string, unknown> = {}) {
      return apiOrder({
        // A synthetic US order: no top-level tax, tax on the line item instead.
        pricingSummary: {
          total: { value: '108.00', currency: 'USD' },
          priceSubtotal: { value: '96.00', currency: 'USD' },
          deliveryCost: { value: '12.00', currency: 'USD' },
        },
        lineItems: [
          {
            lineItemId: 'li-1',
            legacyItemId: '111222333',
            title: 'Demo audio module',
            sku: 'SKU-A',
            quantity: 1,
            lineItemCost: { value: '96.00', currency: 'USD' },
            ebayCollectAndRemitTaxes: [
              { taxType: 'STATE_SALES_TAX', amount: { value: '6.00', currency: 'USD' }, collectionMethod: 'NET' },
            ],
            properties: { buyerProtection: true, soldViaAdCampaign: true },
            itemLocation: { location: 'Example City, Example State', postalCode: '00000' },
          },
        ],
        ...overrides,
      });
    }

    it('keeps the collect-and-remit tax on the line item', () => {
      const items = JSON.parse(mapOrder(usOrder()).lineItems);
      expect(items[0].ebayCollectAndRemitTaxes).toEqual([{ amount: 6.00 }]);
    });

    it('keeps whether the sale came through an ad campaign', () => {
      const items = JSON.parse(mapOrder(usOrder()).lineItems);
      expect(items[0].soldViaAdCampaign).toBe(true);
    });

    it('marks an unpromoted sale as such rather than leaving it unknown', () => {
      const order = usOrder();
      (order.lineItems as any)[0].properties = { buyerProtection: true };
      const items = JSON.parse(mapOrder(order).lineItems);
      expect(items[0].soldViaAdCampaign).toBe(false);
    });

    it('totals the order tax from the line items when eBay sends none up top', () => {
      const row = mapOrder(usOrder());
      expect(row.tax).toBe(6.00);
      expect(JSON.parse(row.pricingSummary).tax).toBe(6.00);
    });

    it('sums collect-and-remit tax across every line item', () => {
      const order = usOrder();
      (order.lineItems as any).push({
        lineItemId: 'li-2',
        title: 'Second part',
        quantity: 1,
        lineItemCost: { value: '50.00', currency: 'USD' },
        ebayCollectAndRemitTaxes: [{ amount: { value: '2.00', currency: 'USD' } }],
      });
      expect(mapOrder(order).tax).toBe(8);
    });

    // The allow-list is the reason buyer PII cannot leak through this mapper.
    // Widening it for two money/boolean fields must not turn it into a
    // pass-through of whatever else sits on the line item.
    it('still drops the item location that sits beside them', () => {
      const row = mapOrder(usOrder());
      expect(row.lineItems).not.toContain('Example City');
      expect(row.lineItems).not.toContain('00000');
      expect(JSON.parse(row.lineItems)[0].properties).toBeUndefined();
    });

    it('leaves the top-level tax winning when eBay does send one', () => {
      // The non-US path, and the shape the older fixtures use.
      expect(mapOrder(apiOrder()).tax).toBe(8.45);
    });
  });
});
