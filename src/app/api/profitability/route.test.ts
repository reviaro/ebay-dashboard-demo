vi.mock('@/lib/stores/route', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/stores/route')>(),
  withStore: (await import('@/test/store-fixture')).withUnitStore,
}));
import { describe, expect, it, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  default: {
    ebayFinanceTransaction: { findMany: vi.fn(), findFirst: vi.fn() },
    ebayTransaction: { findMany: vi.fn() },
    sale: { findMany: vi.fn() },
    promotedListingMetric: { findFirst: vi.fn(), findMany: vi.fn() },
    ebayAdReport: { findMany: vi.fn(), findFirst: vi.fn() },
    ebayAdCampaign: { findMany: vi.fn() },
  },
}));

import { GET } from './route';

const finance = prisma.ebayFinanceTransaction as any;
const ebayTransaction = prisma.ebayTransaction as any;
const promoted = prisma.promotedListingMetric as any;
const adReport = prisma.ebayAdReport as any;
const adCampaign = prisma.ebayAdCampaign as any;

const call = (url = 'http://localhost/api/profitability') => GET(new Request(url));

beforeEach(() => {
  vi.clearAllMocks();
  // Refund amount is POSITIVE; direction is bookingEntry.
  finance.findMany.mockResolvedValue([
    { transactionType: 'SALE', amount: '100.00', transactionDate: new Date('2026-06-05T00:00:00Z'), orderId: 'o1' },
    { transactionType: 'REFUND', amount: '15.00', transactionDate: new Date('2026-06-06T00:00:00Z'), orderId: 'o1', bookingEntry: 'DEBIT' },
    { transactionType: 'SHIPPING_LABEL', amount: '8.00', transactionDate: new Date('2026-06-07T00:00:00Z'), orderId: 'o1' },
  ]);
  finance.findFirst.mockResolvedValue({ transactionDate: new Date('2026-06-01T00:00:00Z') });
  (prisma.sale.findMany as any).mockResolvedValue([]);
  ebayTransaction.findMany.mockResolvedValue([]);
  promoted.findFirst.mockResolvedValue(null);
  promoted.findMany.mockResolvedValue([]);
  adReport.findMany.mockResolvedValue([]);
  adReport.findFirst.mockResolvedValue(null);
  adCampaign.findMany.mockResolvedValue([]);
});

