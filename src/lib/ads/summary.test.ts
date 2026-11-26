import { describe, expect, it, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  default: {
    ebayAdReport: { findMany: vi.fn(), findFirst: vi.fn() },
    ebayAdCampaign: { findMany: vi.fn() },
    promotedListingMetric: { findMany: vi.fn() },
  },
}));

import { loadAdSummary } from './summary';

const adReport = prisma.ebayAdReport as any;
const adCampaign = prisma.ebayAdCampaign as any;
const legacyMetric = prisma.promotedListingMetric as any;

const report = (over: Record<string, unknown> = {}) => ({
  reportStart: new Date('2026-06-01T00:00:00Z'),
  reportEnd: new Date('2026-06-07T00:00:00Z'),
  fundingModel: 'CPS',
  campaignId: 'C-CPS',
  campaignName: 'CPS Camp',
  campaignStatus: 'RUNNING',
  listingId: 'L1',
  title: 'Item 1',
  impressions: 0,
  clicks: 0,
  adSpend: 0,
  attributedSales: 0,
  attributedUnits: 0,
  cpc: 0,
  ctr: 0,
  roas: 0,
  acos: 0,
  ...over,
});

const campaign = (over: Record<string, unknown> = {}) => ({
  campaignId: 'C-CPS',
  campaignName: 'CPS Camp',
  fundingModel: 'CPS',
  campaignStatus: 'RUNNING',
  channels: null,
  targetingType: null,
  dailyBudget: 5,
  budgetCurrency: 'USD',
  bidPercentage: null,
  startDate: null,
  endDate: null,
  lastSeenAt: new Date('2026-09-10T00:00:00Z'),
  ...over,
});

const csv = (over: Record<string, unknown> = {}) => ({
  reportStart: new Date('2026-03-01T00:00:00Z'),
  reportEnd: new Date('2026-03-31T00:00:00Z'),
  campaignName: 'CPS Camp',
  campaignId: 'C-CPS',
  campaignStatus: 'RUNNING',
  itemId: 'L1',
  title: 'Item 1',
  promotedImpressions: 0,
  promotedClicks: 0,
  promotedSoldQuantity: 0,
  organicSoldQuantity: 0,
  totalSoldQuantity: 0,
  attributedSales: 0,
  adFees: 0,
  roas: 0,
  organicClicks: 0,
  organicImpressions: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  adReport.findMany.mockResolvedValue([]);
  adReport.findFirst.mockResolvedValue(null);
  adCampaign.findMany.mockResolvedValue([]);
  legacyMetric.findMany.mockResolvedValue([]);
});

