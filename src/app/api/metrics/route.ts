import { reportingNow, isDemoMode } from '@/lib/demo/server';
import { demoMarketGeography } from '@/lib/demo/market-aggregates';
import { loadUnifiedInventory } from '@/lib/inventory/store';
import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { normalizeBrand } from '@/lib/brand-normalizer';
import { loadUnifiedOrders } from '@/lib/orders/store';
import { filterOrders } from '@/lib/orders/unified';
import { loadFinanceSummary } from '@/lib/finance/summary';

async function handleGET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const monthStr = searchParams.get('month');
    const yearStr = searchParams.get('year');
    const period = searchParams.get('period') || 'all';

    let startDate: Date | undefined;
    let endDate: Date | undefined;

    const now = reportingNow();

    if (monthStr && yearStr) {
      const month = parseInt(monthStr);
      const year = parseInt(yearStr);
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0, 23, 59, 59, 999);
    } else if (period === 'last30') {
      startDate = reportingNow();
      startDate.setDate(now.getDate() - 30);
    } else if (period === 'last90') {
      startDate = reportingNow();
      startDate.setDate(now.getDate() - 90);
    } else if (period === 'this-year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else if (period === 'last-year') {
      startDate = new Date(now.getFullYear() - 1, 0, 1);
      endDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
    }

    if (isDemoMode()) {
      // Reporting windows use UTC day labels regardless of the host time zone.
      endDate = now;
      if (monthStr && yearStr) {
        startDate = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
        endDate = new Date(Date.UTC(Number(yearStr), Number(monthStr), 1) - 1);
      } else if (period === 'last30' || period === 'last90') {
        const days = period === 'last30' ? 30 : 90;
        startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1));
      } else if (period === 'this-year' || period === 'last-year') {
        const year = now.getUTCFullYear() - (period === 'last-year' ? 1 : 0);
        startDate = new Date(Date.UTC(year, 0, 1));
        endDate = new Date(Date.UTC(year + 1, 0, 1) - 1);
      }
    }

    const dateFilter = startDate ? {
      gte: startDate,
      ...(endDate ? { lte: endDate } : {})
    } : undefined;

    // --- Money: real eBay Finances data (Phase 7), shared with /api/profitability ---
    const finance = await loadFinanceSummary({ from: startDate, to: endDate });

    // --- Sales data: CSV exports and API orders merged into one list ---
    // Where an order exists in both sources the API row wins, so these totals
    // follow eBay rather than the export. See src/lib/orders/unified.ts.
    const unifiedOrders = await loadUnifiedOrders();
    const allSales = filterOrders(unifiedOrders, {
      ...(startDate ? { dateFrom: startDate } : {}),
      ...(endDate ? { dateTo: endDate } : {}),
    }).sort((a, b) => a.saleDate.getTime() - b.saleDate.getTime());

    const totalOrders = allSales.length;
    const totalItems = allSales.reduce((s, r) => s + r.quantity, 0);
    const avgOrderValue = totalOrders > 0 ? finance.grossRevenue / totalOrders : 0;

    const canadaSalesCount = allSales.filter(r => r.shipToCountry === 'Canada').length;
    const ukSalesCount = allSales.filter(r => r.shipToCountry === 'United Kingdom').length;
    const intlSales = allSales.filter(r => r.shipToCountry && r.shipToCountry !== 'United States').length;
    const internationalRate = totalOrders > 0 ? (intlSales / totalOrders) * 100 : 0;

    // Per-brand money is real finance data now (Task 5) — gross / fees / refunds
    // / net / units from EbayFinanceTransaction joined to Sale.brand, top 10 by
    // gross. The old flat-percentage estimate (revenue*0.67 etc.) is gone.
    const profitPerBrand = finance.byBrand.slice(0, 10);

    // `nicheAuthority` below means "Volvo's share of units sold". Keep its old
    // definition (unified-order quantity ÷ order count); don't swap the
    // numerator to finance SALE-row counts, which count a different population.
    const volvoUnits = allSales
      .filter(r => normalizeBrand(r.brand).toLowerCase() === 'volvo')
      .reduce((s, r) => s + r.quantity, 0);

    // Monthly sales aggregation
    const monthMap: Record<string, { month: string; label: string; orders: number; items: number; revenue: number; shipping: number; tax: number }> = {};
    allSales.forEach(r => {
      const key = r.saleDate.toISOString().substring(0, 7); // YYYY-MM
      if (!monthMap[key]) {
        const d = new Date(key + '-01');
        // Key is UTC (toISOString); read the label from UTC too, or a host
        // behind UTC labels it the previous month. Matches the traffic roll-up.
        const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
        monthMap[key] = { month: key, label, orders: 0, items: 0, revenue: 0, shipping: 0, tax: 0 };
      }
      monthMap[key].orders += 1;
      monthMap[key].items += r.quantity;
      monthMap[key].revenue += r.soldFor;
      monthMap[key].shipping += r.shipping;
      monthMap[key].tax += r.eBayTax;
    });
    // Union the sales months with the finance months, and take each month's
    // revenue from finance (gross) so the dashboard chart ties to /profitability.
    // A finance month with no matching CSV sales still shows, with 0 orders.
    const financeGrossByMonth = new Map<string, number>(
      finance.byMonth.map(m => [m.month, m.grossRevenue] as [string, number])
    );
    const monthKeys = new Set<string>([...Object.keys(monthMap), ...finance.byMonth.map(m => m.month)]);
    const monthlySales = [...monthKeys].sort().map(key => {
      const base = monthMap[key] ?? (() => {
        const d = new Date(key + '-01');
        return {
          month: key,
          label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
          orders: 0, items: 0, revenue: 0, shipping: 0, tax: 0,
        };
      })();
      const gross = financeGrossByMonth.get(key) ?? 0;
      return { ...base, revenue: gross, avgOrderValue: base.orders > 0 ? gross / base.orders : 0 };
    });

    // Seasonal trends (for existing chart compatibility)
    const seasonalTrends = monthlySales.map(m => ({
      month: m.label,
      revenue: parseFloat(m.revenue.toFixed(2)),
      volume: m.orders,
    }));

    // Best month
    const bestMonthEntry = monthlySales.length > 0
      ? monthlySales.reduce((prev, cur) => cur.revenue > prev.revenue ? cur : prev)
      : null;
    const bestMonth = bestMonthEntry?.label || null;

    // Best sellers (by item title, aggregated)
    const itemMap: Record<string, { itemTitle: string; brand: string; revenue: number; orders: number }> = {};
    allSales.forEach(r => {
      const key = r.itemNumber || r.itemTitle;
      if (!itemMap[key]) itemMap[key] = { itemTitle: r.itemTitle, brand: r.brand, revenue: 0, orders: 0 };
      itemMap[key].revenue += r.soldFor;
      itemMap[key].orders += r.quantity;
    });
    const bestSellers = Object.values(itemMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map(s => ({ ...s, avgPrice: s.orders > 0 ? s.revenue / s.orders : 0 }));

    // Top states
    const stateMap: Record<string, { state: string; orders: number; revenue: number }> = {};
    allSales.forEach(r => {
      const state = r.shipToState || 'Unknown';
      if (!stateMap[state]) stateMap[state] = { state, orders: 0, revenue: 0 };
      stateMap[state].orders += 1;
      stateMap[state].revenue += r.soldFor;
    });
    const topStates = Object.values(stateMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Promoted vs organic
    const promotedSales = allSales.filter(r => r.promoted);
    const organicSales = allSales.filter(r => !r.promoted);
    const promotedStats = {
      promotedOrders: promotedSales.length,
      promotedRevenue: promotedSales.reduce((s, r) => s + r.soldFor, 0),
      organicOrders: organicSales.length,
      organicRevenue: organicSales.reduce((s, r) => s + r.soldFor, 0),
      promotedPct: totalOrders > 0 ? promotedSales.length / totalOrders : 0,
    };

    // Auto-generated insights
    const salesInsights: string[] = [];
    if (monthlySales.length >= 3 && bestMonthEntry) {
      // Compare first month to peak month
      const first = monthlySales[0];
      const peak = bestMonthEntry;
      const growthX = first.revenue > 0 ? (peak.revenue / first.revenue) : null;
      if (growthX && growthX > 1) {
        salesInsights.push(`Revenue grew ${growthX.toFixed(1)}x from ${first.label} ($${first.revenue.toFixed(0)}) to peak in ${peak.label} ($${peak.revenue.toFixed(0)})`);
      }
    }
    if (bestMonth) salesInsights.push(`${bestMonth} was the peak month`);
    if (topStates.length > 0) salesInsights.push(`${topStates[0].state} is the #1 market with ${topStates[0].orders} orders ($${topStates[0].revenue.toFixed(0)})`);
    if (promotedStats.promotedPct > 0) {
      salesInsights.push(`${(promotedStats.promotedPct * 100).toFixed(0)}% of orders via Promoted Listings`);
    }
    if (profitPerBrand.length > 0) salesInsights.push(`Top brand: ${profitPerBrand[0].brand} — $${profitPerBrand[0].grossRevenue.toFixed(0)} revenue`);

    // --- Traffic data from the eBay Analytics API tables (store-wide, per day) ---
    // Not PerformanceMetric: those uploaded CSV rows are lifetime-to-date totals
    // per listing, restated by every upload, so _sum across snapshots double
    // counts impressions. EbayTrafficDay holds daily counts, as in /api/traffic.
    const trafficDays = await prisma.ebayTrafficDay.findMany({
      where: dateFilter ? { date: dateFilter } : {},
      select: { date: true, impressionsTotal: true, viewsTotal: true, transactions: true },
    });

    // Rates are derived from the summed counts, never from stored per-row rates:
    // averaging a day of 4 impressions against one of 4,000 weights them equally.
    const rate = (part: number, whole: number) =>
      whole > 0 ? parseFloat((part / whole).toFixed(4)) : 0;

    const trafficTotals = trafficDays.reduce(
      (acc, t) => {
        acc.impressions += t.impressionsTotal;
        acc.views += t.viewsTotal;
        acc.transactions += t.transactions;
        return acc;
      },
      { impressions: 0, views: 0, transactions: 0 }
    );

    // Monthly traffic aggregation
    const trafficMonthMap: Record<string, { month: string; label: string; impressions: number; pageViews: number; transactions: number }> = {};
    trafficDays.forEach(t => {
      const key = t.date.toISOString().substring(0, 7);
      if (!trafficMonthMap[key]) {
        const d = new Date(key + '-01');
        // The key comes from toISOString (UTC); the label must read from the
        // same zone or a host behind UTC shows the previous month.
        const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
        trafficMonthMap[key] = { month: key, label, impressions: 0, pageViews: 0, transactions: 0 };
      }
      trafficMonthMap[key].impressions += t.impressionsTotal;
      trafficMonthMap[key].pageViews += t.viewsTotal;
      trafficMonthMap[key].transactions += t.transactions;
    });
    const monthlyTraffic = Object.values(trafficMonthMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(t => ({
        month: t.month,
        label: t.label,
        impressions: t.impressions,
        pageViews: t.pageViews,
        ctr: rate(t.pageViews, t.impressions),
        conversionRate: rate(t.transactions, t.pageViews),
      }));

    // --- Inventory data ---
    // Demo stock is today's active unified snapshot, independent of the sales
    // window. Use the same API price/quantity/status as /api/inventory. Keep
    // ordinary-mode CSV calculations and date filtering unchanged.
    const demoInventory = isDemoMode()
      ? (await loadUnifiedInventory()).filter(row => row.status === 'active')
      : null;
    const inventoryAgg = demoInventory ? {
      _count: { id: demoInventory.length },
      _sum: { price: demoInventory.reduce((sum, row) => sum + row.price * row.quantity, 0) },
    } : await prisma.inventory.aggregate({
      where: dateFilter ? { createdAt: dateFilter } : {},
      _count: { id: true },
      _sum: { price: true },
    });

    const inventoryByBrandRaw = demoInventory ? [] : await prisma.inventory.groupBy({
      by: ['brand'],
      where: dateFilter ? { createdAt: dateFilter } : {},
      _count: { id: true },
      _sum: { price: true },
      _avg: { price: true },
      orderBy: { _count: { id: 'desc' } },
    });

    // "Active Listings" is the live eBay count -- the EbayOffer rows the report
    // still marks active -- not `prisma.inventory` (the CSV table, which is the
    // union of every listing ever uploaded).
    const activeListings = demoInventory
      ? demoInventory.length
      : await prisma.ebayOffer.count({ where: { status: 'active' } });

    const topWatchedItems = demoInventory
      ? demoInventory.filter(row => row.watchers > 0)
        .sort((a, b) => b.watchers - a.watchers)
        .slice(0, 5)
        .map(({ title, price, views, watchers, brand }) => ({ title, price, views, watchers, brand }))
      : await prisma.inventory.findMany({
      select: { title: true, price: true, views: true, watchers: true, brand: true },
      orderBy: { watchers: 'desc' },
      take: 5,
      where: { 
        watchers: { gt: 0 },
        ...(dateFilter ? { createdAt: dateFilter } : {})
      },
    });

    const inventoryBrandMap: Record<string, { count: number; totalValue: number; totalPrice: number }> = {};
    inventoryByBrandRaw.forEach(item => {
      const brand = normalizeBrand(item.brand);
      if (!inventoryBrandMap[brand]) inventoryBrandMap[brand] = { count: 0, totalValue: 0, totalPrice: 0 };
      inventoryBrandMap[brand].count += item._count.id;
      inventoryBrandMap[brand].totalValue += item._sum.price || 0;
      inventoryBrandMap[brand].totalPrice += item._sum.price || 0;
    });
    demoInventory?.forEach(item => {
      const brand = normalizeBrand(item.brand);
      if (!inventoryBrandMap[brand]) inventoryBrandMap[brand] = { count: 0, totalValue: 0, totalPrice: 0 };
      inventoryBrandMap[brand].count += 1;
      inventoryBrandMap[brand].totalValue += item.price * item.quantity;
      inventoryBrandMap[brand].totalPrice += item.price;
    });

    const inventoryByBrand = Object.entries(inventoryBrandMap)
      .map(([brand, v]) => ({
        brand,
        count: v.count,
        totalValue: v.totalValue,
        avgPrice: v.count > 0 ? v.totalPrice / v.count : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Get all available months for the filter. Deliberately unfiltered by
    // date, and reusing the already-loaded merge rather than a second query.
    const allSaleDates = filterOrders(unifiedOrders, {})
      .sort((a, b) => b.saleDate.getTime() - a.saleDate.getTime());
    
    const periodsMap = new Map<string, { month: number; year: number; label: string }>();
    allSaleDates.forEach(s => {
      const d = s.saleDate;
      const year = isDemoMode() ? d.getUTCFullYear() : d.getFullYear();
      const month = (isDemoMode() ? d.getUTCMonth() : d.getMonth()) + 1;
      const key = `${year}-${month}`;
      if (!periodsMap.has(key)) {
        periodsMap.set(key, {
          month,
          year,
          label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', ...(isDemoMode() ? { timeZone: 'UTC' } : {}) })
        });
      }
    });
    const availablePeriods = Array.from(periodsMap.values());

    const metrics = {
      revenue: finance.grossRevenue,
      netRevenue: finance.netRevenue,
      ebayFees: finance.ebayFees,
      refunds: finance.refunds,
      byMonth: finance.byMonth,
      salesCount: totalOrders,
      totalOrders,
      totalItems,
      avgOrderValue,
      bestMonth,
      impressions: trafficTotals.impressions,
      pageViews: trafficTotals.views,
      ctr: rate(trafficTotals.views, trafficTotals.impressions),
      conversionRate: rate(trafficTotals.transactions, trafficTotals.views),
      monthlyTraffic,
      profitPerBrand,
      seasonalTrends,
      monthlySales,
      bestSellers,
      topStates,
      ...(isDemoMode() ? { geography: demoMarketGeography(allSales) } : {}),
      promotedStats,
      salesInsights,
      asp: avgOrderValue,
      nicheAuthority: volvoUnits / (totalOrders || 1),
      globalReach: ((canadaSalesCount + ukSalesCount) / (totalOrders || 1)),
      targetRegionRate: ((canadaSalesCount + ukSalesCount) / (totalOrders || 1)) * 100,
      canadaSalesCount,
      ukSalesCount,
      activeListings,
      inventoryCount: inventoryAgg._count.id || 0,
      inventoryValue: inventoryAgg._sum.price || 0,
      inventoryByBrand,
      topWatchedItems,
      availablePeriods,
      redFlags: [
        ...(finance.grossRevenue > 0 && finance.netRevenue / finance.grossRevenue < 0.75
          ? [{ type: 'FEE_REFUND_DRAG', message: 'Fees and refunds are taking more than 25% of gross revenue' }]
          : []),
      ],
    };

    return NextResponse.json({ metrics, lastUpdated: reportingNow().toISOString() });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}

async function handleDELETE() {
  try {
    const { count } = await prisma.performanceMetric.deleteMany({});
    return NextResponse.json({ success: true, deleted: count });
  } catch (error) {
    console.error('Error clearing metrics:', error);
    return NextResponse.json({ error: 'Failed to clear metrics' }, { status: 500 });
  }
}

export const GET = withStore('view', handleGET);

export const DELETE = withStore('admin', handleDELETE);
