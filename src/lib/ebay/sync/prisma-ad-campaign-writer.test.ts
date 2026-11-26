import { it } from '@/test/store-fixture';
import { describe, expect, vi } from 'vitest';
import { createPrismaAdCampaignStore } from './prisma-ad-campaign-writer';
import type { MappedAdCampaign } from './ad-campaign';

describe('createPrismaAdCampaignStore', () => {
  it('saveCampaigns upserts rows with lastSeenAt set', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({});
    const mockTransaction = vi.fn().mockImplementation((ops) => Promise.resolve(null));
    const prisma = {
      ebayAdCampaign: {
        upsert: mockUpsert,
      },
      $transaction: mockTransaction,
    };

    const store = createPrismaAdCampaignStore(prisma as never);
    const rows: MappedAdCampaign[] = [
      {
        campaignId: 'c1',
        campaignName: 'Campaign 1',
        fundingModel: 'CPS',
        campaignStatus: 'RUNNING',
        channels: '["ON_SITE"]',
        targetingType: 'SMART',
        dailyBudget: 10,
        budgetCurrency: 'USD',
        bidPercentage: 2,
        startDate: new Date('2026-07-17T16:05:30.000Z'),
        endDate: null,
      },
    ];
    const seenAt = new Date('2026-09-10T12:00:00.000Z');

    const count = await store.saveCampaigns(rows, seenAt);

    expect(count).toBe(1);
    expect(mockTransaction).toHaveBeenCalled();
  });

  it('upserts on campaignId key', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({});
    const mockTransaction = vi.fn().mockImplementation((ops) => Promise.resolve(null));
    const prisma = {
      ebayAdCampaign: {
        upsert: mockUpsert,
      },
      $transaction: mockTransaction,
    };

    const store = createPrismaAdCampaignStore(prisma as never);
    const rows: MappedAdCampaign[] = [
      {
        campaignId: 'c1',
        campaignName: 'Campaign 1',
        fundingModel: 'CPS',
        campaignStatus: 'RUNNING',
        channels: null,
        targetingType: null,
        dailyBudget: null,
        budgetCurrency: null,
        bidPercentage: null,
        startDate: null,
        endDate: null,
      },
    ];
    const seenAt = new Date();

    await store.saveCampaigns(rows, seenAt);

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { storeId_campaignId: { storeId: 'legacy', campaignId: 'c1' } },
      create: expect.objectContaining({
        campaignId: 'c1',
        campaignName: 'Campaign 1',
        fundingModel: 'CPS',
        campaignStatus: 'RUNNING',
        lastSeenAt: seenAt,
      }),
      update: expect.objectContaining({
        campaignName: 'Campaign 1',
        fundingModel: 'CPS',
        campaignStatus: 'RUNNING',
        lastSeenAt: seenAt,
      }),
    });
  });

  it('includes lastSeenAt in both create and update', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({});
    const mockTransaction = vi.fn().mockImplementation((ops) => Promise.resolve(null));
    const prisma = {
      ebayAdCampaign: {
        upsert: mockUpsert,
      },
      $transaction: mockTransaction,
    };

    const store = createPrismaAdCampaignStore(prisma as never);
    const rows: MappedAdCampaign[] = [
      {
        campaignId: 'c1',
        campaignName: 'Campaign 1',
        fundingModel: 'CPS',
        campaignStatus: 'RUNNING',
        channels: null,
        targetingType: null,
        dailyBudget: null,
        budgetCurrency: null,
        bidPercentage: null,
        startDate: null,
        endDate: null,
      },
    ];
    const seenAt = new Date('2026-09-10T12:00:00.000Z');

    await store.saveCampaigns(rows, seenAt);

    const callArgs = mockUpsert.mock.calls[0][0];
    expect(callArgs.create.lastSeenAt).toEqual(seenAt);
    expect(callArgs.update.lastSeenAt).toEqual(seenAt);
  });

  it('returns the count of rows saved', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({});
    const mockTransaction = vi.fn().mockImplementation((ops) => Promise.resolve(null));
    const prisma = {
      ebayAdCampaign: {
        upsert: mockUpsert,
      },
      $transaction: mockTransaction,
    };

    const store = createPrismaAdCampaignStore(prisma as never);
    const rows: MappedAdCampaign[] = [
      {
        campaignId: 'c1',
        campaignName: 'Campaign 1',
        fundingModel: 'CPS',
        campaignStatus: 'RUNNING',
        channels: null,
        targetingType: null,
        dailyBudget: null,
        budgetCurrency: null,
        bidPercentage: null,
        startDate: null,
        endDate: null,
      },
      {
        campaignId: 'c2',
        campaignName: 'Campaign 2',
        fundingModel: 'CPC',
        campaignStatus: 'ENDED',
        channels: null,
        targetingType: null,
        dailyBudget: null,
        budgetCurrency: null,
        bidPercentage: null,
        startDate: null,
        endDate: null,
      },
    ];

    const count = await store.saveCampaigns(rows, new Date());

    expect(count).toBe(2);
  });

  it('fundingModelByCampaign returns map from campaignId to fundingModel', async () => {
    const mockFindMany = vi.fn().mockResolvedValue([
      { campaignId: 'c1', fundingModel: 'CPS' },
      { campaignId: 'c2', fundingModel: 'CPC' },
    ]);
    const prisma = {
      ebayAdCampaign: {
        findMany: mockFindMany,
      },
      $transaction: vi.fn(),
    };

    const store = createPrismaAdCampaignStore(prisma as never);
    const map = await store.fundingModelByCampaign();

    expect(mockFindMany).toHaveBeenCalledWith({
      select: { campaignId: true, fundingModel: true },
    });
    expect(map).toBeInstanceOf(Map);
    expect(map.get('c1')).toBe('CPS');
    expect(map.get('c2')).toBe('CPC');
  });

  it('fundingModelByCampaign returns empty map when no campaigns', async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      ebayAdCampaign: {
        findMany: mockFindMany,
      },
      $transaction: vi.fn(),
    };

    const store = createPrismaAdCampaignStore(prisma as never);
    const map = await store.fundingModelByCampaign();

    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
  });

  it('batches large numbers of campaigns', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({});
    const mockTransaction = vi.fn().mockImplementation((ops) => Promise.resolve(null));
    const prisma = {
      ebayAdCampaign: {
        upsert: mockUpsert,
      },
      $transaction: mockTransaction,
    };

    const store = createPrismaAdCampaignStore(prisma as never);
    const rows: MappedAdCampaign[] = Array.from({ length: 300 }, (_, i) => ({
      campaignId: `c${i}`,
      campaignName: `Campaign ${i}`,
      fundingModel: 'CPS',
      campaignStatus: 'RUNNING',
      channels: null,
      targetingType: null,
      dailyBudget: null,
      budgetCurrency: null,
      bidPercentage: null,
      startDate: null,
      endDate: null,
    }));

    const count = await store.saveCampaigns(rows, new Date());

    expect(count).toBe(300);
    // 300 rows / BATCH_SIZE 250 = 2 batches
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });
});
