import { describe, expect, it, vi } from 'vitest';
import { fetchAdCampaigns } from './ad-campaign';

function fakeClient(pages: (Record<string, unknown> | null)[]) {
  let call = 0;
  return {
    get: vi.fn().mockImplementation(async () => pages[call++]),
    request: vi.fn(),
  };
}

describe('fetchAdCampaigns', () => {
  it('collects every page and returns mapped campaigns', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: '100000000030',
            campaignName: 'Demo CPC Campaign',
            campaignStatus: 'ENDED',
            campaignTargetingType: 'SMART',
            channels: ['ON_SITE'],
            budget: {
              daily: {
                amount: { value: '8.0', currency: 'USD' },
                budgetStatus: 'ALLOCATED',
              },
            },
            fundingStrategy: { fundingModel: 'COST_PER_CLICK' },
            startDate: '2025-01-01T12:00:00.000Z',
            endDate: '2025-01-08T12:00:00.000Z',
            marketplaceId: 'EBAY_US',
          },
        ],
        next: 'https://api.ebay.com/sell/marketing/v1/ad_campaign?offset=100',
      },
      {
        campaigns: [
          {
            campaignId: '100000000031',
            campaignName: 'Demo CPS Campaign',
            campaignStatus: 'RUNNING',
            fundingStrategy: {
              adRateStrategy: 'FIXED',
              bidPercentage: '3.0',
              fundingModel: 'COST_PER_SALE',
            },
          },
        ],
        next: 'https://api.ebay.com/sell/marketing/v1/ad_campaign?offset=200',
      },
      {
        campaigns: [
          {
            campaignId: '123456789012',
            campaignName: 'No funding strategy',
            campaignStatus: 'PAUSED',
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      campaignId: '100000000030',
      campaignName: 'Demo CPC Campaign',
      campaignStatus: 'ENDED',
      fundingModel: 'CPC',
      dailyBudget: 8,
      budgetCurrency: 'USD',
      channels: '["ON_SITE"]',
      targetingType: 'SMART',
    });
    expect(rows[1]).toMatchObject({
      campaignId: '100000000031',
      campaignName: 'Demo CPS Campaign',
      campaignStatus: 'RUNNING',
      fundingModel: 'CPS',
      bidPercentage: 3,
    });
    expect(rows[2]).toMatchObject({
      campaignId: '123456789012',
      fundingModel: 'unknown',
    });
    expect(client.get).toHaveBeenCalledTimes(3);
  });

  it('sends pagination parameters with limit 100', async () => {
    const client = fakeClient([{ campaigns: [] }]);

    await fetchAdCampaigns({ client: client as never });

    const [path, opts] = client.get.mock.calls[0];
    expect(path).toBe('/sell/marketing/v1/ad_campaign');
    expect(opts.query.limit).toBe(100);
    expect(opts.query.offset).toBe(0);
  });

  it('advances offset by 100 for each page', async () => {
    const client = fakeClient([
      { campaigns: Array(100).fill({ campaignId: 'c1', campaignName: 'c', campaignStatus: 'RUNNING' }), next: 'link' },
      { campaigns: Array(50).fill({ campaignId: 'c2', campaignName: 'c', campaignStatus: 'RUNNING' }) },
    ]);

    await fetchAdCampaigns({ client: client as never });

    expect(client.get.mock.calls[0][1].query.offset).toBe(0);
    expect(client.get.mock.calls[1][1].query.offset).toBe(100);
  });

  it('stops pagination when response has no next link', async () => {
    const client = fakeClient([
      { campaigns: [{ campaignId: 'c1', campaignName: 'c', campaignStatus: 'RUNNING' }] },
    ]);

    await fetchAdCampaigns({ client: client as never });

    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('treats null body (empty response) as zero campaigns', async () => {
    const client = fakeClient([null]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows).toEqual([]);
  });

  it('maps COST_PER_SALE to CPS', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: 'c1',
            campaignName: 'CPS Campaign',
            campaignStatus: 'RUNNING',
            fundingStrategy: { fundingModel: 'COST_PER_SALE' },
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows[0].fundingModel).toBe('CPS');
  });

  it('maps COST_PER_CLICK to CPC', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: 'c1',
            campaignName: 'CPC Campaign',
            campaignStatus: 'RUNNING',
            fundingStrategy: { fundingModel: 'COST_PER_CLICK' },
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows[0].fundingModel).toBe('CPC');
  });

  it('returns unknown when fundingStrategy is missing', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: 'c1',
            campaignName: 'No strategy',
            campaignStatus: 'RUNNING',
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows[0].fundingModel).toBe('unknown');
  });

  it('converts bidPercentage string to number', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: 'c1',
            campaignName: 'Bid Campaign',
            campaignStatus: 'RUNNING',
            fundingStrategy: {
              adRateStrategy: 'FIXED',
              bidPercentage: '2.5',
              fundingModel: 'COST_PER_SALE',
            },
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows[0].bidPercentage).toBe(2.5);
  });

  it('converts dailyBudget string to number', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: 'c1',
            campaignName: 'Budget Campaign',
            campaignStatus: 'RUNNING',
            budget: {
              daily: {
                amount: { value: '10.5', currency: 'USD' },
              },
            },
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows[0].dailyBudget).toBe(10.5);
  });

  it('sets channels to null when absent', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: 'c1',
            campaignName: 'No channels',
            campaignStatus: 'RUNNING',
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows[0].channels).toBeNull();
  });

  it('sets channels to JSON stringified array', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: 'c1',
            campaignName: 'With channels',
            campaignStatus: 'RUNNING',
            channels: ['ON_SITE', 'OFF_SITE'],
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows[0].channels).toBe('["ON_SITE","OFF_SITE"]');
  });

  it('converts dates using new Date()', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: 'c1',
            campaignName: 'Dated campaign',
            campaignStatus: 'RUNNING',
            startDate: '2025-01-01T12:00:00.000Z',
            endDate: '2025-01-08T12:00:00.000Z',
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows[0].startDate).toEqual(new Date('2025-01-01T12:00:00.000Z'));
    expect(rows[0].endDate).toEqual(new Date('2025-01-08T12:00:00.000Z'));
  });

  it('sets dates to null when absent', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: 'c1',
            campaignName: 'No dates',
            campaignStatus: 'RUNNING',
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows[0].startDate).toBeNull();
    expect(rows[0].endDate).toBeNull();
  });

  it('uses campaignId as default when campaignName is absent', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: 'c123',
            campaignStatus: 'RUNNING',
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows[0].campaignName).toBe('c123');
  });

  it('uses UNKNOWN as default when campaignStatus is absent', async () => {
    const client = fakeClient([
      {
        campaigns: [
          {
            campaignId: 'c1',
            campaignName: 'Campaign name',
          },
        ],
      },
    ]);

    const rows = await fetchAdCampaigns({ client: client as never });

    expect(rows[0].campaignStatus).toBe('UNKNOWN');
  });
});
