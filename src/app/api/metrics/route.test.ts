vi.mock('@/lib/stores/route', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/stores/route')>(),
  withStore: (await import('@/test/store-fixture')).withUnitStore,
}));
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import prisma from '@/lib/prisma';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  default: {
    sale: {
      findMany: vi.fn(),
    },
    ebayOrder: {
      findMany: vi.fn(),
    },
    ebayFinanceTransaction: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    ebayTrafficDay: {
      findMany: vi.fn(),
    },
    performanceMetric: {
      deleteMany: vi.fn(),
    },
    inventory: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    ebayOffer: {
      count: vi.fn(),
    },
  },
}));

// One EbayTrafficDay row — the store-wide daily counts the route now reads.
const tday = (
  date: string,
  o: { impressionsTotal?: number; viewsTotal?: number; transactions?: number } = {}
) => ({
  date: new Date(date),
  impressionsTotal: o.impressionsTotal ?? 0,
  viewsTotal: o.viewsTotal ?? 0,
  transactions: o.transactions ?? 0,
});

const sale = (overrides: Record<string, any> = {}) => ({
  id: 1,
  orderNumber: null,
  saleDate: new Date('2026-05-01T12:00:00Z'),
  soldFor: 100,
  shipping: 10,
  eBayTax: 5,
  totalPrice: 115,
  brand: 'Volvo',
  itemTitle: 'Volvo Part',
  itemNumber: '1',
  shipToState: 'VA',
  shipToCountry: 'United States',
  promoted: false,
  quantity: 1,
  ...overrides,
});

