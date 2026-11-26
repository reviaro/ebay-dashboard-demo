import { describe, expect, it, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  default: {
    ebayFinanceTransaction: { findMany: vi.fn(), findFirst: vi.fn() },
    sale: { findMany: vi.fn() },
  },
}));

import { loadFinanceSummary } from './summary';

const fin = prisma.ebayFinanceTransaction as unknown as { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
const saleFindMany = (prisma.sale as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany;

const sale = (over: Record<string, unknown> = {}) => ({
  transactionType: 'SALE', transactionDate: new Date('2026-08-05T00:00:00Z'),
  amount: '90.00', feeDetails: null, orderId: null, ...over,
});
const refund = (over: Record<string, unknown> = {}) => ({
  transactionType: 'REFUND', transactionDate: new Date('2026-08-06T00:00:00Z'),
  amount: '15.00', feeDetails: null, orderId: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  fin.findMany.mockResolvedValue([]);
  fin.findFirst.mockResolvedValue(null);
  saleFindMany.mockResolvedValue([]);
});

describe('loadFinanceSummary', () => {
  it('sums proceeds, fees, gross, refunds and net from finance rows', async () => {
    fin.findMany.mockResolvedValue([
      sale({ amount: '90.00', feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '9.50' }, { feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: '0.50' }]) }),
      sale({ amount: '45.00', feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '5.00' }]) }),
      refund({ amount: '15.00' }),
    ]);

    const s = await loadFinanceSummary({});

    expect(s.proceedsAfterFees).toBe(135);
    expect(s.ebayFees).toBe(15);
    expect(s.grossRevenue).toBe(150);
    expect(s.refunds).toBe(15);
    expect(s.netRevenue).toBe(120);
  });

  it('reports coverageStart from the earliest finance transaction, unfiltered by the window', async () => {
    fin.findFirst.mockResolvedValue({ transactionDate: new Date('2024-09-01T00:00:00Z') });
    const s = await loadFinanceSummary({ from: new Date('2026-08-01'), to: new Date('2026-08-31') });
    expect(s.coverageStart).toEqual(new Date('2024-09-01T00:00:00Z'));
  });

  it('is all zeros / null / empty when there is no finance data', async () => {
    const s = await loadFinanceSummary({});
    expect(s).toMatchObject({
      coverageStart: null, grossRevenue: 0, ebayFees: 0, adFees: 0, proceedsAfterFees: 0, refunds: 0, netRevenue: 0,
      byMonth: [], byBrand: [],
      feeBreakdown: { finalValue: 0, international: 0, penalties: 0, regulatory: 0, ads: 0, shippingLabels: 0, other: 0 },
    });
  });

  it('sums Promoted Listings ad fees from NON_SALE_CHARGE rows (AD_FEE + PREMIUM_AD_FEES only)', async () => {
    fin.findMany.mockResolvedValue([
      sale({ amount: '90.00' }),
      { transactionType: 'NON_SALE_CHARGE', transactionDate: new Date('2026-08-07T00:00:00Z'), amount: '5.00', feeDetails: null, orderId: null, rawPayload: JSON.stringify({ feeType: 'AD_FEE' }) },
      { transactionType: 'NON_SALE_CHARGE', transactionDate: new Date('2026-08-08T00:00:00Z'), amount: '2.00', feeDetails: null, orderId: null, rawPayload: JSON.stringify({ feeType: 'PREMIUM_AD_FEES' }) },
      { transactionType: 'NON_SALE_CHARGE', transactionDate: new Date('2026-08-09T00:00:00Z'), amount: '9.00', feeDetails: null, orderId: null, rawPayload: JSON.stringify({ feeType: 'OTHER_FEES' }) },
      { transactionType: 'NON_SALE_CHARGE', transactionDate: new Date('2026-08-10T00:00:00Z'), amount: '3.00', feeDetails: null, orderId: null, rawPayload: 'not json' },
    ]);
    const s = await loadFinanceSummary({});
    expect(s.adFees).toBe(7);
    // ad fees are their own line, not folded into ebayFees (SALE feeDetails only)
    expect(s.ebayFees).toBe(0);
  });

  it('reports adFees as 0 when no ad-fee charges are present', async () => {
    fin.findMany.mockResolvedValue([sale({ amount: '90.00', feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '9.00' }]) })]);
    expect((await loadFinanceSummary({})).adFees).toBe(0);
  });

  it('splits deductions into final value / international / penalties / regulatory / other, plus shipping labels and ads', async () => {
    fin.findMany.mockResolvedValue([
      sale({ amount: '80.00', feeDetails: JSON.stringify([
        { feeType: 'FINAL_VALUE_FEE', amount: '8.00' },
        { feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: '0.40' },
        { feeType: 'INTERNATIONAL_FEE', amount: '1.10' },
        { feeType: 'HIGH_ITEM_NOT_AS_DESCRIBED_FEE', amount: '2.00' },
        { feeType: 'REGULATORY_OPERATING_FEE', amount: '0.25' },
        { feeType: 'SOME_UNMAPPED_FEE', amount: '0.30' },
      ]) }),
      { transactionType: 'SHIPPING_LABEL', transactionDate: new Date('2026-08-07T00:00:00Z'), amount: '6.50', feeDetails: null, orderId: null, rawPayload: null },
      { transactionType: 'NON_SALE_CHARGE', transactionDate: new Date('2026-08-08T00:00:00Z'), amount: '5.00', feeDetails: null, orderId: null, rawPayload: JSON.stringify({ feeType: 'AD_FEE' }) },
      { transactionType: 'NON_SALE_CHARGE', transactionDate: new Date('2026-08-09T00:00:00Z'), amount: '3.00', feeDetails: null, orderId: null, rawPayload: JSON.stringify({ feeType: 'OTHER_FEES' }) },
    ]);

    const { feeBreakdown: fb, ebayFees } = await loadFinanceSummary({});

    expect(fb.finalValue).toBeCloseTo(8.4, 10);
    expect(fb.international).toBeCloseTo(1.1, 10);
    expect(fb.penalties).toBeCloseTo(2, 10);
    expect(fb.regulatory).toBeCloseTo(0.25, 10);
    expect(fb.ads).toBe(5);
    expect(fb.shippingLabels).toBe(6.5);
    expect(fb.other).toBeCloseTo(3.3, 10); // unmapped SALE fee 0.30 + NON_SALE_CHARGE OTHER_FEES 3.00
    // the SALE share reconciles with ebayFees
    expect(ebayFees).toBeCloseTo(8 + 0.4 + 1.1 + 2 + 0.25 + 0.3, 10);
  });

  it('treats an unparseable feeDetails as zero fees for that row', async () => {
    fin.findMany.mockResolvedValue([sale({ amount: '50.00', feeDetails: 'not json' })]);
    const s = await loadFinanceSummary({});
    expect(s.ebayFees).toBe(0);
    expect(s.proceedsAfterFees).toBe(50);
    expect(s.grossRevenue).toBe(50);
  });

  it('passes the date window through to the finance query', async () => {
    await loadFinanceSummary({ from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59.999Z') });
    const where = fin.findMany.mock.calls[0][0].where;
    expect(where.transactionDate.gte).toEqual(new Date('2026-08-01T00:00:00Z'));
    expect(where.transactionDate.lte).toEqual(new Date('2026-08-31T23:59:59.999Z'));
  });

  it('buckets gross, fees, refunds and net by calendar month with the fee-type split', async () => {
    fin.findMany.mockResolvedValue([
      sale({ transactionDate: new Date('2026-07-10T00:00:00Z'), amount: '90.00',
        feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '9.00' }, { feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: '1.00' }]) }),
      sale({ transactionDate: new Date('2026-08-02T00:00:00Z'), amount: '40.00',
        feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '4.00' }, { feeType: 'HIGH_ITEM_NOT_AS_DESCRIBED_FEE', amount: '2.00' }]) }),
      refund({ transactionDate: new Date('2026-08-20T00:00:00Z'), amount: '10.00' }),
    ]);

    const { byMonth } = await loadFinanceSummary({});

    expect(byMonth).toEqual([
      { month: '2026-07', grossRevenue: 100, ebayFees: 10, refunds: 0, netRevenue: 90,
        finalValueFee: 9, perOrderFee: 1, otherFee: 0 },
      { month: '2026-08', grossRevenue: 46, ebayFees: 6, refunds: 10, netRevenue: 30,
        finalValueFee: 4, perOrderFee: 0, otherFee: 2 },
    ]);
  });

  it('groups gross, fees, refunds, net and units by brand via the Sale join', async () => {
    fin.findMany.mockResolvedValue([
      sale({ orderId: 'o1', amount: '90.00', feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '10.00' }]) }),
      sale({ orderId: 'o2', amount: '40.00', feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '5.00' }]) }),
      sale({ orderId: 'o3-no-match', amount: '20.00' }),
      refund({ orderId: 'o1', amount: '12.00' }),
    ]);
    saleFindMany.mockResolvedValue([
      { orderNumber: 'o1', brand: 'Volvo' },
      { orderNumber: 'o2', brand: 'VOLVO' }, // alias -> normalizeBrand merges
    ]);

    const { byBrand } = await loadFinanceSummary({});

    expect(byBrand).toEqual([
      { brand: 'Volvo', grossRevenue: 145, ebayFees: 15, refunds: 12, netRevenue: 118, units: 2 },
      { brand: 'Unknown', grossRevenue: 20, ebayFees: 0, refunds: 0, netRevenue: 20, units: 1 },
    ]);
    expect(saleFindMany.mock.calls[0][0].where.orderNumber.in.sort()).toEqual(['o1', 'o2', 'o3-no-match']);
  });
});
