/** Cached answers are computed from the seeded database, never from an LLM or network. */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_AS_OF, DEMO_START, DEMO_STORE, cents, money } from '../src/lib/demo/data';
import { DEMO_QUESTIONS, DEMO_STORE_ID } from '../src/lib/demo/config';
import { assertDemoDatabasePath, validateDemoManifest, DEMO_PROJECT_ROOT } from '../src/lib/demo/seed-safety';

type Row = Record<string, string | number | bigint | null>;
type ReadDatabase = { prepare(sql: string): { all(...params: (string | number)[]): Row[] }; close(): void };
// Node 24 provides sqlite. Keep the small public interface compatible with this repo's Node 20 type package.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string, options: { readOnly: boolean }) => ReadDatabase };
const num = (value: unknown) => Number(value ?? 0);
const date = (value: unknown) => typeof value === 'number' || typeof value === 'bigint' ? new Date(Number(value)) : new Date(String(value));
const month = (value: unknown) => date(value).toISOString().slice(0, 7);
const feeCents = (row: Row) => (JSON.parse(String(row.feeDetails ?? '[]')) as { amount: string }[]).reduce((sum, fee) => sum + cents(Number(fee.amount)), 0);
const sumCents = (rows: Row[], field: string) => rows.reduce((sum, row) => sum + cents(num(row[field])), 0);
const usd = (value: number) => money(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(`Demo verification failed: ${message}`); };

function readSnapshot(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const read = (table: string) => db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
    return { inventory: read('Inventory'), sales: read('Sale'), orders: read('EbayOrder'), finance: read('EbayFinanceTransaction'),
      payouts: read('EbayPayout'), ads: read('EbayAdReport'), days: read('EbayTrafficDay'), listings: read('EbayTrafficListing'),
      fees: read('EbayFee'), transactions: read('EbayTransaction'), accounts: read('EbayAccount'), oauth: read('EbayOAuthState'),
      locks: read('EbaySyncLock'), chunks: read('EbaySyncChunk'), settings: read('EbaySyncSetting'),
      stores: read('Store'), drafts: read('ListingDraft'), users: read('User') };
  } finally { db.close(); }
}
type Snapshot = ReturnType<typeof readSnapshot>;

