import React, { cloneElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDemoData } from '@/lib/demo/data';
import MarketPage from './page';

type ChartProps = {
  data?: Record<string, unknown>[];
  children?: React.ReactNode;
  width?: number;
  height?: number;
};
const controls = vi.hoisted(() => ({
  demo: true,
  width: 320,
  view: 'monthly',
  stateIndex: 0,
  states: [] as unknown[],
  metrics: {} as Record<string, unknown>,
  charts: [] as ChartProps[],
  loading: false,
}));

vi.mock('@/hooks/useDashboardMetrics', () => ({
  useDashboardMetrics: () => ({ metrics: { metrics: controls.metrics }, isLoading: controls.loading }),
}));
vi.mock('@/components/DemoProvider', () => ({ useDemoMode: () => controls.demo }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = controls.stateIndex++;
      const value = index < controls.states.length ? controls.states[index]
        : initial === 'monthly' ? controls.view : initial;
      return actual.useState(value);
    },
  };
});
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children, height }: { children: ReactElement<ChartProps>; height: number }) => {
      controls.charts.push(children.props);
      return cloneElement(children, { width: controls.width, height });
    },
  };
});

// A populated, deterministic API-shaped fixture from the same fictional seed.
// The HTTP harness independently reconciles the actual route payload to SQLite.
// These tests render real React/Recharts SVG; they are NOT browser interaction,
// ResizeObserver, CSS layout, screenshot, or hydration tests.
const seed = buildDemoData();
const sum = <T,>(rows: T[], value: (row: T) => number | undefined) => rows.reduce((total, row) => total + (value(row) ?? 0), 0);
const dollars = (value: unknown) => Number(value ?? 0);
const stamp = (value: unknown) => new Date(value as string | number | Date).toISOString();
const brands = [...new Set(seed.inventory.map(row => row.brand))];
const months = [...new Set(seed.sales.map(row => stamp(row.saleDate).slice(0, 7)))];
const salesForMonth = (month: string) => seed.sales.filter(row => stamp(row.saleDate).startsWith(month));
const label = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthlySales = months.map(month => {
  const rows = salesForMonth(month);
  const revenue = sum(rows, row => dollars(row.soldFor) + dollars(row.shipping));
  return { month, label: label(month), orders: rows.length, items: rows.length, revenue, shipping: sum(rows, row => row.shipping), avgOrderValue: revenue / rows.length };
});
const profitPerBrand = brands.map(brand => {
  const rows = seed.sales.filter(row => row.brand === brand);
  const orderIds = new Set(rows.map(row => row.orderNumber));
  const orders = seed.orders.filter(row => orderIds.has(row.id));
  const grossRevenue = sum(rows, row => dollars(row.soldFor) + dollars(row.shipping));
  const ebayFees = sum(orders, row => dollars(row.ebayFees));
  const refunds = sum(seed.finance.filter(row => row.transactionType === 'REFUND' && orderIds.has(row.orderId)), row => dollars(row.amount));
  return { brand, grossRevenue, ebayFees, refunds, netRevenue: grossRevenue - ebayFees - refunds, units: rows.length };
}).sort((a, b) => b.grossRevenue - a.grossRevenue);
const bestSellers = seed.inventory.map(item => {
  const rows = seed.sales.filter(row => row.itemNumber === item.itemId);
  const revenue = sum(rows, row => row.soldFor);
  return { itemTitle: item.title, brand: item.brand, revenue, orders: rows.length, avgPrice: revenue / (rows.length || 1) };
}).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
const domesticSales = seed.sales.filter(row => row.shipToCountry === 'United States');
const states = [...new Set(domesticSales.map(row => row.shipToState))].map(state => {
  const rows = domesticSales.filter(row => row.shipToState === state);
  return { state, orders: rows.length, revenue: sum(rows, row => row.soldFor) };
}).sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);
const countries = [...new Set(seed.sales.map(row => row.shipToCountry))].map(country => {
  const rows = seed.sales.filter(row => row.shipToCountry === country);
  return { country, orders: rows.length, revenue: sum(rows, row => row.soldFor) };
}).sort((a, b) => b.orders - a.orders);
const geography = {
  states, countries, statesReached: states.length, countriesReached: countries.length,
  domesticOrders: domesticSales.length, internationalOrders: seed.sales.length - domesticSales.length,
  unknownCountryOrders: 0, topFiveDomesticOrders: sum(states.slice(0, 5), row => row.orders),
  topFiveDomesticShare: sum(states.slice(0, 5), row => row.orders) / domesticSales.length,
  topFiveDomesticShareDenominator: domesticSales.length,
};
const monthlyTraffic = months.map(month => {
  const rows = seed.trafficDays.filter(row => stamp(row.date).startsWith(month));
  const impressions = sum(rows, row => row.impressionsTotal);
  const pageViews = sum(rows, row => row.viewsTotal);
  return { month, label: label(month), impressions, pageViews, ctr: pageViews / impressions, conversionRate: salesForMonth(month).length / pageViews };
});
const byMonth = months.map(month => {
  const rows = seed.orders.filter(row => stamp(row.creationDate).startsWith(month));
  // The seed stores the combined variable/fixed fee on EbayOrder. Test the
  // chart's three independent series, with the ledger used by the HTTP test.
  const perOrderFee = sum(rows, () => month < '2026-04' ? 0.3 : 0.4);
  return { month, finalValueFee: sum(rows, row => dollars(row.finalValueFee)) - perOrderFee, perOrderFee, otherFee: sum(rows, row => dollars(row.internationalFee)) + 1 };
});
const fixtureMetrics = {
  totalOrders: seed.sales.length, salesCount: seed.sales.length,
  revenue: sum(monthlySales, row => row.revenue), ebayFees: sum(seed.orders, row => dollars(row.ebayFees)),
  monthlySales, seasonalTrends: monthlySales.map(row => ({ month: row.label, revenue: row.revenue, volume: row.orders })),
  bestMonth: 'Sep 2026', profitPerBrand, bestSellers, geography,
  topStates: [...states].sort((a, b) => b.revenue - a.revenue),
  nicheAuthority: seed.sales.filter(row => row.brand === 'Volvo').length / seed.sales.length,
  promotedStats: { promotedPct: 0.4, promotedOrders: seed.sales.filter(row => row.promoted).length },
  salesInsights: ['Seeded revenue grows across twelve reporting months.', 'Toyota and Volvo remain active fictional product lines.'],
  inventoryByBrand: brands.map(brand => {
    const rows = seed.inventory.filter(row => row.brand === brand);
    const totalValue = sum(rows, row => row.price);
    return { brand, count: rows.length, totalValue, avgPrice: totalValue / rows.length };
  }),
  topWatchedItems: [...seed.inventory].sort((a, b) => dollars(b.watchers) - dollars(a.watchers)).slice(0, 5),
  monthlyTraffic, impressions: sum(monthlyTraffic, row => row.impressions), pageViews: sum(monthlyTraffic, row => row.pageViews),
  ctr: 0.028, conversionRate: 0.008, byMonth,
};
const largest = [...seed.inventoryExpenses].sort((a, b) => b.amount - a.amount)[0];
const expenses = {
  invByMonth: seed.inventoryExpenses.map(row => ({ month: stamp(row.date).slice(0, 7), amount: row.amount })),
  invByVendor: [{ vendor: largest.vendor, total: sum(seed.inventoryExpenses, row => row.amount) }],
  totalInventoryCost: sum(seed.inventoryExpenses, row => row.amount), totalFees: fixtureMetrics.ebayFees,
  tripCount: seed.inventoryExpenses.length, hasExpenseData: true, hasFeeData: true,
  largestPurchase: { amount: largest.amount, vendor: largest.vendor, date: stamp(largest.date) },
};
const finance = {
  grossOfFees: fixtureMetrics.revenue, ebayFees: fixtureMetrics.ebayFees,
  refunds: sum(seed.finance.filter(row => row.transactionType === 'REFUND'), row => dollars(row.amount)),
  shippingLabels: sum(seed.finance.filter(row => row.transactionType === 'SHIPPING_LABEL'), row => dollars(row.amount)),
  adFees: sum(seed.adReports, row => row.adSpend), netPayout: sum(seed.payouts, row => dollars(row.amount)),
};
const overhead = sum(seed.generalExpenses, row => row.amount);
const byWindow = months.map(month => {
  const rows = seed.adReports.filter(row => stamp(row.reportStart).startsWith(month));
  const spend = sum(rows, row => row.adSpend);
  return { reportStart: `${month}-01`, spend, roas: sum(rows, row => row.attributedSales) / spend };
});
const byCampaign = seed.campaigns.map(campaign => {
  const rows = seed.adReports.filter(row => row.campaignId === campaign.campaignId);
  const spend = sum(rows, row => row.adSpend), attributedSales = sum(rows, row => row.attributedSales);
  const impressions = sum(rows, row => row.impressions), clicks = sum(rows, row => row.clicks);
  return { ...campaign, hasReportData: true, status: campaign.campaignStatus, spend, attributedSales, impressions, clicks, roas: attributedSales / spend, acos: spend / attributedSales, ctr: clicks / impressions };
});
const ads = {
  spend: sum(byWindow, row => row.spend), attributedSales: sum(seed.adReports, row => row.attributedSales),
  roas: 3, acos: 0.3, cpsSpend: 2000, cpcSpend: 300, runningCampaigns: byCampaign.length,
  byWindow, byCampaign, rosterOnly: [],
  winners: [{ listingId: 'demo-winner', title: bestSellers[0].itemTitle, attributedSales: 1000, roas: 20 }],
  losers: [{ listingId: 'demo-loser', title: seed.inventory[7].title, spend: 100, clicks: 25 }],
};
const tabs = [
  ['sales', 'Sales Performance'], ['product', 'Product & Catalog'], ['geographic', 'Geographic'],
  ['traffic', 'Traffic & Visibility'], ['inventory-supplier', 'Inventory & Supplier'],
  ['ebay-fees', 'eBay Fees'], ['profitability', 'Profitability'], ['advertising', 'Advertising'],
];
const views = [
  ['monthly', 'Monthly Revenue'], ['profit', 'By Brand'], ['trends', 'Trends'],
  ['bestsellers', 'Best Sellers'], ['inventory', 'Active Inventory'],
];
function render(tab = 'sales', view = 'monthly', width = 320, overrides: { expense?: unknown; finance?: unknown; operating?: unknown; error?: boolean } = {}) {
  controls.width = width;
  controls.view = view;
  controls.stateIndex = 0;
  controls.charts = [];
  controls.states = [tab, 'expense' in overrides ? overrides.expense : expenses, ads, 'finance' in overrides ? overrides.finance : finance, 'operating' in overrides ? overrides.operating : overhead, overrides.error ?? false];
  const html = renderToStaticMarkup(<MarketPage />);
  return { html, dom: parse(html), text: parse(html).textContent };
}
function chartAt(index = 0) { return controls.charts[index]; }
function bars(dom: ReturnType<typeof parse>, index = 0) {
  return dom.querySelectorAll('.recharts-wrapper')[index].querySelectorAll('.recharts-rectangle');
}

