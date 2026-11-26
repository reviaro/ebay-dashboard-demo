import { reportingNow, isDemoMode } from '@/lib/demo/server';
import { loadFinanceSummary } from '@/lib/finance/summary';
import { Decimal } from '@prisma/client/runtime/library';
import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { PHASE_3_TARGETS } from '@/lib/constants';
import { loadUnifiedOrders } from '@/lib/orders/store';
import { filterOrders } from '@/lib/orders/unified';

async function handleGET() {
  try {
    const [sales, transactions, inventory] = await Promise.all([
      loadUnifiedOrders().then(rows => filterOrders(rows, {})),
      prisma.ebayTransaction.findMany({ where: { type: { not: 'Payout' } }, select: { type: true, netAmount: true, itemSubtotal: true } }),
      // The live count -- EbayOffer rows still marked active -- not the CSV
      // `Inventory` table (the union of every listing ever uploaded).
      prisma.ebayOffer.count({ where: { status: 'active' } }),
    ]);
    const demo = isDemoMode();
    const demoFinance = demo ? await loadFinanceSummary({}) : null;
    const demoLedger = demo ? await prisma.ebayFinanceTransaction.findMany({
      where: { transactionType: { not: 'TRANSFER' } },
      select: { bookingEntry: true, amount: true },
    }) : [];
    const revenue = demoFinance?.grossRevenue ?? sales.reduce((sum, sale) => sum + sale.soldFor, 0);
    const target = PHASE_3_TARGETS.REVENUE;
    const brandMap = new Map<string, { revenue: number; units: number }>();
    for (const sale of sales) {
      const current = brandMap.get(sale.brand) || { revenue: 0, units: 0 };
      current.revenue += sale.soldFor;
      current.units += sale.quantity;
      brandMap.set(sale.brand, current);
    }
    const topBrands = demoFinance
      ? demoFinance.byBrand.slice(0, 5).map(row => ({ brand: row.brand, revenue: row.grossRevenue, units: row.units }))
      : Array.from(brandMap, ([brand, values]) => ({ brand, ...values })).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    const internationalOrders = sales.filter(sale => sale.shipToCountry && sale.shipToCountry !== 'United States').length;
    const orderTransactionRevenue = demoFinance?.grossRevenue ?? transactions.filter(t => t.type === 'Order').reduce((sum, t) => sum + t.itemSubtotal, 0);
    const transactionNet = demo
      ? demoLedger.reduce((sum, row) => row.bookingEntry === 'CREDIT' ? sum.plus(row.amount) : sum.minus(row.amount), new Decimal(0)).toNumber()
      : transactions.reduce((sum, t) => sum + t.netAmount, 0);

    return NextResponse.json({
      title: 'Store performance report', generatedAt: reportingNow().toISOString(),
      sales: { revenue, orders: sales.length, items: sales.reduce((sum, sale) => sum + sale.quantity, 0), target, progressPct: target > 0 ? revenue / target * 100 : 0 },
      topBrands,
      international: { orders: internationalOrders, ratePct: sales.length ? internationalOrders / sales.length * 100 : 0 },
      inventory: { activeListings: inventory },
      transactionActivity: { orderRevenue: orderTransactionRevenue, netAfterEbayActivity: transactionNet, deductionRatePct: orderTransactionRevenue ? (orderTransactionRevenue - transactionNet) / orderTransactionRevenue * 100 : 0 },
      notes: demo ? [
        'Fictional snapshot as of 2026-09-30. Revenue includes item receipts and collected shipping exactly once.',
        'Transaction activity uses the same synthetic finance ledger as Profit & Ads. Net activity excludes inventory purchases and operating expenses.',
      ] : ['Transaction activity may cover a different date range than the sales dataset.', 'Inventory acquisition cost is excluded unless imported separately.'],
    });
  } catch (error) {
    console.error('Report error:', error);
    return NextResponse.json({ error: 'The store report could not be generated. Try again.' }, { status: 500 });
  }
}

export const GET = withStore('view', handleGET);