export function verifyDemoDatabase(path = assertDemoDatabasePath()) {
  const data = readSnapshot(path);
  check(data.stores.length === 1 && data.stores[0].id === DEMO_STORE_ID && !data.stores[0].writeEnabled, 'expected one read-only demo store');
  check(data.drafts.length === 3 && !data.users.length, 'expected three synthetic drafts and no accounts');
  check(data.inventory.length === 60, 'expected 60 listings');
  check(data.sales.length === 1020 && data.orders.length === 1020, 'expected 1,020 matched orders');
  check(!data.accounts.length && !data.oauth.length && !data.locks.length && !data.chunks.length, 'credential, OAuth and live-work tables must be empty');
  check(data.settings.every(row => !row.enabled && row.nextRunAt === null), 'all sync schedules must be disabled');
  check(data.orders.every(row => row.buyerUsername === null && row.buyerEmail === null && row.sellerId === null), 'buyer and seller identity must be absent');
  check(data.orders.every(row => String(row.id).startsWith('DEMO-')), 'order identities must be visibly synthetic');
  check(data.inventory.every(row => String(row.itemId).startsWith('DEMO-') && num(row.price) >= 15 && num(row.price) <= 600), 'synthetic listing IDs and price range');
  check(data.inventory.filter(row => num(row.price) < 150).length > 30, 'most inventory prices must be below $150');
  const saleRows = data.finance.filter(row => row.transactionType === 'SALE');
  const refundRows = data.finance.filter(row => row.transactionType === 'REFUND');
  const adRows = data.finance.filter(row => row.transactionType === 'NON_SALE_CHARGE' && JSON.parse(String(row.rawPayload)).feeType === 'AD_FEE');
  const labelRows = data.finance.filter(row => row.transactionType === 'SHIPPING_LABEL');
  const otherRows = data.finance.filter(row => row.transactionType === 'NON_SALE_CHARGE' && JSON.parse(String(row.rawPayload)).feeType !== 'AD_FEE');
  const fees = saleRows.reduce((sum, row) => sum + feeCents(row), 0);
  const proceeds = sumCents(saleRows, 'amount');
  const gross = proceeds + fees;
  const saleGross = data.sales.reduce((sum, row) => sum + cents(num(row.soldFor)) + cents(num(row.shipping)), 0);
  const refunds = sumCents(refundRows, 'amount');
  const ads = sumCents(adRows, 'amount');
  const postage = sumCents(labelRows, 'amount');
  const other = sumCents(otherRows, 'amount');
  const payout = sumCents(data.payouts, 'amount');
  check(saleRows.length === data.orders.length && gross === saleGross, 'order gross must tie to finance gross to the cent');
  check(ads === sumCents(data.ads, 'adSpend'), 'advertising report spend must tie to billed ad fees');
  check(fees === sumCents(data.fees, 'amount'), 'legacy fee summary must tie to sale fees');
  check(payout === gross - fees - refunds - ads - postage - other, 'gross less every deduction must equal payouts');
  check(refundRows.length / data.orders.length >= 0.03 && refundRows.length / data.orders.length <= 0.05, 'return rate must be 3–5%');
  check(data.orders.filter(row => row.orderPaymentStatus === 'FULLY_REFUNDED').length === refundRows.length, 'refund status must match refund ledger');
  for (const payoutRow of data.payouts) {
    const rows = data.finance.filter(row => row.payoutId === payoutRow.id);
    const settled = rows.reduce((sum, row) => sum + (row.transactionType === 'SALE' ? 1 : -1) * cents(num(row.amount)), 0);
    check(settled === cents(num(payoutRow.amount)) && rows.length === num(payoutRow.transactionCount), `payout ${payoutRow.id} reconciliation`);
  }
  for (const sale of data.sales) {
    const ledger = saleRows.find(row => row.orderId === sale.orderNumber);
    const order = data.orders.find(row => row.id === sale.orderNumber);
    check(!!ledger && !!order, `matching ledger and order for ${sale.orderNumber}`);
    check(cents(num(ledger!.amount)) + feeCents(ledger!) === cents(num(sale.soldFor)) + cents(num(sale.shipping)), `individual gross for ${sale.orderNumber}`);
    check(cents(num(order!.totalAmount)) === cents(num(sale.totalPrice)), `tax-inclusive total for ${sale.orderNumber}`);
  }
  check(data.days.length === 365 && data.listings.length === 60 * 365, 'full year daily traffic coverage');
  for (const day of data.days) {
    const rows = data.listings.filter(row => row.date === day.date);
    for (const key of ['impressionsTotal', 'viewsTotal', 'transactions']) {
      check(rows.reduce((sum, row) => sum + num(row[key]), 0) === num(day[key]), `daily traffic ${key} reconciliation`);
    }
  }
  check(data.days.reduce((sum, row) => sum + num(row.transactions), 0) === data.orders.length, 'traffic transactions must tie to orders');
  check(data.finance.every(row => date(row.transactionDate).toISOString().slice(0, 10) >= DEMO_START && date(row.transactionDate).toISOString().slice(0, 10) <= DEMO_AS_OF), 'finance dates must stay within fixture window');
  const legacyOperating = data.transactions.filter(row => row.type !== 'Payout');
  check(sumCents(legacyOperating, 'netAmount') === payout, 'legacy operating cash-flow mirror must match payouts');
  return { listings: data.inventory.length, orders: data.orders.length, returns: refundRows.length, returnRate: refundRows.length / data.orders.length,
    trafficDays: data.days.length, gross: money(gross), saleFees: money(fees), refunds: money(refunds), adSpend: money(ads), postage: money(postage), otherFees: money(other), payouts: money(payout), verified: true };
}