describe('loadAdSummary', () => {
  it('aggregates an API-only window: totals, CPS/CPC split, byCampaign, byWindow, winners/losers, rosterOnly', async () => {
    adReport.findFirst.mockResolvedValue({ reportStart: new Date('2026-05-01T00:00:00Z') });
    adReport.findMany.mockResolvedValue([
      report({ campaignId: 'C-CPS', fundingModel: 'CPS', listingId: 'L1', impressions: 1000, clicks: 50, adSpend: 20, attributedSales: 200, attributedUnits: 4 }),
      report({ campaignId: 'C-CPC', fundingModel: 'CPC', campaignName: 'CPC Camp', campaignStatus: 'ENDED', listingId: 'L2', impressions: 500, clicks: 10, adSpend: 15, attributedSales: 0, attributedUnits: 0 }),
      report({ campaignId: 'C-CPS', fundingModel: 'CPS', listingId: 'L1', reportStart: new Date('2026-06-08T00:00:00Z'), reportEnd: new Date('2026-06-14T00:00:00Z'), impressions: 800, clicks: 40, adSpend: 10, attributedSales: 100, attributedUnits: 2 }),
    ]);
    adCampaign.findMany.mockResolvedValue([
      campaign({ campaignId: 'C-CPS', campaignName: 'CPS Camp', fundingModel: 'CPS', campaignStatus: 'RUNNING', dailyBudget: 5 }),
      campaign({ campaignId: 'C-CPC', campaignName: 'CPC Camp', fundingModel: 'CPC', campaignStatus: 'ENDED', dailyBudget: null }),
      campaign({ campaignId: 'C-IDLE', campaignName: 'Idle Camp', fundingModel: 'CPS', campaignStatus: 'RUNNING', dailyBudget: 10 }),
    ]);

    const s = await loadAdSummary({ from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z') });

    // window filter is on reportStart
    expect(adReport.findMany.mock.calls[0][0].where.reportStart.gte).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(adReport.findMany.mock.calls[0][0].where.reportStart.lte).toEqual(new Date('2026-06-30T23:59:59Z'));
    // from >= adCoverageStart → no CSV fallback read
    expect(legacyMetric.findMany).not.toHaveBeenCalled();

    expect(s.impressions).toBe(2300);
    expect(s.clicks).toBe(100);
    expect(s.ctr).toBeCloseTo(100 / 2300, 10);
    expect(s.spend).toBe(45);
    expect(s.cpsSpend).toBe(30);
    expect(s.cpcSpend).toBe(15);
    expect(s.attributedSales).toBe(300);
    expect(s.attributedUnits).toBe(6);
    expect(s.roas).toBeCloseTo(300 / 45, 10);
    expect(s.acos).toBeCloseTo(45 / 300, 10);
    expect(s.runningCampaigns).toBe(2);
    expect(s.adCoverageStart).toEqual(new Date('2026-05-01T00:00:00Z'));

    const cps = s.byCampaign.find(c => c.campaignId === 'C-CPS')!;
    expect(cps).toMatchObject({ hasReportData: true, impressions: 1800, clicks: 90, spend: 30, attributedSales: 300, attributedUnits: 6, status: 'RUNNING', dailyBudget: 5, fundingModel: 'CPS' });
    expect(cps.roas).toBeCloseTo(10, 10);
    expect(cps.acos).toBeCloseTo(0.1, 10);
    const cpc = s.byCampaign.find(c => c.campaignId === 'C-CPC')!;
    expect(cpc).toMatchObject({ hasReportData: true, spend: 15, attributedSales: 0, roas: 0, acos: 0, status: 'ENDED', fundingModel: 'CPC' });
    const idle = s.byCampaign.find(c => c.campaignId === 'C-IDLE')!;
    expect(idle).toMatchObject({ hasReportData: false, impressions: 0, clicks: 0, spend: 0, status: 'RUNNING', dailyBudget: 10 });
    expect(s.byCampaign).toHaveLength(3);

    expect(s.byWindow.map(w => [w.reportStart.toISOString(), w.spend, w.attributedSales])).toEqual([
      ['2026-06-01T00:00:00.000Z', 35, 200],
      ['2026-06-08T00:00:00.000Z', 10, 100],
    ]);
    expect(s.byWindow[0].roas).toBeCloseTo(200 / 35, 10);

    expect(s.winners.map(w => w.listingId)).toEqual(['L1']);
    expect(s.losers.map(w => w.listingId)).toEqual(['L2']);
    expect(s.rosterOnly.map(c => c.campaignId)).toEqual(['C-IDLE']);
  });

  it('falls back to PromotedListingMetric when no EbayAdReport rows exist', async () => {
    adReport.findFirst.mockResolvedValue(null);
    adReport.findMany.mockResolvedValue([]);
    legacyMetric.findMany.mockResolvedValue([
      csv({ campaignId: 'C-CPS', itemId: 'L1', promotedImpressions: 400, promotedClicks: 20, adFees: 8, attributedSales: 80, promotedSoldQuantity: 1, organicImpressions: 100, organicClicks: 5 }),
    ]);
    adCampaign.findMany.mockResolvedValue([
      campaign({ campaignId: 'C-CPS', fundingModel: 'CPS', campaignStatus: 'RUNNING', dailyBudget: 5 }),
    ]);

    const s = await loadAdSummary({ from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z') });

    expect(s.adCoverageStart).toBeNull();
    expect(s.impressions).toBe(400);
    expect(s.clicks).toBe(20);
    expect(s.spend).toBe(8);
    expect(s.cpsSpend).toBe(8);
    expect(s.cpcSpend).toBe(0);
    expect(s.attributedSales).toBe(80);
    expect(s.roas).toBeCloseTo(10, 10);
    expect(s.acos).toBeCloseTo(0.1, 10);
    const c = s.byCampaign.find(x => x.campaignId === 'C-CPS')!;
    expect(c.hasReportData).toBe(true);
    expect(c.impressions).toBe(400);
  });

  it('uses CSV only for the sub-span before adCoverageStart and API rows after it', async () => {
    adReport.findFirst.mockResolvedValue({ reportStart: new Date('2026-06-01T00:00:00Z') });
    adReport.findMany.mockResolvedValue([
      report({ campaignId: 'C-CPS', fundingModel: 'CPS', listingId: 'L9', reportStart: new Date('2026-06-05T00:00:00Z'), reportEnd: new Date('2026-06-11T00:00:00Z'), impressions: 1000, clicks: 30, adSpend: 12, attributedSales: 120, attributedUnits: 3 }),
    ]);
    legacyMetric.findMany.mockResolvedValue([
      csv({ campaignId: 'C-CPS', itemId: 'L8', reportStart: new Date('2026-05-01T00:00:00Z'), reportEnd: new Date('2026-05-15T00:00:00Z'), promotedImpressions: 500, promotedClicks: 10, adFees: 5, attributedSales: 50, promotedSoldQuantity: 1 }),
    ]);
    adCampaign.findMany.mockResolvedValue([campaign({ campaignId: 'C-CPS', fundingModel: 'CPS', campaignStatus: 'RUNNING' })]);

    const s = await loadAdSummary({ from: new Date('2026-04-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') });

    // CSV window upper bound is the day before adCoverageStart
    const csvWhere = legacyMetric.findMany.mock.calls[0][0].where;
    expect(csvWhere.reportStart.gte).toEqual(new Date('2026-04-01T00:00:00Z'));
    expect(csvWhere.reportStart.lte).toEqual(new Date('2026-05-31T00:00:00Z'));

    expect(s.impressions).toBe(1500);
    expect(s.clicks).toBe(40);
    expect(s.spend).toBe(17);
    expect(s.attributedSales).toBe(170);
    expect(s.attributedUnits).toBe(4);
    expect(s.byWindow.map(w => w.reportStart.toISOString())).toEqual([
      '2026-05-01T00:00:00.000Z',
      '2026-06-05T00:00:00.000Z',
    ]);
  });

  it('reads CSV fallback when `from` is undefined (unbounded window)', async () => {
    adReport.findFirst.mockResolvedValue({ reportStart: new Date('2026-06-01T00:00:00Z') });
    adReport.findMany.mockResolvedValue([]);
    legacyMetric.findMany.mockResolvedValue([
      csv({ campaignId: 'C-CPS', itemId: 'L1', promotedImpressions: 100, promotedClicks: 2, adFees: 1, attributedSales: 10, promotedSoldQuantity: 1 }),
    ]);
    adCampaign.findMany.mockResolvedValue([campaign({ campaignId: 'C-CPS', fundingModel: 'CPS' })]);

    const s = await loadAdSummary({});

    expect(adReport.findMany.mock.calls[0][0].where).toEqual({});
    const csvWhere = legacyMetric.findMany.mock.calls[0][0].where;
    expect(csvWhere.reportStart.gte).toBeUndefined();
    expect(csvWhere.reportStart.lte).toEqual(new Date('2026-05-31T00:00:00Z'));
    expect(s.impressions).toBe(100);
    expect(s.spend).toBe(1);
  });

  it('lets the campaign roster override a stored fundingModel of "unknown"', async () => {
    adReport.findFirst.mockResolvedValue({ reportStart: new Date('2026-05-01T00:00:00Z') });
    adReport.findMany.mockResolvedValue([
      report({ campaignId: 'C-CPS', fundingModel: 'unknown', listingId: 'L1', impressions: 100, clicks: 5, adSpend: 9, attributedSales: 90, attributedUnits: 1 }),
    ]);
    adCampaign.findMany.mockResolvedValue([campaign({ campaignId: 'C-CPS', fundingModel: 'CPS', campaignStatus: 'RUNNING' })]);

    const s = await loadAdSummary({ from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T00:00:00Z') });

    expect(s.cpsSpend).toBe(9);
    expect(s.cpcSpend).toBe(0);
    expect(s.byCampaign.find(c => c.campaignId === 'C-CPS')!.fundingModel).toBe('CPS');
  });

  it('returns 0 for every ratio when denominators are 0', async () => {
    adReport.findFirst.mockResolvedValue({ reportStart: new Date('2026-05-01T00:00:00Z') });
    adReport.findMany.mockResolvedValue([
      report({ campaignId: 'C-CPS', listingId: 'L1', impressions: 0, clicks: 0, adSpend: 0, attributedSales: 0, attributedUnits: 0 }),
    ]);
    adCampaign.findMany.mockResolvedValue([campaign({ campaignId: 'C-CPS', fundingModel: 'CPS', campaignStatus: 'ENDED' })]);

    const s = await loadAdSummary({ from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T00:00:00Z') });

    expect(s.ctr).toBe(0);
    expect(s.roas).toBe(0);
    expect(s.acos).toBe(0);
    expect(s.byCampaign[0].roas).toBe(0);
    expect(s.byCampaign[0].acos).toBe(0);
    expect(s.byWindow[0].roas).toBe(0);
    expect(Number.isFinite(s.roas)).toBe(true);
    expect(s.runningCampaigns).toBe(0);
    expect(s.rosterOnly).toHaveLength(0);
  });
});