describe('GET /api/profitability', () => {
  it('computes gross, refunds, and net from EbayFinanceTransaction', async () => {
    const body = await (await call()).json();
    expect(body.financials.grossRevenue).toBe(100);
    expect(body.financials.refunds).toBe(15);
    expect(body.financials.netRevenue).toBe(85);
    expect(body.financials.orders).toBe(1);
  });

  it('with no feeDetails, eBay fees are 0 and gross-of-fees equals proceeds', async () => {
    const body = await (await call()).json();
    expect(body.financials.ebayFees).toBe(0);
    expect(body.financials.grossOfFees).toBe(100);
  });

  it('splits SALE proceeds into gross-of-fees and eBay fees from feeDetails', async () => {
    finance.findMany.mockResolvedValue([
      {
        transactionType: 'SALE', amount: '90.00', orderId: 'o1',
        transactionDate: new Date('2026-06-05T00:00:00Z'),
        // SALE `amount` is already net of fees; feeDetails is the fee breakdown.
        feeDetails: JSON.stringify([
          { feeType: 'FINAL_VALUE_FEE', amount: '9.50' },
          { feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: '0.50' },
        ]),
      },
    ]);
    const body = await (await call()).json();
    expect(body.financials.grossRevenue).toBe(90); // proceeds after fees
    expect(body.financials.ebayFees).toBe(10); // Σ feeDetails == totalFeeAmount
    expect(body.financials.grossOfFees).toBe(100); // proceeds + fees == Seller Hub gross
  });

  it('returns plain numbers, not Decimal instances', async () => {
    const body = await (await call()).json();
    expect(typeof body.financials.grossRevenue).toBe('number');
    expect(typeof body.financials.netRevenue).toBe('number');
  });

  it('keeps CSV aggregates only for the span before finance coverage begins', async () => {
    // finance coverage starts 2026-06-01; the pre-coverage CSV order still counts,
    // the 2026-07 one is finance-era and must not be double-counted from the CSV.
    ebayTransaction.findMany.mockResolvedValue([
      { type: 'order', transactionDate: new Date('2026-05-20T00:00:00Z'), itemSubtotal: 40, shipping: 10, netAmount: 45,
        finalValueFeeFixed: -0.4, finalValueFeeVariable: -4, regulatoryFee: 0, veryHighInadFee: 0, belowStandardFee: 0, internationalFee: 0, description: '' },
      { type: 'order', transactionDate: new Date('2026-07-01T00:00:00Z'), itemSubtotal: 200, shipping: 0, netAmount: 180,
        finalValueFeeFixed: -0.4, finalValueFeeVariable: -20, regulatoryFee: 0, veryHighInadFee: 0, belowStandardFee: 0, internationalFee: 0, description: '' },
    ]);
    const body = await (await call()).json();
    expect(body.financials.orderRevenue).toBe(50);
  });

  it('still works when no finance data exists yet (CSV-only mode)', async () => {
    finance.findMany.mockResolvedValue([]);
    finance.findFirst.mockResolvedValue(null);
    ebayTransaction.findMany.mockResolvedValue([
      { type: 'order', transactionDate: new Date('2026-05-20T00:00:00Z'), itemSubtotal: 40, shipping: 10, netAmount: 45,
        finalValueFeeFixed: -0.4, finalValueFeeVariable: -4, regulatoryFee: 0, veryHighInadFee: 0, belowStandardFee: 0, internationalFee: 0, description: '' },
    ]);
    const body = await (await call()).json();
    expect(body.financials.grossRevenue).toBe(0);
    expect(body.financials.refunds).toBe(0);
    expect(body.financials.orderRevenue).toBe(50);
  });

  it('surfaces Promoted Listings ad fees from the finance ledger (NON_SALE_CHARGE)', async () => {
    finance.findMany.mockResolvedValue([
      { transactionType: 'SALE', amount: '100.00', transactionDate: new Date('2026-06-05T00:00:00Z'), orderId: 'o1' },
      { transactionType: 'NON_SALE_CHARGE', amount: '4.25', transactionDate: new Date('2026-06-07T00:00:00Z'), rawPayload: JSON.stringify({ feeType: 'AD_FEE' }) },
      { transactionType: 'NON_SALE_CHARGE', amount: '1.75', transactionDate: new Date('2026-06-08T00:00:00Z'), rawPayload: JSON.stringify({ feeType: 'PREMIUM_AD_FEES' }) },
      { transactionType: 'NON_SALE_CHARGE', amount: '9.00', transactionDate: new Date('2026-06-09T00:00:00Z'), rawPayload: JSON.stringify({ feeType: 'OTHER_FEES' }) },
    ]);
    const body = await (await call()).json();
    expect(body.financials.adFees).toBe(6);
  });

  it('fills the deduction breakdown from the finance ledger, not the empty CSV era', async () => {
    finance.findMany.mockResolvedValue([
      { transactionType: 'SALE', amount: '80.00', transactionDate: new Date('2026-06-05T00:00:00Z'), orderId: 'o1',
        feeDetails: JSON.stringify([
          { feeType: 'FINAL_VALUE_FEE', amount: '9.00' },
          { feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: '0.40' },
          { feeType: 'INTERNATIONAL_FEE', amount: '1.20' },
          { feeType: 'HIGH_ITEM_NOT_AS_DESCRIBED_FEE', amount: '2.50' },
        ]) },
      { transactionType: 'SHIPPING_LABEL', amount: '7.25', transactionDate: new Date('2026-06-06T00:00:00Z') },
      { transactionType: 'NON_SALE_CHARGE', amount: '3.00', transactionDate: new Date('2026-06-07T00:00:00Z'), rawPayload: JSON.stringify({ feeType: 'OTHER_FEES' }) },
    ]);
    const body = await (await call()).json();
    expect(body.financials.finalValueFees).toBeCloseTo(9.4, 6);
    expect(body.financials.internationalFees).toBeCloseTo(1.2, 6);
    expect(body.financials.penaltyFees).toBeCloseTo(2.5, 6);
    expect(body.financials.shippingLabels).toBeCloseTo(7.25, 6);
    expect(body.financials.otherFees).toBeCloseTo(3, 6);
    expect(body.financials.regulatoryFees).toBe(0);
  });

  it('reports the CPS/CPC funding split and roster fields via loadAdSummary', async () => {
    adReport.findFirst.mockResolvedValue({ reportStart: new Date('2026-05-01T00:00:00Z') });
    adReport.findMany.mockResolvedValue([
      { reportStart: new Date('2026-06-01T00:00:00Z'), reportEnd: new Date('2026-06-07T00:00:00Z'), fundingModel: 'CPS', campaignId: 'C-CPS', campaignName: 'CPS Camp', campaignStatus: 'RUNNING', listingId: 'L1', title: 'Item 1', impressions: 1000, clicks: 50, adSpend: 20, attributedSales: 200, attributedUnits: 4, cpc: 0, ctr: 0, roas: 0, acos: 0 },
      { reportStart: new Date('2026-06-01T00:00:00Z'), reportEnd: new Date('2026-06-07T00:00:00Z'), fundingModel: 'CPC', campaignId: 'C-CPC', campaignName: 'CPC Camp', campaignStatus: 'ENDED', listingId: 'L2', title: 'Item 2', impressions: 400, clicks: 8, adSpend: 10, attributedSales: 40, attributedUnits: 1, cpc: 0, ctr: 0, roas: 0, acos: 0 },
    ]);
    adCampaign.findMany.mockResolvedValue([
      { campaignId: 'C-CPS', campaignName: 'CPS Camp', fundingModel: 'CPS', campaignStatus: 'RUNNING', dailyBudget: 5, channels: null, targetingType: null, budgetCurrency: 'USD', bidPercentage: null, startDate: null, endDate: null, lastSeenAt: new Date() },
      { campaignId: 'C-CPC', campaignName: 'CPC Camp', fundingModel: 'CPC', campaignStatus: 'ENDED', dailyBudget: null, channels: null, targetingType: null, budgetCurrency: null, bidPercentage: null, startDate: null, endDate: null, lastSeenAt: new Date() },
    ]);

    const body = await (await call()).json();

    expect(body.advertising.spend).toBe(30);
    expect(body.advertising.cpsSpend).toBe(20);
    expect(body.advertising.cpcSpend).toBe(10);
    expect(body.advertising.sales).toBe(240);
    expect(body.advertising.acos).toBeCloseTo(30 / 240, 10);
    expect(body.advertising.roas).toBeCloseTo(240 / 30, 10);
    expect(body.adCoverageStart).toBe('2026-05-01T00:00:00.000Z');
    expect(body.reportRange).toEqual({ start: '2026-06-01T00:00:00.000Z', end: '2026-06-07T00:00:00.000Z' });

    const cps = body.campaigns.find((c: any) => c.campaignId === 'C-CPS');
    expect(cps.name).toBe('CPS Camp');
    expect(cps.fundingModel).toBe('CPS');
    expect(cps.status).toBe('RUNNING');
    expect(cps.dailyBudget).toBe(5);
    expect(cps.acos).toBeCloseTo(20 / 200, 10);
  });
});