export function buildDemoAnswers(data: Snapshot) {
  const inventory = new Map(data.inventory.map(row => [String(row.itemId), row]));
  const sales = new Map(data.sales.map(row => [String(row.orderNumber), row]));
  const q3 = (value: unknown) => { const d = date(value).toISOString().slice(0, 10); return d >= '2026-07-01' && d <= DEMO_AS_OF; };
  const brandResults = new Map<string, { gross: number; costs: number; profit: number; count: number }>();
  const brand = (name: string) => {
    const found = brandResults.get(name) ?? { gross: 0, costs: 0, profit: 0, count: 0 };
    brandResults.set(name, found); return found;
  };
  for (const row of data.finance.filter(row => q3(row.transactionDate))) {
    const sale = sales.get(String(row.orderId));
    if (!sale) continue;
    const bucket = brand(String(sale.brand));
    const amount = cents(num(row.amount));
    if (row.transactionType === 'SALE') {
      const cost = cents(num(inventory.get(String(sale.itemNumber))?.cost));
      bucket.gross += amount + feeCents(row); bucket.profit += amount - cost; bucket.costs += cost; bucket.count++;
    } else if (row.transactionType === 'REFUND' || row.transactionType === 'SHIPPING_LABEL') bucket.profit -= amount;
  }
  for (const row of data.ads.filter(row => q3(row.reportStart))) {
    brand(String(inventory.get(String(row.listingId))?.brand)).profit -= cents(num(row.adSpend));
  }
  const leaders = [...brandResults].sort((a, b) => b[1].profit - a[1].profit || a[0].localeCompare(b[0])).slice(0, 3);
  const adGroups = new Map<string, { name: string; spend: number; sales: number; units: number }>();
  for (const row of data.ads.filter(row => q3(row.reportStart))) {
    const key = String(row.campaignId), acc = adGroups.get(key) ?? { name: String(row.campaignName), spend: 0, sales: 0, units: 0 };
    acc.spend += cents(num(row.adSpend)); acc.sales += cents(num(row.attributedSales)); acc.units += num(row.attributedUnits); adGroups.set(key, acc);
  }
  const weakest = [...adGroups.values()].filter(row => row.spend > 0).sort((a, b) => a.sales / a.spend - b.sales / b.spend)[0];
  const listingAds = new Map<string, { spend: number; sales: number }>();
  for (const row of data.ads.filter(row => q3(row.reportStart))) {
    const key = String(row.listingId), acc = listingAds.get(key) ?? { spend: 0, sales: 0 };
    acc.spend += cents(num(row.adSpend)); acc.sales += cents(num(row.attributedSales)); listingAds.set(key, acc);
  }
  const wasted = [...listingAds].filter(([, row]) => row.spend > 0 && row.sales === 0).sort((a, b) => b[1].spend - a[1].spend || a[0].localeCompare(b[0]));
  const traffic = new Map<string, { views: number; transactions: number }>();
  for (const row of data.listings.filter(row => date(row.date).toISOString().slice(0, 10) >= '2026-09-01')) {
    const key = String(row.listingId), acc = traffic.get(key) ?? { views: 0, transactions: 0 };
    acc.views += num(row.viewsTotal); acc.transactions += num(row.transactions); traffic.set(key, acc);
  }
  const stalled = [...traffic].filter(([id, row]) => row.transactions === 0 && num(inventory.get(id)?.quantity) > 0)
    .sort((a, b) => b[1].views - a[1].views || a[0].localeCompare(b[0])).slice(0, 3);
  const months = new Map<string, { gross: number; fees: number; orders: number }>();
  for (const row of data.finance.filter(row => row.transactionType === 'SALE')) {
    const key = month(row.transactionDate), acc = months.get(key) ?? { gross: 0, fees: 0, orders: 0 };
    const fees = feeCents(row); acc.fees += fees; acc.gross += cents(num(row.amount)) + fees; acc.orders++; months.set(key, acc);
  }
  const first = months.get('2025-10')!, last = months.get('2026-09')!;
  const feeChange = (last.fees / last.gross - first.fees / first.gross) * 100;
  const provenance = (tables: string[], from: string, method: string) => ({ tables, period: { from, to: DEMO_AS_OF }, method });
  const intro = 'Fictional demo data as of September 30, 2026. ';
  const questions = [
    { id: 'brand-profit', question: DEMO_QUESTIONS[0],
      answer: `${intro}For Q3 2026 (July–September), the top modeled contribution was ${leaders.map(([name, row]) => `${name}: ${usd(row.profit)} from ${row.count} orders`).join('; ')}. This subtracts sale fees, refunds, item acquisition cost, postage, and listing-level ad spend from item-plus-shipping revenue. Shared overhead and taxes are excluded, so this is contribution, not accounting net profit.`,
      provenance: provenance(['EbayFinanceTransaction', 'Sale', 'Inventory', 'EbayAdReport'], '2026-07-01', 'Integer-cent sums by brand; cost uses Inventory.cost per sold unit, including returned units; no shared-overhead allocation.') },
    { id: 'ad-waste', question: DEMO_QUESTIONS[1],
      answer: `${intro}In Q3, ${weakest.name} was the weakest campaign: ${usd(weakest.spend)} spent for ${usd(weakest.sales)} in attributed sales (${(weakest.sales / weakest.spend).toFixed(2)}× ROAS). ${wasted.slice(0, 3).map(([id, row]) => `${id} spent ${usd(row.spend)} with no attributed sales`).join('; ')}. Review or pause those test placements before raising budgets. ROAS is revenue divided by ad spend and does not itself prove profitability.`,
      provenance: provenance(['EbayAdReport', 'Inventory', 'EbayFinanceTransaction'], '2026-07-01', 'Campaign ROAS recomputed from summed attributed revenue and spend; zero-attribution listing costs ranked by spend. Report spending ties to finance AD_FEE charges.') },
    { id: 'views-no-sales', question: DEMO_QUESTIONS[2],
      answer: `${intro}For September, the leading active listings with zero orders were ${stalled.map(([id, row]) => `${id}, ${String(inventory.get(id)?.title).replace(' [DEMO]', '')}: ${row.views} views`).join('; ')}. Check connector photos, fitment years, condition detail, and price before buying more stock. These counts are daily traffic totals, not lifetime snapshots.`,
      provenance: provenance(['EbayTrafficListing', 'Inventory'], '2026-09-01', 'Sum views and transactions by listing in September; filter zero transactions and positive stock, rank by views.') },
    { id: 'relist-reprice', question: DEMO_QUESTIONS[3],
      answer: `${intro}For the week containing September 30, test repricing ${stalled.map(([id]) => `${id} from ${usd(cents(num(inventory.get(id)?.price)))} to ${usd(Math.round(cents(num(inventory.get(id)?.price)) * 0.9))}`).join('; ')}. Each has stock and September views but no orders. Refresh fitment and photos at the same time, then compare the next 14 days. This is a demo recommendation only; no listing or price was changed.`,
      provenance: provenance(['EbayTrafficListing', 'Inventory'], '2026-09-01', 'Top three zero-sale stocked listings by September views; suggested test price = 90% of current price rounded to cents. Week is anchored to the fixed as-of date.') },
    { id: 'fee-trend', question: DEMO_QUESTIONS[4],
      answer: `${intro}Sale fees moved from ${usd(first.fees)} on ${usd(first.gross)} gross in October 2025 (${(first.fees / first.gross * 100).toFixed(2)}%) to ${usd(last.fees)} on ${usd(last.gross)} in September 2026 (${(last.fees / last.gross * 100).toFixed(2)}%). The effective rate rose ${feeChange.toFixed(2)} percentage points. This fixture models a variable-fee increase from 12.7% to 13.2% and a per-order increase from $0.30 to $0.40 in April 2026; these are fictional assumptions, not eBay's fee schedule. Ad spend, postage, refunds, and the store subscription are reported separately.`,
      provenance: provenance(['EbayFinanceTransaction'], DEMO_START, 'Monthly sale-fee details divided by sale proceeds plus those fees; ratios are weighted by gross, not averaged. Excludes NON_SALE_CHARGE and SHIPPING_LABEL.') },
  ];
  return { schemaVersion: 1, synthetic: true, store: DEMO_STORE, asOf: DEMO_AS_OF, window: { from: DEMO_START, to: DEMO_AS_OF }, source: 'prisma/demo.db', questions };
}

function writeDemoAnswers() {
  const path = assertDemoDatabasePath({ rejectSidecars: true });
  validateDemoManifest(path);
  verifyDemoDatabase(path);
  const answer = buildDemoAnswers(readSnapshot(path));
  writeFileSync(resolve(DEMO_PROJECT_ROOT, 'src/lib/demo/answers.json'), JSON.stringify(answer, null, 2) + '\n');
  return answer;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const answer = writeDemoAnswers(); console.log(`Built ${answer.questions.length} cached demo answers from verified prisma/demo.db.`); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
