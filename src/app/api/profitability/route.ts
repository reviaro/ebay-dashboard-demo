import { isDemoMode } from '@/lib/demo/server';
import { Decimal } from '@prisma/client/runtime/library';
import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { loadFinanceSummary } from '@/lib/finance/summary';
import { loadAdSummary, type AdListingRow } from '@/lib/ads/summary';

const abs = (value: number) => Math.abs(value);

async function handleGET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const transactionWhere = (from || to) ? {
      transactionDate: {
        ...(from ? { gte: new Date(`${from}T00:00:00${isDemoMode() ? 'Z' : ''}`) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999${isDemoMode() ? 'Z' : ''}`) } : {}),
      },
    } : {};

    const fromDate = from ? new Date(`${from}T00:00:00${isDemoMode() ? 'Z' : ''}`) : undefined;
    const toDate = to ? new Date(`${to}T23:59:59.999${isDemoMode() ? 'Z' : ''}`) : undefined;

    const [transactions, finance, ads] = await Promise.all([
      prisma.ebayTransaction.findMany({ where: transactionWhere, orderBy: { transactionDate: 'asc' } }),
      loadFinanceSummary({ from: fromDate, to: toDate }),
      // Promoted Listings performance (uploaded CSV → EbayAdReport) joined to the
      // live campaign roster; replaces the inline promotedListingMetric block.
      loadAdSummary({ from: fromDate, to: toDate }),
    ]);

    // Two disjoint sources, no per-row merge (design doc §1/§4). The CSV-era
    // `EbayTransaction` rows are used only for the span *before* the earliest
    // finance transaction; from there on the finance data is authoritative.
    const financeStartsAt: Date | null = finance.coverageStart;
    const csvTransactions = financeStartsAt
      ? transactions.filter(t => t.transactionDate < financeStartsAt)
      : transactions;

    // `/api/profitability` historically named its net-of-fees figure
    // `grossRevenue`. Keep that response key; it maps to proceeds-after-fees.
    const grossRevenue = finance.proceedsAfterFees;
    const grossOfFees = finance.grossRevenue;
    const ebayFees = finance.ebayFees;
    const refunds = finance.refunds;
    const netRevenue = finance.netRevenue;

    const operatingTransactions = csvTransactions.filter(t => t.type.toLowerCase() !== 'payout');
    const orders = csvTransactions.filter(t => t.type.toLowerCase() === 'order');
    const orderRevenue = isDemoMode() ? finance.grossRevenue : orders.reduce((sum, t) => sum + t.itemSubtotal + t.shipping, 0);
    const demoLedger = isDemoMode() ? await prisma.ebayFinanceTransaction.findMany({ where: { ...transactionWhere, transactionType: { not: 'TRANSFER' } }, select: { bookingEntry: true, amount: true, transactionType: true } }) : [];

    // "Where the money went" deduction breakdown: the reconciled finance ledger
    // for the covered window, plus the CSV-era slice for the span before finance
    // coverage begins. Disjoint windows, the same two-source model as the rest
    // of the route.
    const fb = finance.feeBreakdown;
    const finalValueFees = fb.finalValue + orders.reduce((sum, t) => sum + abs(t.finalValueFeeFixed) + abs(t.finalValueFeeVariable), 0);
    const regulatoryFees = fb.regulatory + orders.reduce((sum, t) => sum + abs(t.regulatoryFee), 0);
    const penaltyFees = fb.penalties + orders.reduce((sum, t) => sum + abs(t.veryHighInadFee) + abs(t.belowStandardFee), 0);
    const internationalFees = fb.international + orders.reduce((sum, t) => sum + abs(t.internationalFee), 0);
    const shippingLabels = fb.shippingLabels + csvTransactions.filter(t => t.type.toLowerCase() === 'shipping label').reduce((sum, t) => sum + abs(t.netAmount), 0);
    const adFeesFromCsvEra = csvTransactions.filter(t => (t.description || '').toLowerCase().includes('promoted listings')).reduce((sum, t) => sum + abs(t.netAmount), 0);
    const adFees = finance.adFees + adFeesFromCsvEra;
    const otherFees = fb.other + csvTransactions.filter(t => t.type.toLowerCase() === 'other fee' && !(t.description || '').toLowerCase().includes('promoted listings')).reduce((sum, t) => sum + abs(t.netAmount), 0);
    const netPayout = isDemoMode()
      ? demoLedger.reduce((sum, row) => row.bookingEntry === 'CREDIT' ? sum.plus(row.amount) : sum.minus(row.amount), new Decimal(0)).toNumber()
      : operatingTransactions.reduce((sum, t) => sum + t.netAmount, 0);
    const totalDeductions = orderRevenue - netPayout;

    // Percentages on the profitability page; loadAdSummary returns fractions.
    const pct = (fraction: number) => fraction * 100;
    const convRate = (units: number, clicks: number) => (clicks > 0 ? (units / clicks) * 100 : 0);
    const toListing = (l: AdListingRow) => ({
      itemId: l.listingId,
      title: l.title,
      campaignName: l.campaignName,
      status: l.status,
      fundingModel: l.fundingModel,
      impressions: l.impressions,
      clicks: l.clicks,
      sold: l.attributedUnits,
      sales: l.attributedSales,
      fees: l.spend,
      roas: l.roas,
      acos: l.acos,
      ctr: pct(l.ctr),
      conversionRate: convRate(l.attributedUnits, l.clicks),
      organicImpressions: l.organicImpressions,
      organicClicks: l.organicClicks,
    });

    const campaigns = ads.byCampaign.filter(c => c.hasReportData).map(c => ({
      campaignId: c.campaignId,
      name: c.campaignName,
      status: c.status,
      fundingModel: c.fundingModel,
      dailyBudget: c.dailyBudget,
      impressions: c.impressions,
      clicks: c.clicks,
      sold: c.attributedUnits,
      sales: c.attributedSales,
      fees: c.spend,
      ctr: pct(c.ctr),
      conversionRate: convRate(c.attributedUnits, c.clicks),
      roas: c.roas,
      acos: c.acos,
    }));

    const listings = ads.byListing.map(toListing);
    const lastWindow = ads.byWindow.at(-1);

    return NextResponse.json({
      reportRange: lastWindow ? { start: lastWindow.reportStart, end: lastWindow.reportEnd } : null,
      transactionRange: transactions.length ? { start: transactions[0].transactionDate, end: transactions[transactions.length - 1].transactionDate } : null,
      financeCoverageStart: financeStartsAt,
      adCoverageStart: ads.adCoverageStart,
      financials: {
        grossRevenue, grossOfFees, ebayFees, refunds, netRevenue,
        orderRevenue, netPayout, totalDeductions, finalValueFees, regulatoryFees, penaltyFees, internationalFees, shippingLabels, adFees, otherFees, feeRate: orderRevenue > 0 ? totalDeductions / orderRevenue * 100 : 0,
        // The finance ledger is authoritative from financeCoverageStart onward;
        // CSV orders are deliberately limited to the earlier, disjoint slice.
        orders: finance.orders + orders.length,
      },
      advertising: {
        impressions: ads.impressions,
        clicks: ads.clicks,
        orders: ads.attributedUnits,
        sales: ads.attributedSales,
        spend: ads.spend,
        cpsSpend: ads.cpsSpend,
        cpcSpend: ads.cpcSpend,
        roas: ads.roas,
        acos: ads.acos,
        ctr: pct(ads.ctr),
        conversionRate: convRate(ads.attributedUnits, ads.clicks),
        runningCampaigns: ads.runningCampaigns,
      },
      campaigns,
      listings,
      actions: { wasted: ads.losers.map(toListing), winners: ads.winners.map(toListing) },
    });
  } catch (error) {
    console.error('Profitability analytics error:', error);
    return NextResponse.json({ error: 'Failed to load profitability analytics' }, { status: 500 });
  }
}

export const GET = withStore('view', handleGET);
