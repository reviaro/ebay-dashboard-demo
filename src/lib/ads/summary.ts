import prisma from '@/lib/prisma';

/**
 * Promoted Listings performance (uploaded CSV → `EbayAdReport`) joined to the
 * live campaign roster (`EbayAdCampaign`, synced from `GET /ad_campaign`).
 *
 * Ad money is stored as `Float` (both tables), so this module does plain JS
 * arithmetic — the `Decimal` rule is Phase-7 finance-scoped.
 *
 * Ratios (`ctr`, `roas`, `acos`) are always re-derived from summed
 * numerators/denominators, never averaged from stored per-row ratios.
 */

export interface AdCampaignRow {
  campaignId: string;
  campaignName: string;
  fundingModel: string;
  status: string | null;
  dailyBudget: number | null;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  attributedSales: number;
  attributedUnits: number;
  roas: number;
  acos: number;
  /** true when a report row (CSV or API) covers this campaign in the window. */
  hasReportData: boolean;
}

export interface AdListingRow {
  listingId: string;
  title: string;
  campaignId: string;
  campaignName: string;
  status: string | null;
  fundingModel: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  attributedSales: number;
  attributedUnits: number;
  roas: number;
  acos: number;
  organicImpressions: number;
  organicClicks: number;
}

export interface AdWindowPoint {
  reportStart: Date;
  reportEnd: Date;
  spend: number;
  attributedSales: number;
  roas: number;
  acos: number;
}

export interface AdSummary {
  adCoverageStart: Date | null;
  impressions: number;
  clicks: number;
  ctr: number;
  cpsSpend: number;
  cpcSpend: number;
  spend: number;
  attributedSales: number;
  attributedUnits: number;
  roas: number;
  acos: number;
  runningCampaigns: number;
  byCampaign: AdCampaignRow[];
  byListing: AdListingRow[];
  byWindow: AdWindowPoint[];
  winners: AdListingRow[];
  losers: AdListingRow[];
  rosterOnly: AdCampaignRow[];
}

/** One performance row, normalized from either source. */
interface NormRow {
  reportStart: Date;
  reportEnd: Date;
  fundingModel: string;
  campaignId: string;
  campaignName: string;
  status: string | null;
  listingId: string;
  title: string;
  impressions: number;
  clicks: number;
  spend: number;
  attributedSales: number;
  attributedUnits: number;
  organicImpressions: number;
  organicClicks: number;
}

interface RosterEntry {
  campaignName: string;
  fundingModel: string;
  status: string | null;
  dailyBudget: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);

