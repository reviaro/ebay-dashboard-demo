/** Deterministic, entirely fictional fixtures. All currency arithmetic starts in cents. */
import type { Prisma } from '@prisma/client';
import { DEMO_DATE, DEMO_STORE_NAME } from './config';

type Fixture<T> = Omit<T, 'storeId'>;

export const DEMO_STORE = DEMO_STORE_NAME;
export const DEMO_START = '2025-10-01';
export const DEMO_AS_OF = DEMO_DATE;
export const DEMO_VERSION = 'northstar-v1';
export const DEMO_INSTANT = new Date('2026-09-30T23:59:59.000Z');
const DAY = 86_400_000;
const start = new Date(`${DEMO_START}T00:00:00.000Z`);
export const money = (cents: number) => cents / 100;
export const cents = (dollars: number) => Math.round(dollars * 100);
const fixed = (value: number) => money(value).toFixed(2);
const pad = (value: number, width = 4) => String(value).padStart(width, '0');
const json = (value: unknown) => JSON.stringify(value);
const stamp = { createdAt: DEMO_INSTANT, updatedAt: DEMO_INSTANT };
const created = { createdAt: DEMO_INSTANT };
export const DEMO_UNSOLD = new Set([7, 19, 31, 43, 55, 59]);

const vehicles = [
  ['Volvo', 'XC90', '2007–2014'], ['Toyota', 'Camry', '2012–2017'],
  ['Honda', 'Accord', '2013–2017'], ['Ford', 'F-150', '2009–2014'],
  ['Chevrolet', 'Silverado', '2007–2013'], ['Subaru', 'Outback', '2010–2014'],
  ['BMW', '3 Series', '2006–2011'], ['Mercedes-Benz', 'C-Class', '2008–2014'],
  ['Audi', 'A4', '2009–2016'], ['Volkswagen', 'Golf', '2010–2014'],
];
const parts = [
  ['Window Switch', 3495], ['Side Mirror', 8995], ['Climate Control Panel', 12495],
  ['Headlight Assembly', 22995], ['Interior Door Handle', 2495], ['Engine Control Module', 15995],
  ['Tail Light Assembly', 7995], ['Seat Adjustment Switch', 4495], ['Radio Control Unit', 11995],
  ['Grille Trim', 5495], ['Cup Holder Insert', 1895], ['ABS Pump Assembly', 39995],
] as const;

export function demoListings() {
  return Array.from({ length: 60 }, (_, index) => {
    const [brand, model, years] = vehicles[Math.floor(index / 6)];
    const [part, basePrice] = parts[(index + Math.floor(index / 6) * 3) % parts.length];
    const priceCents = index === 47 ? 58995 : basePrice + (index % 3) * 500;
    const unitCost = Math.round(priceCents * (0.23 + (index % 4) * 0.025));
    return {
      index, listingId: `DEMO-LIST-${pad(index + 1)}`, sku: `DEMO-SKU-${pad(index + 1)}`,
      title: `${years} ${brand} ${model} OEM ${part} [DEMO]`, brand,
      partNumber: `DEMO-PART-${pad(index + 1)}`, priceCents, costCents: unitCost,
      status: [52, 58].includes(index) ? 'sold' : [53, 57].includes(index) ? 'ended' : 'active',
      quantity: [52, 53, 57, 58].includes(index) ? 0 : 1 + index % 5,
      createdAt: start,
    };
  });
}