beforeEach(() => {
  controls.demo = true;
  controls.metrics = fixtureMetrics;
  controls.loading = false;
});

describe('original Market demo panels (React/Recharts SSR, not browser QA)', () => {
  it.each([320, 696, 1280])('keeps all eight Market tabs and five Sales views at %ipx', width => {
    const { dom, text } = render('sales', 'monthly', width);
    expect(dom.querySelectorAll('button').map(button => button.textContent)).toEqual([...tabs, ...views].map(([, title]) => title));
    expect(text).toContain('Market Analysis');
    expect(text).toContain('1020 orders');
    for (const heading of ['Market Snapshot', 'Key Insights', 'Regional Hotspots']) expect(text).toContain(heading);
    expect(text).toContain(profitPerBrand[0].brand);
    expect(text).toContain('Sep 2026');
    for (const insight of fixtureMetrics.salesInsights) expect(text).toContain(insight);
    for (const state of states) expect(text).toContain(state.state);
    expect(text).not.toMatch(/Upload CSV|No sales data|Upload your Paid/);
    expect(dom.querySelectorAll('svg.recharts-surface')).toHaveLength(1);
  });

  it.each([320, 696, 1280])('renders every brand bar and full label at %ipx in By Brand and Active Inventory', width => {
    for (const view of ['profit', 'inventory']) {
      const { dom, text } = render('sales', view, width);
      const axisLabels = dom.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value').map(node => node.textContent);
      expect(new Set(axisLabels)).toEqual(new Set(brands));
      expect(axisLabels).toHaveLength(10);
      expect(bars(dom)).toHaveLength(10);
      expect(chartAt().data).toHaveLength(10);
      expect(text).toContain(view === 'profit' ? 'Top Performer' : 'Most Watched');
    }
  });

  it.each([280, 320, 696, 1280])('preserves original shared-axis monthly and trend charts with all data at %ipx', width => {
    for (const view of ['monthly', 'trends']) {
      const { dom, text, html } = render('sales', view, width);
      expect(chartAt().data).toHaveLength(12);
      // Production uses one shared Y scale and lets Recharts choose visible
      // month ticks. Narrow panels must retain every point without forcing
      // every tick, a second scale, or a new horizontal-scroll layout.
      expect(dom.querySelectorAll('.recharts-yAxis')).toHaveLength(1);
      expect(dom.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick-value').length).toBeGreaterThan(0);
      expect(dom.querySelectorAll('.recharts-area-area')).toHaveLength(1);
      expect(dom.querySelectorAll('.recharts-line-curve')).toHaveLength(1);
      expect(dom.querySelectorAll('.recharts-line-dot')).toHaveLength(12);
      expect(html).not.toContain('min-width:624px');
      if (view === 'trends') {
        for (const tick of dom.querySelectorAll('.recharts-xAxis text')) expect(tick.getAttribute('transform') || '').not.toContain('rotate');
      }
      expect(text).toContain('Peak Month');
      expect(text).toContain(view === 'monthly' ? 'Avg Monthly' : 'Months Tracked');
      expect(chartAt().data?.map(row => row[view === 'monthly' ? 'label' : 'month'])).toEqual(monthlySales.map(row => row.label));
    }
  });

  it('renders all ten best-seller records and non-empty summary values', () => {
    const { dom, text } = render('sales', 'bestsellers');
    for (const row of bestSellers) expect(text).toContain(row.itemTitle);
    expect(dom.querySelectorAll('p[title]')).toHaveLength(11); // ten rows + top-seller summary
    expect(text).toContain('10 tracked');
    expect(text).not.toContain('N/A');
    expect(controls.charts).toHaveLength(0);
  });

  it.each([320, 696, 1280])('populates Product charts and ten item rows at %ipx', width => {
    const { dom, text } = render('product', 'monthly', width);
    expect(text).toContain('Revenue by Car Make (Top 10)');
    expect(text).toContain('Part Categories · Top 10 Best Sellers');
    expect(bars(dom)).toHaveLength(10); // catches revenue vs grossRevenue drift
    expect(dom.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value').map(node => node.textContent)).toEqual(profitPerBrand.map(row => row.brand));
    expect(dom.querySelectorAll('tbody tr')).toHaveLength(10);
    expect(dom.querySelectorAll('.recharts-pie-sector').length).toBeGreaterThan(1);
    expect(text).not.toContain('Upload Paid');
  });

  it.each([246, 316, 446, 696])('keeps the category pie and complete compact key at %ipx without changing its data', width => {
    const { dom } = render('product', 'monthly', width);
    const panel = dom.querySelector('.demo-category-pie');
    const key = panel?.querySelector('ul[aria-label="Part category revenue shares"]');
    const pie = React.Children.toArray(chartAt(1).children)[0] as ReactElement<{
      data: { name: string; revenue: number }[]; outerRadius: number;
    }>;
    const total = pie.props.data.reduce((value, category) => value + category.revenue, 0);
    expect(pie.props.outerRadius).toBe(110);
    expect(key?.querySelectorAll('li').map(node => node.textContent)).toEqual(pie.props.data.map(category =>
      `${category.name} ${(category.revenue / total * 100).toFixed(0)}%`));
    expect(key?.textContent).toContain('Climate Control / HVAC');
    expect(key?.textContent).toContain('Electrical / Modules');
    const fills = panel!.querySelectorAll('.recharts-pie-sector path').map(node => node.getAttribute('fill'));
    const swatches = key!.querySelectorAll('span[aria-hidden="true"]').map(node => node.getAttribute('style')?.split(':')[1]);
    expect(swatches).toEqual(fills);
    // Real SVG and markup only. CSS switches to this wrapping key for narrow
    // panels; this does not assert a browser-computed visibility or text box.
    expect(panel?.querySelectorAll('.recharts-pie-label-text').length).toBe(pie.props.data.length);
  });

  it('leaves ordinary-mode Product labels and markup unchanged', () => {
    controls.demo = false;
    const { dom } = render('product', 'monthly', 696);
    expect(dom.querySelector('.demo-category-pie')).toBeNull();
    expect(dom.querySelector('.demo-category-pie-key')).toBeNull();
    expect(dom.querySelectorAll('.recharts-pie-label-text').length).toBeGreaterThan(1);
  });

  it('does not print invalid shares for zero-revenue category rows', () => {
    controls.metrics = { ...fixtureMetrics, bestSellers: bestSellers.map(item => ({ ...item, revenue: 0 })) };
    const { dom } = render('product');
    const items = dom.querySelectorAll('.demo-category-pie-key li');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.textContent).toMatch(/ 0%$/);
  });

  it.each([320, 696, 1280])('uses all recorded domestic states and full labels at %ipx', width => {
    const { dom, text } = render('geographic', 'monthly', width);
    expect(text).toContain('Domestic States by Order Count');
    expect(text).toContain(`${geography.domesticOrders}`);
    expect(text).toContain(`${geography.internationalOrders}`);
    expect(text).toContain('State shares use domestic orders only');
    expect(text).toContain(`${(geography.topFiveDomesticShare * 100).toFixed(1)}%`);
    expect(chartAt().data).toEqual(states);
    expect(bars(dom)).toHaveLength(7);
    expect(dom.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value').map(node => node.textContent)).toEqual(states.map(row => row.state));
    for (const row of countries) expect(text).toContain(row.country);
    expect(text).not.toMatch(/200 orders|54%|\(sample\)|Unknown/);
  });

  it('populates both twelve-month Traffic charts and conversion funnel', () => {
    const { dom, text } = render('traffic', 'monthly', 1280);
    expect(text).toContain('Monthly Impressions & Page Views');
    expect(text).toContain('CTR & Conversion Rate Trend');
    expect(controls.charts).toHaveLength(2);
    expect(controls.charts.every(chart => chart.data?.length === 12)).toBe(true);
    expect(bars(dom)).toHaveLength(12);
    expect(dom.querySelectorAll('.recharts-line-curve')).toHaveLength(3);
    expect(text).not.toContain('No traffic data');
  });

  it('shows recorded inventory purchases, actual largest buy, and all spend charts', () => {
    const { dom, text } = render('inventory-supplier', 'monthly', 1280);
    expect(text).toContain('Largest Single Buy');
    expect(text).toContain(largest.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(text).toContain(largest.vendor);
    expect(text).not.toMatch(/40-trip|\$250\.00|Yard A|No uploaded report data/);
    expect(controls.charts).toHaveLength(3);
    expect(chartAt().data).toHaveLength(12);
    expect(chartAt(2).data).toHaveLength(12);
    expect(bars(dom, 0)).toHaveLength(12);
    expect(bars(dom, 2)).toHaveLength(12);
    expect(dom.querySelectorAll('.recharts-pie-sector')).toHaveLength(1);
  });

  it('renders the full monthly fee breakdown and all three series', () => {
    const { dom, text } = render('ebay-fees', 'monthly', 1280);
    expect(chartAt().data).toHaveLength(12);
    expect(bars(dom)).toHaveLength(36);
    for (const title of ['Total eBay Fees', 'Fees / Order', 'Final Value Fee', 'Per-Order Fee', 'Other Selling Fees']) expect(text).toContain(title);
  });

  it('reconciles displayed cash after expenses without double-counting shipping', () => {
    const { dom, text } = render('profitability', 'monthly', 1280);
    const cash = finance.netPayout - expenses.totalInventoryCost - overhead;
    expect(text).toContain(cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(text).toContain('Gross Revenue (items + shipping)');
    expect(text).toContain('Recorded Operating Expenses');
    expect(text).toContain('Cash After Recorded Expenses');
    expect(text).toContain('Cash Breakdown · Oct 2025 – Sep 2026');
    expect(text).toContain('not accounting net profit');
    expect(text).not.toMatch(/Shipping Revenue Collected|Shipping Costs \(not yet recorded\)|Est\. Net Profit/);
    expect(dom.querySelectorAll('.recharts-pie-sector')).toHaveLength(8);
  });

  it.each([{ finance: null }, { expense: null }, { operating: null }, { finance: null, error: true }])('withholds cash totals if any accounting input is missing: %j', overrides => {
    const { text, dom } = render('profitability', 'monthly', 320, overrides);
    const cash = finance.netPayout - expenses.totalInventoryCost - overhead;
    expect(text).not.toContain(cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(dom.querySelectorAll('.recharts-pie-sector')).toHaveLength(0);
    expect(text).toContain(overrides.error ? 'The cash breakdown could not be loaded' : 'Loading reconciled cash breakdown');
  });

  it('populates Advertising charts, three campaigns, winners, and wasted-spend list', () => {
    const { dom, text } = render('advertising', 'monthly', 1280);
    expect(chartAt().data).toHaveLength(12);
    expect(bars(dom)).toHaveLength(12);
    expect(chartAt().data?.map(row => row.label)).toEqual(['Oct 1', 'Nov 1', 'Dec 1', 'Jan 1', 'Feb 1', 'Mar 1', 'Apr 1', 'May 1', 'Jun 1', 'Jul 1', 'Aug 1', 'Sep 1']);
    expect(dom.querySelectorAll('tbody tr')).toHaveLength(3);
    for (const campaign of byCampaign) expect(text).toContain(campaign.campaignName);
    expect(text).toContain(ads.winners[0].title);
    expect(text).toContain(ads.losers[0].title);
    expect(text).not.toMatch(/No campaigns synced|No attributed sales|No wasted spend|campaign list is live/);
  });

  it('never restores invented geography or purchase examples when demo rows are empty', () => {
    controls.metrics = { ...fixtureMetrics, totalOrders: 0, geography: { ...geography, states: [], countries: [], domesticOrders: 0, internationalOrders: 0, statesReached: 0, countriesReached: 0, topFiveDomesticShare: 0 } };
    const geographic = render('geographic');
    expect(bars(geographic.dom)).toHaveLength(0);
    expect(geographic.text).not.toMatch(/200 orders|54%|\(sample\)|California/);
    const inventory = render('inventory-supplier', 'monthly', 320, { expense: { ...expenses, hasExpenseData: false, totalInventoryCost: 0, tripCount: 0, largestPurchase: null, invByMonth: [], invByVendor: [] } });
    expect(inventory.text).not.toMatch(/\$250\.00|40-trip|Yard A|NaN|Infinity/);
  });

  it('keeps normal mode free of sample figures and demo labels', () => {
    controls.demo = false;
    const geographic = render('geographic').text;
    expect(geographic).toContain('Total Orders');
    expect(geographic).not.toMatch(/\(sample\)|synthetic|Portfolio Demo|US, CA, GB/i);
    const inventory = render('inventory-supplier').text;
    expect(inventory).toContain('Largest Single Buy');
    expect(inventory).not.toMatch(/\(sample\)|\$250\.00|40-trip|Yard A/);
    const profit = render('profitability').text;
    expect(profit).toContain('Est. Net Profit');
    expect(profit).toContain('Annual P&L Breakdown');
    expect(profit).not.toContain('Cash After Recorded Expenses');
  });

  it('retains the original loading state until metrics are available', () => {
    controls.loading = true;
    const { dom, text } = render();
    expect(dom.querySelectorAll('button')).toHaveLength(0);
    expect(dom.querySelectorAll('.animate-spin')).toHaveLength(1);
    expect(text).not.toContain('Market Snapshot');
  });
});