export async function loadAdSummary(opts: { from?: Date; to?: Date }): Promise<AdSummary> {
  const { from, to } = opts;

  // `EbayAdReport` rows span [reportStart, reportEnd]; the window filters on
  // `reportStart` — consistent with `byWindow` grouping and with the
  // `adCoverageStart - 1d` boundary arithmetic below.
  const reportWhere =
    from || to
      ? { reportStart: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {};

  const [campaignRows, coverageRow, reports] = await Promise.all([
    prisma.ebayAdCampaign.findMany(),
    prisma.ebayAdReport.findFirst({ orderBy: { reportStart: 'asc' }, select: { reportStart: true } }),
    prisma.ebayAdReport.findMany({ where: reportWhere }),
  ]);

  const adCoverageStart: Date | null = coverageRow?.reportStart ?? null;

  const roster = new Map<string, RosterEntry>();
  for (const c of campaignRows) {
    roster.set(c.campaignId, {
      campaignName: c.campaignName,
      fundingModel: c.fundingModel,
      status: c.campaignStatus ?? null,
      dailyBudget: c.dailyBudget ?? null,
    });
  }
  const runningCampaigns = campaignRows.filter((c) => c.campaignStatus === 'RUNNING').length;

  // The roster's funding model wins over a row's stored value; a campaign not in
  // the roster keeps its stored model, defaulting to 'unknown'.
  const fundingOf = (campaignId: string, stored: string | null | undefined): string =>
    roster.get(campaignId)?.fundingModel ?? stored ?? 'unknown';

  const rows: NormRow[] = reports.map((r) => ({
    reportStart: r.reportStart,
    reportEnd: r.reportEnd,
    fundingModel: fundingOf(r.campaignId, r.fundingModel),
    campaignId: r.campaignId,
    campaignName: roster.get(r.campaignId)?.campaignName ?? r.campaignName,
    status: roster.get(r.campaignId)?.status ?? r.campaignStatus ?? null,
    listingId: r.listingId,
    title: r.title,
    impressions: r.impressions,
    clicks: r.clicks,
    spend: r.adSpend,
    attributedSales: r.attributedSales,
    attributedUnits: r.attributedUnits,
    organicImpressions: 0,
    organicClicks: 0,
  }));

  // CSV fallback: the pre-`adCoverageStart` sub-span only. Skipped entirely when
  // the requested window starts on/after coverage begins.
  if (!adCoverageStart || !from || from < adCoverageStart) {
    const csvUpper = adCoverageStart
      ? to && to.getTime() < adCoverageStart.getTime() - DAY_MS
        ? to
        : new Date(adCoverageStart.getTime() - DAY_MS)
      : to;
    const csvWhere =
      from || csvUpper
        ? { reportStart: { ...(from ? { gte: from } : {}), ...(csvUpper ? { lte: csvUpper } : {}) } }
        : {};
    const legacy = await prisma.promotedListingMetric.findMany({ where: csvWhere });
    for (const m of legacy) {
      rows.push({
        reportStart: m.reportStart,
        reportEnd: m.reportEnd,
        fundingModel: roster.get(m.campaignId)?.fundingModel ?? 'CPS',
        campaignId: m.campaignId,
        campaignName: roster.get(m.campaignId)?.campaignName ?? m.campaignName,
        status: roster.get(m.campaignId)?.status ?? m.campaignStatus ?? null,
        listingId: m.itemId,
        title: m.title,
        impressions: m.promotedImpressions,
        clicks: m.promotedClicks,
        spend: m.adFees,
        attributedSales: m.attributedSales,
        attributedUnits: m.promotedSoldQuantity,
        organicImpressions: m.organicImpressions,
        organicClicks: m.organicClicks,
      });
    }
  }

  // ---- totals -------------------------------------------------------------
  const impressions = sum(rows, (r) => r.impressions);
  const clicks = sum(rows, (r) => r.clicks);
  const spend = sum(rows, (r) => r.spend);
  const attributedSales = sum(rows, (r) => r.attributedSales);
  const attributedUnits = sum(rows, (r) => r.attributedUnits);
  const cpsSpend = sum(rows.filter((r) => r.fundingModel === 'CPS'), (r) => r.spend);
  const cpcSpend = sum(rows.filter((r) => r.fundingModel === 'CPC'), (r) => r.spend);

  // ---- byCampaign ------------------------------------------------------------
  const campaignAgg = new Map<string, NormRow[]>();
  for (const r of rows) push(campaignAgg, r.campaignId, r);

  const byCampaign: AdCampaignRow[] = [];
  for (const [campaignId, group] of campaignAgg) {
    const entry = roster.get(campaignId);
    byCampaign.push(
      campaignRow(campaignId, entry, group, group[0].campaignName, group[0].fundingModel, group[0].status, true),
    );
  }
  for (const c of campaignRows) {
    if (campaignAgg.has(c.campaignId)) continue;
    byCampaign.push(
      campaignRow(
        c.campaignId,
        roster.get(c.campaignId),
        [],
        c.campaignName,
        c.fundingModel,
        c.campaignStatus ?? null,
        false,
      ),
    );
  }
  byCampaign.sort((a, b) => b.attributedSales - a.attributedSales || b.spend - a.spend);

  // ---- byListing -----------------------------------------------------------
  const listingAgg = new Map<string, NormRow[]>();
  for (const r of rows) push(listingAgg, r.listingId, r);

  const byListing: AdListingRow[] = [];
  for (const [listingId, group] of listingAgg) {
    // Attribute the listing to whichever of its rows spent the most.
    const lead = [...group].sort((a, b) => b.spend - a.spend)[0];
    const gSpend = sum(group, (r) => r.spend);
    const gSales = sum(group, (r) => r.attributedSales);
    const gImpr = sum(group, (r) => r.impressions);
    const gClicks = sum(group, (r) => r.clicks);
    byListing.push({
      listingId,
      title: lead.title,
      campaignId: lead.campaignId,
      campaignName: lead.campaignName,
      status: lead.status,
      fundingModel: lead.fundingModel,
      impressions: gImpr,
      clicks: gClicks,
      ctr: ratio(gClicks, gImpr),
      spend: gSpend,
      attributedSales: gSales,
      attributedUnits: sum(group, (r) => r.attributedUnits),
      roas: ratio(gSales, gSpend),
      acos: ratio(gSpend, gSales),
      organicImpressions: sum(group, (r) => r.organicImpressions),
      organicClicks: sum(group, (r) => r.organicClicks),
    });
  }
  byListing.sort((a, b) => b.spend - a.spend);

  // ---- byWindow ----------------------------------------------------------
  const windowAgg = new Map<string, NormRow[]>();
  for (const r of rows) push(windowAgg, `${r.reportStart.toISOString()}|${r.reportEnd.toISOString()}`, r);
  const byWindow: AdWindowPoint[] = [...windowAgg.values()]
    .map((group) => {
      const wSpend = sum(group, (r) => r.spend);
      const wSales = sum(group, (r) => r.attributedSales);
      return {
        reportStart: group[0].reportStart,
        reportEnd: group[0].reportEnd,
        spend: wSpend,
        attributedSales: wSales,
        roas: ratio(wSales, wSpend),
        acos: ratio(wSpend, wSales),
      };
    })
    .sort((a, b) => a.reportStart.getTime() - b.reportStart.getTime() || a.reportEnd.getTime() - b.reportEnd.getTime());

  const winners = byListing
    .filter((r) => r.attributedSales > 0)
    .sort((a, b) => b.roas - a.roas)
    .slice(0, 10);
  const losers = byListing
    .filter((r) => r.spend > 0 && r.attributedSales === 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);
  const rosterOnly = byCampaign.filter((c) => !c.hasReportData && c.status === 'RUNNING');

  return {
    adCoverageStart,
    impressions,
    clicks,
    ctr: ratio(clicks, impressions),
    cpsSpend,
    cpcSpend,
    spend,
    attributedSales,
    attributedUnits,
    roas: ratio(attributedSales, spend),
    acos: ratio(spend, attributedSales),
    runningCampaigns,
    byCampaign,
    byListing,
    byWindow,
    winners,
    losers,
    rosterOnly,
  };
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

function campaignRow(
  campaignId: string,
  entry: RosterEntry | undefined,
  group: NormRow[],
  fallbackName: string,
  fallbackFunding: string,
  fallbackStatus: string | null,
  hasReportData: boolean,
): AdCampaignRow {
  const impressions = sum(group, (r) => r.impressions);
  const clicks = sum(group, (r) => r.clicks);
  const spend = sum(group, (r) => r.spend);
  const attributedSales = sum(group, (r) => r.attributedSales);
  return {
    campaignId,
    campaignName: entry?.campaignName ?? fallbackName,
    fundingModel: entry?.fundingModel ?? fallbackFunding,
    status: entry?.status ?? fallbackStatus,
    dailyBudget: entry?.dailyBudget ?? null,
    impressions,
    clicks,
    ctr: ratio(clicks, impressions),
    spend,
    attributedSales,
    attributedUnits: sum(group, (r) => r.attributedUnits),
    roas: ratio(attributedSales, spend),
    acos: ratio(spend, attributedSales),
    hasReportData,
  };
}