export function buildDemoData() {
  const listings = demoListings();
  const sales: Fixture<Prisma.SaleCreateManyInput>[] = [];
  const orders: Fixture<Prisma.EbayOrderCreateManyInput>[] = [];
  const transactions: Fixture<Prisma.EbayTransactionCreateManyInput>[] = [];
  const finance: Fixture<Prisma.EbayFinanceTransactionCreateManyInput>[] = [];
  const payouts: Fixture<Prisma.EbayPayoutCreateManyInput>[] = [];
  const adReports: Fixture<Prisma.EbayAdReportCreateManyInput>[] = [];
  const legacyAds: Fixture<Prisma.PromotedListingMetricCreateManyInput>[] = [];
  const inventoryExpenses: Fixture<Prisma.InventoryExpenseCreateManyInput>[] = [];
  const generalExpenses: Fixture<Prisma.GeneralExpenseCreateManyInput>[] = [];
  const fees: Fixture<Prisma.EbayFeeCreateManyInput>[] = [];
  const trafficDays: Fixture<Prisma.EbayTrafficDayCreateManyInput>[] = [];
  const trafficListings: Fixture<Prisma.EbayTrafficListingCreateManyInput>[] = [];
  const campaignOf = (index: number) => index < 36 ? 0 : index < 48 ? 1 : 2;
  const campaignNames = ['DEMO Everyday OEM', 'DEMO European Specialists', 'DEMO Discovery Test'];
  const campaignIds = campaignNames.map((_, i) => `DEMO-CAMPAIGN-${i + 1}`);
  const campaigns: Fixture<Prisma.EbayAdCampaignCreateManyInput>[] = campaignNames.map((campaignName, index) => ({
    campaignId: campaignIds[index], campaignName, fundingModel: index === 2 ? 'CPC' : 'CPS',
    campaignStatus: 'RUNNING', channels: json(['ON_SITE']), targetingType: 'MANUAL',
    dailyBudget: index === 2 ? 8 : null, budgetCurrency: 'USD', bidPercentage: index === 2 ? null : 5,
    startDate: start, lastSeenAt: DEMO_INSTANT, ...created,
  }));
  const counts = [58, 64, 62, 68, 72, 85, 92, 96, 94, 105, 110, 114];
  const soldByDay = new Map<string, number>();
  const soldByListing = new Map<string, number>();
  const listingRevenue = new Map<string, number>();
  const orderRecords: { index: number; month: string; id: string; gross: number; fees: number; cost: number; ad: number; date: Date }[] = [];
  const adBuckets = new Map<string, { sales: number; units: number; spend: number; organicUnits: number }>();
  let saleId = 0;
  let randomState = 0x4e535031; // Fixed xorshift32 seed; independent of clock and machine.
  const nextIndex = (length: number) => {
    randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
    return (randomState >>> 0) % length;
  };
  const financeRow = (id: string, transactionDate: Date, transactionType: string, amountCents: number, extra: Partial<Fixture<Prisma.EbayFinanceTransactionCreateManyInput>> = {}) => {
    finance.push({ id, accountId: 'DEMO-FICTIONAL-STORE', transactionId: id, transactionDate,
      transactionType, bookingEntry: transactionType === 'SALE' ? 'CREDIT' : 'DEBIT', amount: fixed(amountCents),
      marketplaceId: 'EBAY_US', rawPayload: json({ demo: true, fixture: DEMO_VERSION }), ...stamp, ...extra });
  };
  const available = listings.filter(l => !DEMO_UNSOLD.has(l.index));
  const weighted = available.flatMap(l => Array(l.index < 18 ? 4 : l.index < 36 ? 3 : l.index < 48 ? 2 : 1).fill(l));
  for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
    const monthStart = new Date(Date.UTC(2025, 9 + monthIndex, 1));
    const monthEnd = new Date(Date.UTC(2025, 10 + monthIndex, 0));
    const month = monthStart.toISOString().slice(0, 7);
    const days = monthEnd.getUTCDate();
    for (let n = 0; n < counts[monthIndex]; n++) {
      saleId++;
      const listing = weighted[nextIndex(weighted.length)];
      // Spread sales across every month; fixed 18:00 UTC keeps Pacific reporting on the same day.
      const day = 1 + Math.floor(n * days / counts[monthIndex]);
      const date = new Date(Date.UTC(2025, 9 + monthIndex, day, 18, n % 60));
      const reportDate = new Date(Date.UTC(2025, 9 + monthIndex, day));
      const id = `DEMO-ORDER-${pad(saleId, 5)}`;
      const price = Math.round(listing.priceCents * (1 - (saleId % 5) * 0.015));
      const shipping = price >= 20000 ? 1495 : price >= 7500 ? 995 : 595;
      const gross = price + shipping;
      const tax = Math.round(gross * 0.065);
      const variable = Math.round(gross * (monthIndex < 6 ? 0.127 : 0.132));
      const perOrder = monthIndex < 6 ? 30 : 40;
      const regulatory = Math.round(gross * 0.003);
      const international = saleId % 17 === 0 ? Math.round(gross * 0.016) : 0;
      const saleFees = variable + perOrder + regulatory + international;
      const promoted = saleId % 5 < 2;
      const ad = promoted && campaignOf(listing.index) !== 2 ? Math.round(price * 0.05) : 0;
      const shippingLabel = shipping - 100;
      const returned = saleId % 25 === 0;
      const refundDate = new Date(Math.min(date.getTime() + 5 * DAY, DEMO_INSTANT.getTime()));
      const feeDetails = json([
        { feeType: 'FINAL_VALUE_FEE', amount: fixed(variable) },
        { feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: fixed(perOrder) },
        { feeType: 'REGULATORY_OPERATING_FEE', amount: fixed(regulatory) },
        ...(international ? [{ feeType: 'INTERNATIONAL_FEE', amount: fixed(international) }] : []),
      ]);
      const country = saleId % 17 === 0 ? 'Canada' : saleId % 29 === 0 ? 'United Kingdom' : 'United States';
      const states = ['California', 'Texas', 'Florida', 'New York', 'Washington', 'Pennsylvania', 'Ohio'];
      sales.push({ id: saleId, recordNumber: saleId, orderNumber: id, sourceKey: `DEMO-SALE-${pad(saleId, 5)}`,
        saleDate: reportDate, itemTitle: listing.title, brand: listing.brand, itemNumber: listing.listingId,
        soldFor: money(price), shipping: money(shipping), eBayTax: money(tax), totalPrice: money(gross + tax),
        shipToCountry: country, shipToState: country === 'United States' ? states[saleId % states.length] : null,
        promoted, quantity: 1, ...created });
      orders.push({ id, creationDate: date, lastModifiedDate: returned ? refundDate : date,
        orderFulfillmentStatus: 'FULFILLED', orderPaymentStatus: returned ? 'FULLY_REFUNDED' : 'PAID',
        sellerId: null, buyerUsername: null, buyerEmail: null,
        pricingSummary: json({ total: money(gross + tax), subtotal: money(price), delivery: money(shipping), tax: money(tax), currency: 'USD' }),
        totalAmount: money(gross + tax), currency: 'USD', ebayFees: money(saleFees), finalValueFee: money(variable + perOrder),
        internationalFee: money(international), adFee: money(ad), tax: money(tax), netProceeds: money(gross - saleFees),
        lineItems: json([{ lineItemId: `DEMO-LINE-${pad(saleId, 5)}`, legacyItemId: listing.listingId, title: listing.title, quantity: 1, cost: money(price), soldViaAdCampaign: promoted, ebayCollectAndRemitTaxes: [{ amount: money(tax) }] }]),
        syncedAt: DEMO_INSTANT, ...stamp });
      financeRow(`DEMO-FIN-SALE-${pad(saleId, 5)}`, date, 'SALE', gross - saleFees, { orderId: id, feeDetails });
      financeRow(`DEMO-FIN-SHIP-${pad(saleId, 5)}`, date, 'SHIPPING_LABEL', shippingLabel, { orderId: id });
      transactions.push({ id: transactions.length + 1, transactionKey: `DEMO-TXN-SALE-${pad(saleId, 5)}`, transactionDate: date,
        type: 'Order', orderNumber: id, itemId: listing.listingId, transactionId: `DEMO-TXN-SALE-${pad(saleId, 5)}`,
        itemTitle: listing.title, quantity: 1, itemSubtotal: money(price), shipping: money(shipping), tax: money(tax),
        finalValueFeeFixed: -money(perOrder), finalValueFeeVariable: -money(variable), regulatoryFee: -money(regulatory),
        internationalFee: -money(international), grossAmount: money(gross), netAmount: money(gross - saleFees),
        description: 'DEMO synthetic sale; no buyer identity', ...created });
      transactions.push({ id: transactions.length + 1, transactionKey: `DEMO-TXN-SHIP-${pad(saleId, 5)}`, transactionDate: date,
        type: 'Shipping label', orderNumber: id, netAmount: -money(shippingLabel), description: 'DEMO synthetic postage', ...created });
      if (returned) {
        financeRow(`DEMO-FIN-REFUND-${pad(saleId, 5)}`, refundDate, 'REFUND', gross, { orderId: id });
        transactions.push({ id: transactions.length + 1, transactionKey: `DEMO-TXN-REFUND-${pad(saleId, 5)}`, transactionDate: refundDate,
          type: 'Refund', orderNumber: id, itemId: listing.listingId, grossAmount: -money(gross), netAmount: -money(gross),
          description: 'DEMO fictional return: fitment mismatch; full item and shipping refund', ...created });
      }
      const key = `${month}|${listing.listingId}`;
      const bucket = adBuckets.get(key) ?? { sales: 0, units: 0, spend: 0, organicUnits: 0 };
      if (promoted) { bucket.sales += price; bucket.units++; bucket.spend += ad; } else bucket.organicUnits++;
      adBuckets.set(key, bucket);
      const dayKey = `${reportDate.toISOString().slice(0, 10)}|${listing.listingId}`;
      soldByDay.set(dayKey, (soldByDay.get(dayKey) ?? 0) + 1);
      soldByListing.set(listing.listingId, (soldByListing.get(listing.listingId) ?? 0) + 1);
      listingRevenue.set(listing.listingId, (listingRevenue.get(listing.listingId) ?? 0) + gross);
      orderRecords.push({ index: listing.index, month, id, gross, fees: saleFees, cost: listing.costCents, ad, date });
    }
    let monthAd = 0;
    for (const listing of listings) {
      const campaign = campaignOf(listing.index);
      const bucket = adBuckets.get(`${month}|${listing.listingId}`) ?? { sales: 0, units: 0, spend: 0, organicUnits: 0 };
      const clicks = 8 + (listing.index * 11 + monthIndex * 7) % 48 + bucket.units * 4;
      const impressions = clicks * (23 + listing.index % 12);
      const spend = campaign === 2 ? clicks * (44 + monthIndex) : bucket.spend;
      monthAd += spend;
      const common = { reportStart: monthStart, reportEnd: monthEnd, campaignId: campaignIds[campaign], campaignName: campaignNames[campaign], campaignStatus: 'RUNNING', ...created };
      adReports.push({ id: adReports.length + 1, ...common, fundingModel: campaign === 2 ? 'CPC' : 'CPS', listingId: listing.listingId,
        title: listing.title, impressions, clicks, adSpend: money(spend), attributedSales: money(bucket.sales), attributedUnits: bucket.units,
        cpc: money(spend) / clicks, ctr: clicks / impressions, roas: spend ? bucket.sales / spend : 0, acos: bucket.sales ? spend / bucket.sales : 0 });
      legacyAds.push({ id: legacyAds.length + 1, ...common, itemId: listing.listingId, title: listing.title, price: money(listing.priceCents),
        quantityAvailable: listing.quantity, promotedImpressions: impressions, promotedClicks: clicks, promotedSoldQuantity: bucket.units,
        organicSoldQuantity: bucket.organicUnits, totalSoldQuantity: bucket.units + bucket.organicUnits, conversionRate: bucket.units / clicks,
        contributionRate: bucket.units / (bucket.units + bucket.organicUnits || 1), attributedSales: money(bucket.sales), adFees: money(spend),
        roas: spend ? bucket.sales / spend : 0, organicClicks: clicks * 2, organicImpressions: impressions * 2 });
    }
    const chargeDate = new Date(Date.UTC(2025, 10 + monthIndex, 0, 22));
    financeRow(`DEMO-FIN-ADS-${month}`, chargeDate, 'NON_SALE_CHARGE', monthAd, { rawPayload: json({ demo: true, feeType: 'AD_FEE', fixture: DEMO_VERSION }) });
    financeRow(`DEMO-FIN-STORE-${month}`, chargeDate, 'NON_SALE_CHARGE', 2195, { rawPayload: json({ demo: true, feeType: 'STORE_SUBSCRIPTION', fixture: DEMO_VERSION }) });
    transactions.push({ id: transactions.length + 1, transactionKey: `DEMO-TXN-ADS-${month}`, transactionDate: chargeDate, type: 'Other fee', netAmount: -money(monthAd), description: 'DEMO Promoted Listings monthly spend', ...created });
    transactions.push({ id: transactions.length + 1, transactionKey: `DEMO-TXN-STORE-${month}`, transactionDate: chargeDate, type: 'Other fee', netAmount: -21.95, description: 'DEMO store subscription', ...created });
    const monthOrders = orderRecords.filter(r => r.month === month);
    const acquisitionCost = monthOrders.reduce((sum, r) => sum + r.cost, 0) + 7500 + monthIndex * 500;
    inventoryExpenses.push({ id: monthIndex + 1, date: monthStart, vendor: 'DEMO Fictional Salvage Supply', amount: money(acquisitionCost),
      memo: 'Synthetic restocking purchases including cost of sold parts and replenishment; not an actual vendor', importKey: `DEMO-EXPENSE-${month}`, ...created });
    for (const [category, amount, description] of [['shipping-supplies', 4800 + monthIndex * 170, 'Boxes and recycled packing'], ['tools', 2700 + (monthIndex % 3) * 800, 'Workshop tools'], ['phone-internet', 4500, 'Shared business connectivity']] as const) {
      generalExpenses.push({ id: generalExpenses.length + 1, date: monthStart, category, amount: money(amount), description: `DEMO ${description}`, vendor: 'DEMO Fictional Supply Co.', ...created });
    }
    const monthFee = monthOrders.reduce((sum, r) => sum + r.fees, 0);
    fees.push({ id: monthIndex + 1, month, feeType: 'final-value', amount: money(monthFee), description: 'DEMO total sale fees; canonical finance ledger is authoritative', importKey: `DEMO-FEE-${month}`, ...created });
  }
  // Daily listing data ties exactly to the store totals, and transactions to the order ledger.
  const totals = new Map<string, { views: number; impressions: number }>();
  for (let dayIndex = 0; dayIndex < 365; dayIndex++) {
    const date = new Date(start.getTime() + dayIndex * DAY);
    const dayLabel = date.toISOString().slice(0, 10);
    const monthIndex = (date.getUTCFullYear() - 2025) * 12 + date.getUTCMonth() - 9;
    let viewsTotal = 0, impressionsTotal = 0, dayTransactions = 0, viewsSearch = 0, impressionsSearch = 0;
    for (const listing of listings) {
      if (date < listing.createdAt) continue;
      const views = 2 + ((dayIndex * 7 + listing.index * 11) % 7) + Math.floor(monthIndex / 3) + (DEMO_UNSOLD.has(listing.index) ? 6 : 0);
      const impressions = views * (29 + (listing.index + dayIndex) % 13);
      const searchViews = Math.floor(views * 0.78);
      const searchImpressions = Math.floor(impressions * 0.84);
      const transactionCount = soldByDay.get(`${dayLabel}|${listing.listingId}`) ?? 0;
      trafficListings.push({ date, marketplaceId: 'EBAY_US', listingId: listing.listingId, title: listing.title,
        impressionsSearch: searchImpressions, impressionsStore: impressions - searchImpressions, impressionsTotal: impressions,
        viewsSearch: searchViews, viewsStore: views - searchViews, viewsTotal: views, transactions: transactionCount, truncated: false, syncedAt: DEMO_INSTANT });
      viewsTotal += views; impressionsTotal += impressions; dayTransactions += transactionCount; viewsSearch += searchViews; impressionsSearch += searchImpressions;
      const previous = totals.get(listing.listingId) ?? { views: 0, impressions: 0 };
      totals.set(listing.listingId, { views: previous.views + views, impressions: previous.impressions + impressions });
    }
    trafficDays.push({ date, marketplaceId: 'EBAY_US', impressionsSearch, impressionsStore: impressionsTotal - impressionsSearch, impressionsTotal,
      viewsSearch, viewsStore: viewsTotal - viewsSearch, viewsDirect: 0, viewsOtherEbay: 0, viewsOffEbay: 0, viewsTotal,
      transactions: dayTransactions, reportUpdatedAt: DEMO_INSTANT, syncedAt: DEMO_INSTANT });
  }
  // Payouts settle all month-booked activity. No bank/account details are present.
  for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
    const payoutDate = new Date(Date.UTC(2025, 10 + monthIndex, 0, 23, 59, 59));
    const month = payoutDate.toISOString().slice(0, 7);
    const rows = finance.filter(r => (r.transactionDate as Date).toISOString().startsWith(month));
    const amount = rows.reduce((sum, r) => sum + (r.transactionType === 'SALE' ? 1 : -1) * cents(Number(r.amount)), 0);
    const id = `DEMO-PAYOUT-${month}`;
    for (const row of rows) row.payoutId = id;
    payouts.push({ id, accountId: 'DEMO-FICTIONAL-STORE', payoutDate, payoutStatus: 'SUCCEEDED', amount: fixed(amount), transactionCount: rows.length,
      rawPayload: json({ demo: true, fixture: DEMO_VERSION, note: 'Synthetic monthly settlement; no bank or seller account' }), ...stamp });
    transactions.push({ id: transactions.length + 1, transactionKey: `DEMO-TXN-PAYOUT-${month}`, transactionDate: payoutDate, type: 'Payout', grossAmount: money(amount), netAmount: -money(amount), description: 'DEMO fictional settlement', ...created });
  }
  const inventory: Fixture<Prisma.InventoryCreateManyInput>[] = listings.map(l => ({ id: l.index + 1, itemId: l.listingId, sku: l.sku, title: l.title, brand: l.brand,
    partNumber: l.partNumber, condition: 'Used — tested (synthetic)', price: money(l.priceCents), cost: money(l.costCents), quantity: l.quantity,
    location: `DEMO Shelf ${String.fromCharCode(65 + Math.floor(l.index / 12))}-${pad(l.index % 12 + 1, 2)}`,
    views: totals.get(l.listingId)?.views ?? 0, watchers: DEMO_UNSOLD.has(l.index) ? 18 + l.index % 9 : 1 + l.index % 14,
    pulledAt: l.createdAt, soldAt: l.status === 'sold' ? DEMO_INSTANT : null, createdAt: l.createdAt }));
  const offers: Fixture<Prisma.EbayOfferCreateManyInput>[] = listings.map(l => ({ id: l.index + 1, listingId: l.listingId, sku: l.sku, price: money(l.priceCents), quantity: l.quantity,
    status: l.status, currency: 'USD', lastSeenAt: DEMO_INSTANT, syncedAt: DEMO_INSTANT, ...stamp }));
  const performance: Fixture<Prisma.PerformanceMetricCreateManyInput>[] = listings.map(l => {
    const total = totals.get(l.listingId)!; const sold = soldByListing.get(l.listingId) ?? 0; const revenue = listingRevenue.get(l.listingId) ?? 0;
    return { id: l.index + 1, date: DEMO_INSTANT, itemId: l.listingId, revenue: money(revenue), salesCount: sold,
      averageSalePrice: sold ? money(revenue) / sold : 0, cost: money(sold * l.costCents), impressions: total.impressions,
      pageViews: total.views, ctr: total.views / total.impressions, salesConversionRate: sold / total.views, topCategory: 'Auto Parts', topBrand: l.brand, ...created };
  });
  const comparisons: Fixture<Prisma.EbayPriceComparisonCreateManyInput>[] = listings.map(l => ({ id: l.index + 1, sku: l.sku, title: l.title, yourPrice: money(l.priceCents),
    minPrice: money(Math.round(l.priceCents * 0.72)), maxPrice: money(Math.round(l.priceCents * 1.14)), avgPrice: money(Math.round(l.priceCents * 0.9)),
    medianPrice: money(Math.round(l.priceCents * (DEMO_UNSOLD.has(l.index) ? 0.84 : 0.97))), competitorCount: 3 + l.index % 7,
    recommendation: DEMO_UNSOLD.has(l.index) ? 'DEMO: test a 10% price reduction and refresh photos' : 'DEMO: hold price; monitor sell-through',
    priceDiff: DEMO_UNSOLD.has(l.index) ? 16 : 3, sampleListings: '[]', checkedAt: DEMO_INSTANT }));
  const notes: Fixture<Prisma.ListingNoteCreateManyInput>[] = [...DEMO_UNSOLD].map((index, n) => ({ id: n + 1, listingId: listings[index].listingId,
    tags: json(['DEMO', 'lower price', 'bad photos']), note: `DEMO observation: ${listings[index].title} has views without a sale. Check fitment details and test a 10% lower price.`, ...created }));
  const tasks: Fixture<Prisma.TaskCreateManyInput>[] = [
    ['Review Discovery Test ad spend', 'DEMO: CPC spend with weak attributed sales. Review the cached advertising answer before changing a campaign.', 'todo', 'high', 1],
    ['Refresh six slow-moving listings', 'DEMO: add clear connector photos and fitment information for listings with views but no sales.', 'in-progress', 'high', 1],
    ['Compare Q3 brand contribution', 'DEMO: compare net sales after fees, refunds, part cost, ads and postage. Shared overhead is excluded.', 'todo', 'medium', 2],
    ['Reconcile September settlement', 'DEMO: the September payout ties to the synthetic finance ledger to the cent.', 'completed', 'medium', 1],
    ['Restock popular Toyota parts', 'DEMO: use sales history and current stock before making a sourcing decision.', 'todo', 'medium', 2],
    ['Audit fitment on refunded orders', 'DEMO: fictional return rate is close to 4%; no actual customers are represented.', 'todo', 'low', 2],
  ].map(([title, description, status, priority, phase], index) => ({ id: index + 1, title: String(title), description: String(description), status: String(status), priority: String(priority), phase: Number(phase), dueDate: new Date('2026-09-30T23:59:59.000Z'), ...stamp }));
  const uploads: Fixture<Prisma.UploadRecordCreateManyInput>[] = ['sales', 'active', 'traffic', 'transactions', 'promoted'].map((type, i) => ({ id: i + 1,
    filename: `DEMO-generated-${type}.csv`, type, rowCount: [sales.length, inventory.length, performance.length, transactions.length, legacyAds.length][i], contentHash: `DEMO-GENERATED-${type}-${DEMO_VERSION}`, ...created }));
  const syncSettings: Fixture<Prisma.EbaySyncSettingCreateManyInput>[] = ['orders', 'inventory', 'traffic', 'advertising', 'finances', 'payouts'].map((domain, index) => ({
    id: index + 1, domain, enabled: false, frequency: 'manual', lookbackDays: 365, lastRunAt: null, nextRunAt: null, ...stamp }));
  const syncLogs: Fixture<Prisma.EbaySyncLogCreateManyInput>[] = [{ id: 1, type: 'demo-seed', status: 'ok', message: 'DEMO synthetic fixtures generated locally. No live sync has run.', count: orders.length, startedAt: DEMO_INSTANT, finishedAt: DEMO_INSTANT }];
  const chats: Fixture<Prisma.ChatMessageCreateManyInput>[] = [];
  return { inventory, offers, sales, orders, transactions, finance, payouts, campaigns, adReports, legacyAds, inventoryExpenses, generalExpenses, fees,
    trafficDays, trafficListings, performance, comparisons, notes, tasks, uploads, syncSettings, syncLogs, chats };
}
export type DemoData = ReturnType<typeof buildDemoData>;
