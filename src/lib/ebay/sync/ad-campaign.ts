/**
 * Fetches Promoted Listings campaigns from the Marketing API.
 *
 * The `client` passed in must be pointed at the main eBay API base URL
 * (`api.ebay.com`). `run-ads.ts` builds that client.
 *
 * Paginates via the `next` link, advancing `offset` by the page limit until
 * a page has fewer than `limit` campaigns or no `campaigns` array.
 */

import type { EbayClient } from '../client';

export interface MappedAdCampaign {
  campaignId: string;
  campaignName: string;
  fundingModel: 'CPS' | 'CPC' | 'unknown';
  campaignStatus: string;
  channels: string | null;
  targetingType: string | null;
  dailyBudget: number | null;
  budgetCurrency: string | null;
  bidPercentage: number | null;
  startDate: Date | null;
  endDate: Date | null;
}

const PAGE_LIMIT = 100;

interface RawPage {
  campaigns?: Array<{
    campaignId: string;
    campaignName?: string;
    campaignStatus?: string;
    campaignTargetingType?: string;
    channels?: string[];
    budget?: {
      daily?: {
        amount?: {
          value?: string;
          currency?: string;
        };
      };
    };
    fundingStrategy?: {
      fundingModel?: string;
      bidPercentage?: string;
      adRateStrategy?: string;
    };
    startDate?: string;
    endDate?: string;
  }>;
  next?: string;
}

export async function fetchAdCampaigns(options: { client: EbayClient }): Promise<MappedAdCampaign[]> {
  const { client } = options;

  const rows: MappedAdCampaign[] = [];
  let offset = 0;

  for (;;) {
    const page = ((await client.get('/sell/marketing/v1/ad_campaign', {
      query: { limit: PAGE_LIMIT, offset },
    })) ?? {}) as RawPage;

    for (const campaign of page.campaigns ?? []) {
      // Map fundingModel
      let fundingModel: 'CPS' | 'CPC' | 'unknown' = 'unknown';
      if (campaign.fundingStrategy?.fundingModel === 'COST_PER_SALE') {
        fundingModel = 'CPS';
      } else if (campaign.fundingStrategy?.fundingModel === 'COST_PER_CLICK') {
        fundingModel = 'CPC';
      }

      // Extract dailyBudget and budgetCurrency
      const dailyBudget = campaign.budget?.daily?.amount?.value
        ? Number(campaign.budget.daily.amount.value)
        : null;
      const budgetCurrency = campaign.budget?.daily?.amount?.currency ?? null;

      // Extract bidPercentage
      const bidPercentage = campaign.fundingStrategy?.bidPercentage
        ? Number(campaign.fundingStrategy.bidPercentage)
        : null;

      // Stringify channels or set to null
      const channels = campaign.channels ? JSON.stringify(campaign.channels) : null;

      // Parse dates or set to null
      const startDate = campaign.startDate ? new Date(campaign.startDate) : null;
      const endDate = campaign.endDate ? new Date(campaign.endDate) : null;

      rows.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName ?? campaign.campaignId,
        fundingModel,
        campaignStatus: campaign.campaignStatus ?? 'UNKNOWN',
        channels,
        targetingType: campaign.campaignTargetingType ?? null,
        dailyBudget,
        budgetCurrency,
        bidPercentage,
        startDate,
        endDate,
      });
    }

    if (!page.next) break;
    offset += PAGE_LIMIT;
  }

  return rows;
}