describe('GET /api/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.sale.findMany as any).mockResolvedValue([]);
    (prisma.ebayOrder.findMany as any).mockResolvedValue([]);
    (prisma.ebayFinanceTransaction.findMany as any).mockResolvedValue([]);
    (prisma.ebayFinanceTransaction.findFirst as any).mockResolvedValue(null);
    (prisma.ebayTrafficDay.findMany as any).mockResolvedValue([]);
    (prisma.inventory.aggregate as any).mockResolvedValue({
      _count: { id: 0 },
      _sum: { price: null },
    });
    (prisma.inventory.groupBy as any).mockResolvedValue([]);
    (prisma.inventory.findMany as any).mockResolvedValue([]);
    (prisma.ebayOffer.count as any).mockResolvedValue(0);
  });

  // One EbayFinanceTransaction row — the real money data the route now reads
  // through loadFinanceSummary for every headline figure.
  const finSale = (over: Record<string, any> = {}) => ({
    transactionType: 'SALE',
    transactionDate: new Date('2026-08-05T00:00:00Z'),
    amount: '90.00',
    feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '10.00' }]),
    orderId: 'o1',
    ...over,
  });
  const finRefund = (over: Record<string, any> = {}) => ({
    transactionType: 'REFUND',
    transactionDate: new Date('2026-08-06T00:00:00Z'),
    amount: '15.00',
    feeDetails: null,
    orderId: 'o1',
    ...over,
  });

  it('headline revenue is finance gross, with real net/fees/refunds and no cost', async () => {
    (prisma.ebayFinanceTransaction.findMany as any).mockResolvedValue([finSale(), finRefund()]);

    const data = await (await GET(new Request('http://localhost/api/metrics'))).json();

    expect(data.metrics.revenue).toBe(100); // 90 proceeds + 10 fees
    expect(data.metrics.ebayFees).toBe(10);
    expect(data.metrics.refunds).toBe(15);
    expect(data.metrics.netRevenue).toBe(75); // 90 proceeds - 15 refunds
    expect(data.metrics.cost).toBeUndefined();
    // byMonth is a straight passthrough of FinanceSummary.byMonth (Task 8 reads
    // the fee split off it) — guard the shape, not just that it's an array.
    expect(data.metrics.byMonth).toEqual([
      { month: '2026-08', grossRevenue: 100, ebayFees: 10, refunds: 15, netRevenue: 75, finalValueFee: 10, perOrderFee: 0, otherFee: 0 },
    ]);
  });

  it('profitPerBrand is real per-brand finance figures, not a flat percentage', async () => {
    (prisma.ebayFinanceTransaction.findMany as any).mockResolvedValue([
      finSale({ orderId: 'o1', amount: '90.00', feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '10.00' }]) }),
      finSale({ orderId: 'o2', amount: '60.00', feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '5.00' }]) }),
    ]);
    (prisma.sale.findMany as any).mockResolvedValue([
      sale({ orderNumber: 'o1', brand: 'VW', itemNumber: 'a' }),
      sale({ orderNumber: 'o2', brand: 'Volkswagen', itemNumber: 'b' }), // alias -> normalizeBrand merges
    ]);

    const data = await (await GET(new Request('http://localhost/api/metrics'))).json();

    const vw = data.metrics.profitPerBrand.find((b: any) => b.brand === 'Volkswagen');
    expect(vw).toMatchObject({ grossRevenue: 165, ebayFees: 15, netRevenue: 150, units: 2 });
    expect(vw.profit).toBeUndefined();
    expect(vw.cost).toBeUndefined();
    expect(data.metrics.profitPerBrand.filter((b: any) => /volkswagen|^vw$/i.test(b.brand))).toHaveLength(1);
  });

  it('raises a fee/refund-drag flag when net is under 75% of gross', async () => {
    (prisma.ebayFinanceTransaction.findMany as any).mockResolvedValue([
      finSale({ amount: '100.00', feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '20.00' }]) }),
      finRefund({ amount: '20.00' }),
    ]); // gross 120, net 80 -> 66.7%

    const data = await (await GET(new Request('http://localhost/api/metrics'))).json();

    expect(data.metrics.redFlags.some((f: any) => f.type === 'FEE_REFUND_DRAG')).toBe(true);
  });

  it('still returns zeros for the money fields when there is no finance data', async () => {
    const data = await (await GET(new Request('http://localhost/api/metrics'))).json();

    expect(data.metrics).toMatchObject({ revenue: 0, netRevenue: 0, ebayFees: 0, refunds: 0 });
    expect(data.metrics.profitPerBrand).toEqual([]);
    expect(data.metrics.redFlags).toEqual([]);
  });

  it('aggregates order and item counts from Sale rows', async () => {
    (prisma.sale.findMany as any).mockResolvedValue([
      sale({ soldFor: 100, itemNumber: '1' }),
      sale({ soldFor: 200, itemNumber: '2', quantity: 2 }),
    ]);

    const response = await GET(new Request('http://localhost/api/metrics'));
    const data = await response.json();

    // `revenue` / `avgOrderValue` are finance-backed now (Task 5); with no
    // finance rows they read 0. Order and item counts still come from Sale.
    expect(data.metrics).toMatchObject({
      salesCount: 2,
      totalOrders: 2,
      totalItems: 3,
    });
    expect(data.lastUpdated).toBeDefined();
  });

  // The traffic headline used to _sum PerformanceMetric.impressions across every
  // CSV snapshot. Those rows are lifetime-to-date totals restated by each
  // upload, so summing snapshots double counts a listing's impressions.
  // EbayTrafficDay carries real per-day counts.
  it('derives store-wide traffic totals and rates from EbayTrafficDay', async () => {
    (prisma.ebayTrafficDay.findMany as any).mockResolvedValue([
      tday('2026-05-01T00:00:00.000Z', { impressionsTotal: 1000, viewsTotal: 40, transactions: 2 }),
      tday('2026-05-02T00:00:00.000Z', { impressionsTotal: 3000, viewsTotal: 60, transactions: 3 }),
    ]);

    const response = await GET(new Request('http://localhost/api/metrics'));
    const data = await response.json();

    expect(data.metrics).toMatchObject({
      impressions: 4000,
      pageViews: 100,
      ctr: 0.025, // 100 views / 4000 impressions, kept as a fraction
      conversionRate: 0.05, // 5 transactions / 100 views
    });
  });

  it('rolls traffic up by calendar month, rates from the summed counts', async () => {
    (prisma.ebayTrafficDay.findMany as any).mockResolvedValue([
      tday('2026-05-04T00:00:00.000Z', { impressionsTotal: 1000, viewsTotal: 30, transactions: 1 }),
      tday('2026-05-20T00:00:00.000Z', { impressionsTotal: 1000, viewsTotal: 20, transactions: 1 }),
      tday('2026-06-02T00:00:00.000Z', { impressionsTotal: 500, viewsTotal: 25, transactions: 5 }),
    ]);

    const response = await GET(new Request('http://localhost/api/metrics'));
    const { monthlyTraffic } = (await response.json()).metrics;

    expect(monthlyTraffic).toEqual([
      { month: '2026-05', label: 'May 2026', impressions: 2000, pageViews: 50, ctr: 0.025, conversionRate: 0.04 },
      { month: '2026-06', label: 'Jun 2026', impressions: 500, pageViews: 25, ctr: 0.05, conversionRate: 0.2 },
    ]);
  });

  it('handles empty results', async () => {
    const response = await GET(new Request('http://localhost/api/metrics'));
    const data = await response.json();

    expect(data.metrics).toMatchObject({
      revenue: 0,
      salesCount: 0,
      impressions: 0,
      pageViews: 0,
      ctr: 0,
      conversionRate: 0,
      inventoryCount: 0,
    });
    expect(data.metrics.profitPerBrand).toEqual([]);
    expect(data.metrics.inventoryByBrand).toEqual([]);
  });

  // The dashboard "Active Listings" tile read prisma.inventory (the CSV table,
  // which accumulates every listing ever uploaded). The live count is the
  // EbayOffer rows the report still marks active.
  it('reports activeListings from the count of active EbayOffer rows', async () => {
    (prisma.ebayOffer.count as any).mockResolvedValue(157);

    const response = await GET(new Request('http://localhost/api/metrics'));
    const data = await response.json();

    expect(data.metrics.activeListings).toBe(157);
    expect((prisma.ebayOffer.count as any).mock.calls[0][0]).toEqual({ where: { status: 'active' } });
  });

  it('merges alias brands in inventoryByBrand', async () => {
    (prisma.inventory.groupBy as any).mockResolvedValue([
      { brand: 'Mercedes', _count: { id: 8 }, _sum: { price: 800 }, _avg: { price: 100 } },
      { brand: 'MERCEDES-BENZ', _count: { id: 2 }, _sum: { price: 200 }, _avg: { price: 100 } },
      { brand: 'Mercedes-Benz', _count: { id: 19 }, _sum: { price: 1900 }, _avg: { price: 100 } },
    ]);

    const response = await GET(new Request('http://localhost/api/metrics'));
    const data = await response.json();

    expect(data.metrics.inventoryByBrand).toEqual([
      { brand: 'Mercedes-Benz', count: 29, totalValue: 2900, avgPrice: 100 },
    ]);
  });

  // The orders sync writes EbayOrder rows. Before the merge existed they were
  // invisible here: the dashboard read Sale only, so a synced order moved no
  // number on the page.
  describe('orders that came from the API', () => {
    const ebayOrder = (overrides: Record<string, any> = {}) => ({
      id: '12-34567-89012',
      creationDate: new Date('2026-05-01T18:00:00Z'),
      orderFulfillmentStatus: 'FULFILLED',
      orderPaymentStatus: 'PAID',
      pricingSummary: JSON.stringify({
        priceSubtotal: { value: '300.00', currency: 'USD' },
        deliveryCost: { value: '20.00', currency: 'USD' },
        total: { value: '320.00', currency: 'USD' },
      }),
      lineItems: JSON.stringify([
        {
          legacyItemId: '999',
          title: 'Volvo XC90 Headlight',
          quantity: 1,
          ebayCollectAndRemitTaxes: [{ amount: { value: '15.00', currency: 'USD' } }],
          properties: { soldViaAdCampaign: false },
        },
      ]),
      ...overrides,
    });

    it('counts an API-only order in the totals', async () => {
      (prisma.sale.findMany as any).mockResolvedValue([]);
      (prisma.ebayOrder.findMany as any).mockResolvedValue([ebayOrder()]);

      const response = await GET(new Request('http://localhost/api/metrics'));
      const data = await response.json();

      // Headline `revenue` is finance-backed now; the merge still has to land the
      // order in the count and in the soldFor-derived best-sellers roll-up.
      expect(data.metrics).toMatchObject({ salesCount: 1 });
      expect(data.metrics.bestSellers[0]).toMatchObject({ revenue: 300 });
    });

    it('replaces the CSV figures for an order both sources hold', async () => {
      // The CSV row understates this order: it carried one of two line items
      // and its totalPrice collapsed to a remainder.
      (prisma.sale.findMany as any).mockResolvedValue([
        sale({ id: 7, orderNumber: '12-34567-89012', soldFor: 150, quantity: 1, brand: 'Volvo' }),
      ]);
      (prisma.ebayOrder.findMany as any).mockResolvedValue([ebayOrder()]);

      const response = await GET(new Request('http://localhost/api/metrics'));
      const data = await response.json();

      // One merged order, and the API's 300 wins over the CSV's 150.
      expect(data.metrics).toMatchObject({ salesCount: 1 });
      expect(data.metrics.bestSellers[0]).toMatchObject({ revenue: 300 });
    });

    it('keeps the brand the CSV supplies, which the API payload lacks', async () => {
      (prisma.sale.findMany as any).mockResolvedValue([
        sale({ id: 7, orderNumber: '12-34567-89012', soldFor: 150, brand: 'Volvo' }),
      ]);
      (prisma.ebayOrder.findMany as any).mockResolvedValue([ebayOrder()]);

      const response = await GET(new Request('http://localhost/api/metrics'));
      const data = await response.json();

      // The API line item carries no brand; the CSV's "Volvo" must survive the merge.
      expect(data.metrics.bestSellers[0]).toMatchObject({ brand: 'Volvo', revenue: 300 });
    });
  });
});
