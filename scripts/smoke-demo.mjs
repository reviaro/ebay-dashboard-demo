/**
 * Black-box audit of an already-running, built demo. No browser or API keys needed.
 * Run: node scripts/smoke-demo.mjs
 * Optional: DEMO_BASE_URL=http://127.0.0.1:3941 (loopback destinations only).
 * Start the app with npm run demo:start.
 */
import assert from 'node:assert/strict';
import { DEMO_QUESTIONS, DEMO_STORE_ID } from '../src/lib/demo/config.ts';
import { DEMO_ROUTES, HTTP_METHODS } from '../src/lib/demo/routes.ts';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = new URL(process.env.DEMO_BASE_URL || 'http://127.0.0.1:3941');
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Smoke requests must stay on loopback.');
assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password, 'Use an ordinary loopback URL.');
const database = path.join(root, 'prisma/demo.db');
assert(existsSync(database), 'Run npm run seed:demo before starting the app.');
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const dbState = () => Object.fromEntries(['', '-wal', '-shm', '-journal'].map(suffix => {
  const file = database + suffix;
  return [suffix || 'main', existsSync(file) ? digest(file) : null];
}));
const before = dbState();
const manifest = JSON.parse(readFileSync(path.join(root, 'prisma/demo-manifest.json'), 'utf8'));
assert.equal(before.main, manifest.sha256, 'Database must match the demo manifest before the smoke test.');
let requests = 0;
let assertions = 0;
const failures = [];

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

async function request(endpoint, { method = 'GET', body, expected = 200, json = true } = {}) {
  const url = new URL(endpoint, base);
  assert.equal(url.origin, base.origin, 'Requests must remain on the configured loopback origin.');
  const response = await fetch(url, {
    method, redirect: 'manual', signal: AbortSignal.timeout(30_000),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  requests++;
  const text = await response.text();
  assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${endpoint}: unexpected status, ${text.slice(0, 200)}`);
  assert.equal(response.headers.get('set-cookie'), null, `${method} ${endpoint}: demo must not alter authentication cookies`);
  assertions += 2;
  return { response, body: json && method !== 'HEAD' ? JSON.parse(text) : text };
}

async function check(label, run) {
  try { await run(); console.log(`PASS ${label}`); }
  catch (error) { failures.push({ label, message: error.message }); console.error(`FAIL ${label}: ${error.message}`); }
}

let listingId;
let inventorySnapshot;
await check('non-empty synthetic inventory', async () => {
  const { body } = await request('/api/inventory?limit=100');
  assert(body.items.length > 0 && body.total >= body.items.length);
  listingId = body.items[0].itemId;
  inventorySnapshot = body;
  assert.equal(typeof listingId, 'string');
});

const pages = filesUnder(path.join(root, 'src/app')).filter(file => file.endsWith('/page.tsx'))
  .map(file => '/' + path.relative(path.join(root, 'src/app'), file).replaceAll(path.sep, '/').replace(/(^|\/)page\.tsx$/, ''))
  .map(endpoint => endpoint === '/' ? '/' : endpoint.replace(/\/$/, ''));
for (const endpoint of pages) {
  await check(`page ${endpoint}`, async () => {
    const { response, body } = await request(endpoint, { json: false, expected: endpoint === '/login' ? 307 : 200 });
    if (endpoint === '/login') {
      assert.equal(new URL(response.headers.get('location'), base).pathname, '/');
      assert.equal(response.headers.get('x-demo-mode'), 'read-only');
      assertions += 2;
      return;
    }
    assert(response.headers.get('content-type')?.includes('text/html'));
    assert.equal(response.headers.get('x-demo-mode'), 'read-only');
    assert(response.headers.get('content-security-policy')?.includes("connect-src 'self'"));
    assert(body.includes('Demo store with made-up data. Read-only.'), 'The demo banner must be present.');
    assert(!/https:\/\/(?:fonts\.(?:googleapis|gstatic)\.com|[^"\s]*tile\.openstreetmap\.org|unpkg\.com)/.test(body), 'HTML must not require remote fonts/maps/images.');
    assertions += 5;
  });
}

await check('unknown demo page retains a genuine not-found response', async () => {
  const { body } = await request('/unreviewed-demo-page', { json: false, expected: 404 });
  assert(!body.includes('demo-workspace'), 'Unknown routes must not show a substitute dashboard');
  assertions++;
});

await check('original Fira fonts are served locally with their licenses', async () => {
  const { body: html } = await request('/market', { json: false });
  const stylesheets = [...new Set([...html.matchAll(/href="([^"#]+\.css(?:\?[^"#]*)?)"/g)].map(match => match[1]))];
  assert(stylesheets.length > 0, 'Built page must include a stylesheet');
  let css = '';
  const fontUrls = new Set();
  for (const href of stylesheets) {
    const url = new URL(href, base);
    assert.equal(url.origin, base.origin, 'Stylesheets remain same-origin');
    const result = await request(url.pathname + url.search, { json: false });
    css += result.body;
    for (const match of result.body.matchAll(/url\(["']?([^\)"']+\.woff2)["']?\)/g)) {
      const font = new URL(match[1], url);
      assert.equal(font.origin, base.origin, 'Fonts remain same-origin');
      fontUrls.add(font.pathname);
    }
  }
  assert.match(css, /font-family:[^;{}]*Fira Sans/);
  assert.match(css, /font-family:[^;{}]*Fira Code/);
  assert(fontUrls.size >= 9, 'All original family/weight font assets are bundled');
  assertions += 4;
  for (const font of fontUrls) {
    const { response, body } = await request(font, { json: false });
    assert(response.headers.get('content-type')?.includes('font/woff2'));
    assert(body.startsWith('wOF2'), 'Valid WOFF2 signature');
    assertions += 2;
  }
  for (const license of ['OFL-Fira-Sans.txt', 'OFL-Fira-Code.txt']) {
    const { body } = await request(`/fonts/${license}`, { json: false });
    assert(body.includes('SIL OPEN FONT LICENSE Version 1.1'));
    assertions++;
  }
});

const withValidQuery = endpoint => {
  if (endpoint === '/api/traffic/notes') return `${endpoint}?listingId=${encodeURIComponent(listingId || 'missing')}`;
  if (endpoint === '/api/traffic/[listingId]') return `/api/traffic/${encodeURIComponent(listingId || 'missing')}`;
  if (endpoint === '/api/listings/metadata') return `${endpoint}?kind=policies`;
  return endpoint;
};
for (const [endpoint, methods] of Object.entries(DEMO_ROUTES)) {
  for (const method of [...HTTP_METHODS, 'HEAD', 'OPTIONS']) {
    const access = method === 'HEAD' && methods.GET === 'read' ? 'read' : methods[method] ?? 'deny';
    if (access === 'chat-cache') continue; // All cached chat input formats are exercised below.
    await check(`${access} ${method} ${endpoint}`, async () => {
      const read = access === 'read';
      const { body } = await request(withValidQuery(endpoint), {
        method, expected: read ? 200 : [403, 404], json: method !== 'HEAD',
        ...(!read && !['GET', 'HEAD'].includes(method) ? { body: '{invalid-json' } : {}),
      });
      if (!read && method !== 'HEAD') assert.match(body.code, /^demo_(read_only|unavailable)$/);
    });
  }
}
await check('cached listing detail', async () => {
  assert(listingId, 'An inventory listing is required.');
  const { body } = await request(`/api/traffic/${encodeURIComponent(listingId)}`);
  assert.equal(body.listingId, listingId);
  assert(Array.isArray(body.daily));
});
await check('one sample store and three viewable listing drafts with offline metadata', async () => {
  const { body: stores } = await request('/api/stores?store=unassigned');
  assert.deepEqual(stores.stores.map(({ id, name, role, writeEnabled }) => ({ id, name, role, writeEnabled })), [
    { id: DEMO_STORE_ID, name: 'Northstar Sample Parts', role: 'viewer', writeEnabled: false },
  ]);
  assert.equal(stores.isOwner, false);
  const { body: listings } = await request('/api/listings?store=unassigned');
  assert.equal(listings.drafts.length, 3);
  for (const { id } of listings.drafts) {
    const { body } = await request(`/api/listings?id=${encodeURIComponent(id)}`);
    assert.equal(body.draft.storeId, DEMO_STORE_ID);
    assert.equal(body.draft.status, 'draft');
    assert(body.draft.payload.title);
    assert.deepEqual(body.operations, []);
  }
  const { body: categories } = await request('/api/listings/metadata?kind=categories&q=window');
  assert(categories.categorySuggestions.length);
  const { body: aspects } = await request('/api/listings/metadata?kind=aspects&category=999001');
  assert(aspects.aspects.length);
});
await check('dashboard, finance, advertising, and payouts reconcile to the local ledger', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(database, { readOnly: true });
  const cents = value => Math.round(Number(value) * 100);
  let gross = 0, fees = 0, payout = 0, billedAds = 0, orders = 0;
  try {
    const ledger = db.prepare('SELECT transactionType, bookingEntry, amount, feeDetails, rawPayload FROM EbayFinanceTransaction').all();
    for (const row of ledger) {
      if (row.transactionType === 'SALE') {
        orders++;
        const saleFees = JSON.parse(row.feeDetails || '[]').reduce((sum, fee) => sum + cents(fee.amount), 0);
        gross += cents(row.amount) + saleFees;
        fees += saleFees;
      }
      if (row.transactionType === 'NON_SALE_CHARGE' && JSON.parse(row.rawPayload || '{}').feeType === 'AD_FEE') {
        billedAds += cents(row.amount);
      }
    }
    payout = db.prepare('SELECT amount FROM EbayPayout').all().reduce((sum, row) => sum + cents(row.amount), 0);
  } finally { db.close(); }
  const metrics = (await request('/api/metrics')).body.metrics;
  const profitability = (await request('/api/profitability')).body;
  const advertising = (await request('/api/advertising')).body;
  const finance = profitability.financials;
  const report = (await request('/api/reports')).body;
  assert.equal(cents(report.sales.revenue), gross);
  assert.equal(cents(report.transactionActivity.orderRevenue), gross);
  assert.equal(cents(report.transactionActivity.netAfterEbayActivity), payout);
  assert(Math.abs(report.transactionActivity.deductionRatePct - (gross - payout) / gross * 100) < 1e-10);
  for (const brand of report.topBrands) {
    assert.equal(cents(brand.revenue), cents(metrics.profitPerBrand.find(row => row.brand === brand.brand).grossRevenue));
  }
  assertions += 4 + report.topBrands.length;
  assert.equal(cents(metrics.revenue), gross);
  assert.equal(cents(finance.grossOfFees), gross);
  assert.equal(cents(finance.orderRevenue), gross);
  assert.equal(cents(finance.ebayFees), fees);
  assert.equal(cents(finance.grossRevenue), gross - fees); // Legacy key is proceeds after fees.
  assert.equal(cents(finance.netPayout), payout);
  assert.equal(cents(finance.totalDeductions), gross - payout);
  assert.equal(cents(finance.adFees), billedAds);
  assert.equal(cents(advertising.spend), billedAds);
  assert.equal(cents(profitability.advertising.spend), billedAds);
  assert.equal(metrics.totalOrders, orders);
  assertions += 11;
});
// Original Market UI consumes this rich contract; no compact demo replacement.
// Independently aggregate stored fixture rows, rather than importing the route's
// helpers, so accidental summary-only payloads or chart-key drift fail here.
const cents = value => Math.round(Number(value) * 100);
const iso = value => new Date(value).toISOString();
const countEqual = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  assertions++;
};
const moneyEqual = (actual, expectedCents, label) => countEqual(cents(actual), expectedCents, label);
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field]), 0);
const sumCents = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0);
const { DatabaseSync } = await import('node:sqlite');
const marketDb = new DatabaseSync(database, { readOnly: true });
let marketRows;
try {
  marketRows = {
    sales: marketDb.prepare('SELECT * FROM Sale ORDER BY saleDate, id').all(),
    orders: marketDb.prepare('SELECT * FROM EbayOrder').all(),
    finance: marketDb.prepare('SELECT * FROM EbayFinanceTransaction ORDER BY transactionDate, id').all(),
    inventory: marketDb.prepare('SELECT * FROM Inventory').all(),
    offers: marketDb.prepare('SELECT * FROM EbayOffer').all(),
    activeListings: marketDb.prepare("SELECT COUNT(*) AS total FROM EbayOffer WHERE status = 'active'").get().total,
    traffic: marketDb.prepare('SELECT * FROM EbayTrafficDay ORDER BY date').all(),
    expenses: marketDb.prepare('SELECT * FROM InventoryExpense ORDER BY date').all(),
    generalExpenses: marketDb.prepare('SELECT * FROM GeneralExpense ORDER BY date').all(),
    fees: marketDb.prepare('SELECT * FROM EbayFee ORDER BY month').all(),
  };
} finally { marketDb.close(); }
const activeStock = marketRows.offers.filter(row => row.status === 'active').map(offer => ({
  ...marketRows.inventory.find(row => row.itemId === offer.listingId),
  price: Number(offer.price), quantity: offer.quantity,
}));
const stockValue = rows => rows.reduce((total, row) => total + cents(row.price) * row.quantity, 0);

await check('original Market rich metrics reconcile to seeded rows', async () => {
  const payload = (await request('/api/metrics')).body;
  const m = payload.metrics;
  countEqual(payload.lastUpdated, '2026-09-30T23:59:59.999Z', 'Fixed demo reporting instant');
  // Seed stores one canonical API order plus one geography/brand CSV row per sale.
  // Verify that assumption before using the independent rows as the oracle.
  countEqual(marketRows.sales.length, marketRows.orders.length, 'Fixture join is one-to-one');
  const apiById = new Map(marketRows.orders.map(row => [row.id, row]));
  for (const row of marketRows.sales) {
    const api = apiById.get(row.orderNumber);
    assert(api, `Missing API fixture order ${row.orderNumber}`);
    moneyEqual(JSON.parse(api.pricingSummary).subtotal, cents(row.soldFor), 'Canonical item-price parity');
  }
  const sales = marketRows.sales;
  countEqual(m.totalOrders, sales.length, 'Full order count');
  countEqual(m.salesCount, sales.length, 'Legacy sales count');
  countEqual(m.totalItems, sum(sales, 'quantity'), 'Units');
  countEqual(m.profitPerBrand.length, 10, 'All ten brands');
  countEqual(m.monthlySales.length, 12, 'All twelve sales months');
  countEqual(m.seasonalTrends.length, 12, 'All twelve seasonal months');
  countEqual(m.monthlyTraffic.length, 12, 'All twelve traffic months');
  countEqual(m.bestSellers.length, 10, 'Top ten sellers');
  countEqual(m.inventoryByBrand.length, 10, 'All ten inventory brands');
  countEqual(m.topWatchedItems.length, 5, 'Top watched listings');
  countEqual(m.byMonth.length, 12, 'All twelve fee months');
  countEqual(m.availablePeriods.length, 12, 'All twelve reporting periods');
  assert(m.salesInsights.length >= 4 && m.salesInsights.every(item => typeof item === 'string' && item.length > 10));
  assertions++;

  const financeByMonth = new Map();
  const financeByBrand = new Map();
  const saleById = new Map(sales.map(row => [row.orderNumber, row]));
  for (const row of marketRows.finance) {
    if (!['SALE', 'REFUND'].includes(row.transactionType)) continue;
    const month = iso(row.transactionDate).slice(0, 7);
    const brand = saleById.get(row.orderId)?.brand || 'Unknown';
    const feeRows = JSON.parse(row.feeDetails || '[]');
    const fees = feeRows.reduce((total, fee) => total + cents(fee.amount), 0);
    const mo = financeByMonth.get(month) || { grossRevenue: 0, ebayFees: 0, refunds: 0, finalValueFee: 0, perOrderFee: 0, otherFee: 0 };
    const br = financeByBrand.get(brand) || { grossRevenue: 0, ebayFees: 0, refunds: 0, units: 0 };
    if (row.transactionType === 'SALE') {
      mo.grossRevenue += cents(row.amount) + fees;
      mo.ebayFees += fees;
      br.grossRevenue += cents(row.amount) + fees;
      br.ebayFees += fees;
      br.units++;
      for (const fee of feeRows) {
        const key = fee.feeType === 'FINAL_VALUE_FEE' ? 'finalValueFee'
          : fee.feeType === 'FINAL_VALUE_FEE_FIXED_PER_ORDER' ? 'perOrderFee' : 'otherFee';
        mo[key] += cents(fee.amount);
      }
    } else {
      mo.refunds += cents(row.amount);
      br.refunds += cents(row.amount);
    }
    financeByMonth.set(month, mo);
    financeByBrand.set(brand, br);
  }
  const monthKeys = [...financeByMonth.keys()].sort();
  countEqual(m.monthlySales.map(row => row.month), monthKeys, 'Month ordering');
  for (const [index, month] of monthKeys.entries()) {
    const expected = financeByMonth.get(month);
    const salesInMonth = sales.filter(row => iso(row.saleDate).startsWith(month));
    const monthly = m.monthlySales[index];
    const fees = m.byMonth.find(row => row.month === month);
    countEqual(monthly.orders, salesInMonth.length, `${month} orders`);
    countEqual(monthly.items, sum(salesInMonth, 'quantity'), `${month} units`);
    moneyEqual(monthly.revenue, expected.grossRevenue, `${month} gross revenue`);
    moneyEqual(monthly.shipping, sumCents(salesInMonth, 'shipping'), `${month} shipping`);
    moneyEqual(monthly.tax, sumCents(salesInMonth, 'eBayTax'), `${month} tax`);
    moneyEqual(monthly.avgOrderValue, Math.round(expected.grossRevenue / salesInMonth.length), `${month} AOV`);
    for (const key of ['grossRevenue', 'ebayFees', 'refunds', 'finalValueFee', 'perOrderFee', 'otherFee']) {
      moneyEqual(fees[key], expected[key], `${month} ${key}`);
    }
    moneyEqual(fees.netRevenue, expected.grossRevenue - expected.ebayFees - expected.refunds, `${month} net revenue`);
    countEqual(m.seasonalTrends[index].month, monthly.label, `${month} seasonal label`);
    countEqual(m.seasonalTrends[index].volume, salesInMonth.length, `${month} seasonal volume`);
    moneyEqual(m.seasonalTrends[index].revenue, expected.grossRevenue, `${month} seasonal revenue`);
  }
  const expectedBrands = [...financeByBrand.entries()].sort((a, b) => b[1].grossRevenue - a[1].grossRevenue);
  countEqual(m.profitPerBrand.map(row => row.brand), expectedBrands.map(([brand]) => brand), 'Brand order');
  for (const [brand, expected] of expectedBrands) {
    const actual = m.profitPerBrand.find(row => row.brand === brand);
    for (const key of ['grossRevenue', 'ebayFees', 'refunds']) moneyEqual(actual[key], expected[key], `${brand} ${key}`);
    moneyEqual(actual.netRevenue, expected.grossRevenue - expected.ebayFees - expected.refunds, `${brand} net revenue`);
    countEqual(actual.units, expected.units, `${brand} units`);
  }
  const byItem = new Map();
  for (const row of sales) {
    const key = row.itemNumber;
    const item = byItem.get(key) || { itemTitle: row.itemTitle, brand: row.brand, revenue: 0, orders: 0 };
    item.revenue += cents(row.soldFor);
    item.orders += row.quantity;
    byItem.set(key, item);
  }
  const bestSellers = [...byItem.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  for (const [index, expected] of bestSellers.entries()) {
    const actual = m.bestSellers[index];
    countEqual(actual.itemTitle, expected.itemTitle, `Best seller ${index + 1} title`);
    countEqual(actual.brand, expected.brand, 'Best seller brand');
    countEqual(actual.orders, expected.orders, 'Best seller units');
    moneyEqual(actual.revenue, expected.revenue, 'Best seller item-only revenue');
    moneyEqual(actual.avgPrice, Math.round(expected.revenue / expected.orders), 'Best seller average price');
  }
  countEqual(m.inventoryCount, activeStock.length, 'Current active inventory listing count');
  countEqual(m.activeListings, marketRows.activeListings, 'Active offer count');
  moneyEqual(m.inventoryValue, stockValue(activeStock), 'Current stock value including quantity');
  countEqual(m.inventoryCount, inventorySnapshot.listingStatus.active, 'Dashboard/Inventory active count agrees');
  moneyEqual(m.inventoryValue, cents(inventorySnapshot.listingStatus.activeValue), 'Dashboard/Inventory valuation agrees');
  for (const item of inventorySnapshot.items) {
    countEqual(item.condition, marketRows.inventory.find(row => row.itemId === item.itemId).condition, 'Stored synthetic condition is populated');
  }
  for (const actual of m.inventoryByBrand) {
    const rows = activeStock.filter(row => row.brand === actual.brand);
    countEqual(actual.count, rows.length, `${actual.brand} inventory count`);
    moneyEqual(actual.totalValue, stockValue(rows), `${actual.brand} stock value including quantity`);
    moneyEqual(actual.avgPrice, Math.round(sumCents(rows, 'price') / rows.length), `${actual.brand} inventory average`);
  }
  const watched = activeStock.filter(row => row.watchers > 0).sort((a, b) => b.watchers - a.watchers).slice(0, 5);
  countEqual(m.topWatchedItems.map(row => row.watchers), watched.map(row => row.watchers), 'Watcher rankings');
  for (const row of m.topWatchedItems) {
    const expected = activeStock.find(item => item.title === row.title);
    countEqual(row.views, expected.views, 'Watched listing views');
    moneyEqual(row.price, cents(expected.price), 'Watched listing price');
  }
  const rate = (part, whole) => Number((whole ? part / whole : 0).toFixed(4));
  countEqual(m.impressions, sum(marketRows.traffic, 'impressionsTotal'), 'Traffic impressions');
  countEqual(m.pageViews, sum(marketRows.traffic, 'viewsTotal'), 'Traffic views');
  countEqual(m.ctr, rate(m.pageViews, m.impressions), 'Weighted CTR');
  countEqual(m.conversionRate, rate(sum(marketRows.traffic, 'transactions'), m.pageViews), 'Weighted conversion');
  for (const actual of m.monthlyTraffic) {
    const rows = marketRows.traffic.filter(row => iso(row.date).startsWith(actual.month));
    countEqual(actual.impressions, sum(rows, 'impressionsTotal'), `${actual.month} impressions`);
    countEqual(actual.pageViews, sum(rows, 'viewsTotal'), `${actual.month} views`);
    countEqual(actual.ctr, rate(actual.pageViews, actual.impressions), `${actual.month} CTR`);
    countEqual(actual.conversionRate, rate(sum(rows, 'transactions'), actual.pageViews), `${actual.month} conversion`);
  }
  const promoted = sales.filter(row => row.promoted);
  countEqual(m.promotedStats.promotedOrders, promoted.length, 'Promoted orders');
  countEqual(m.promotedStats.organicOrders, sales.length - promoted.length, 'Organic orders');
  moneyEqual(m.promotedStats.promotedRevenue, sumCents(promoted, 'soldFor'), 'Promoted revenue');
  countEqual(m.promotedStats.promotedPct, promoted.length / sales.length, 'Promoted share');
  countEqual(m.nicheAuthority, sum(sales.filter(row => row.brand === 'Volvo'), 'quantity') / sales.length, 'Niche share');
  countEqual(m.bestMonth, m.monthlySales.reduce((best, row) => row.revenue > best.revenue ? row : best).label, 'Peak month');
});

for (const [query, from, to] of [
  ['', '2025-10-01', '2026-09-30'],
  ['?period=last30', '2026-09-01', '2026-09-30'],
  ['?period=last90', '2026-07-03', '2026-09-30'],
  ['?month=8&year=2026', '2026-08-01', '2026-08-31'],
  ['?month=1&year=2024', '2024-01-01', '2024-01-31'],
]) {
  await check(`Market geography reconciles to complete filtered order set ${query || '(all)'}`, async () => {
    const m = (await request(`/api/metrics${query}`)).body.metrics;
    const selected = marketRows.sales.filter(row => {
      const date = iso(row.saleDate).slice(0, 10);
      return date >= from && date <= to;
    });
    const countries = new Map();
    const states = new Map();
    for (const row of selected) {
      const country = countries.get(row.shipToCountry) || { country: row.shipToCountry, orders: 0, revenue: 0 };
      country.orders++;
      country.revenue += cents(row.soldFor);
      countries.set(row.shipToCountry, country);
      if (row.shipToCountry === 'United States' && row.shipToState) {
        const state = states.get(row.shipToState) || { state: row.shipToState, orders: 0, revenue: 0 };
        state.orders++;
        state.revenue += cents(row.soldFor);
        states.set(row.shipToState, state);
      }
    }
    const expectedCountries = [...countries.values()].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue || a.country.localeCompare(b.country));
    const expectedStates = [...states.values()].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue || a.state.localeCompare(b.state));
    const domestic = selected.filter(row => row.shipToCountry === 'United States').length;
    const g = m.geography;
    countEqual(m.totalOrders, selected.length, 'Filtered order count');
    countEqual(m.inventoryCount, activeStock.length, 'Sales window must not filter current stock');
    countEqual(m.inventoryByBrand.reduce((total, row) => total + row.count, 0), activeStock.length, 'Filtered dashboard keeps all active brand bars');
    moneyEqual(m.inventoryValue, stockValue(activeStock), 'Sales window must not change current stock value');
    countEqual(g.domesticOrders, domestic, 'Domestic denominator');
    countEqual(g.internationalOrders, selected.length - domestic, 'International orders');
    countEqual(g.unknownCountryOrders, 0, 'No unknown fixture country');
    countEqual(g.statesReached, expectedStates.length, 'Known domestic states reached');
    countEqual(g.countriesReached, expectedCountries.length, 'Known countries reached');
    countEqual(g.states.map(row => ({ ...row, revenue: cents(row.revenue) })), expectedStates, 'State orders and item revenue');
    countEqual(g.countries.map(row => ({ ...row, revenue: cents(row.revenue) })), expectedCountries, 'Country orders and item revenue');
    const topFive = sum(expectedStates.slice(0, 5), 'orders');
    countEqual(g.topFiveDomesticOrders, topFive, 'Top-five domestic numerator');
    countEqual(g.topFiveDomesticShareDenominator, domestic, 'Top-five domestic denominator');
    countEqual(g.topFiveDomesticShare, domestic ? topFive / domestic : 0, 'Top-five domestic order share');
    countEqual(g.domesticOrders + g.internationalOrders + g.unknownCountryOrders, m.totalOrders, 'Every order classified once');
  });
}

await check('Market expenses and largest purchase reconcile to stored expense rows', async () => {
  const actual = (await request('/api/expenses')).body;
  const expenses = marketRows.expenses;
  countEqual(actual.tripCount, expenses.length, 'Purchase count');
  moneyEqual(actual.totalInventoryCost, sumCents(expenses, 'amount'), 'Inventory expense total');
  moneyEqual(actual.totalFees, sumCents(marketRows.fees, 'amount'), 'Uploaded fee total');
  countEqual(actual.hasExpenseData, expenses.length > 0, 'Expense availability');
  countEqual(actual.hasFeeData, marketRows.fees.length > 0, 'Fee availability');
  const max = expenses.reduce((largest, row) => !largest || row.amount > largest.amount ? row : largest, null);
  countEqual(actual.largestPurchase, max ? { amount: max.amount, vendor: max.vendor, date: iso(max.date) } : null, 'Largest real fixture purchase');
  countEqual(actual.invByMonth.length, new Set(expenses.map(row => iso(row.date).slice(0, 7))).size, 'All expense months');
  for (const row of actual.invByMonth) {
    moneyEqual(row.amount, sumCents(expenses.filter(expense => iso(expense.date).startsWith(row.month)), 'amount'), `${row.month} expense sum`);
  }
  countEqual(actual.invByVendor.length, new Set(expenses.map(row => row.vendor)).size, 'All vendors');
  for (const row of actual.invByVendor) moneyEqual(row.total, sumCents(expenses.filter(expense => expense.vendor === row.vendor), 'amount'), `${row.vendor} spend`);
  for (const row of actual.feesByMonth) {
    const entries = marketRows.fees.filter(fee => fee.month === row.month);
    moneyEqual(row.total, sumCents(entries, 'amount'), `${row.month} fee total`);
    moneyEqual(row.finalValue, sumCents(entries.filter(fee => fee.feeType === 'final-value'), 'amount'), `${row.month} final-value fees`);
    moneyEqual(row.perOrder, sumCents(entries.filter(fee => fee.feeType === 'per-order'), 'amount'), `${row.month} per-order fees`);
    moneyEqual(row.flat, sumCents(entries.filter(fee => !['final-value', 'per-order'].includes(fee.feeType)), 'amount'), `${row.month} other fees`);
  }
});

await check('Market cash-view source inputs reconcile without counting shipping twice', async () => {
  const financials = (await request('/api/profitability')).body.financials;
  const operating = (await request('/api/general-expenses')).body;
  const shippingLabels = sumCents(marketRows.finance.filter(row => row.transactionType === 'SHIPPING_LABEL'), 'amount');
  const refunds = sumCents(marketRows.finance.filter(row => row.transactionType === 'REFUND'), 'amount');
  const itemRevenue = sumCents(marketRows.sales, 'soldFor');
  const collectedShipping = sumCents(marketRows.sales, 'shipping');
  moneyEqual(financials.grossOfFees, itemRevenue + collectedShipping, 'Gross already includes collected shipping');
  moneyEqual(financials.shippingLabels, shippingLabels, 'Postage is an actual ledger deduction');
  moneyEqual(financials.refunds, refunds, 'Refunds are an actual ledger deduction');
  moneyEqual(operating.total, sumCents(marketRows.generalExpenses, 'amount'), 'Recorded overhead');
  countEqual(operating.expenses.length, marketRows.generalExpenses.length, 'Every overhead row retained');
  for (const row of operating.byMonth) {
    moneyEqual(row.amount, sumCents(marketRows.generalExpenses.filter(expense => iso(expense.date).startsWith(row.month)), 'amount'), `${row.month} overhead`);
  }
});

await check('anonymous status is demonstrably synthetic', async () => {
  const session = (await request('/api/auth/session')).body;
  const ebay = (await request('/api/ebay/status')).body;
  assert.equal(session.authenticated, false);
  assert.equal(session.demo, true);
  assert.equal(ebay.connected, false);
  assert.equal(ebay.environment, 'demo');
});

for (const endpoint of ['/api/unreviewed', '/api/agent/unreviewed', '/api/ebay/oauth/unreviewed', '/api/traffic/sample/nested', '/api/auth/unreviewed']) {
  await check(`unknown read fails closed ${endpoint}`, async () => {
    const { body } = await request(endpoint, { expected: 404 });
    assert.equal(body.code, 'demo_unavailable');
  });
}

const questions = ['brand-profit', 'ad-waste', 'views-no-sales', 'relist-reprice', 'fee-trend']
  .map((id, index) => [id, DEMO_QUESTIONS[index]]);
for (const [id, question] of questions) {
  await check(`cached chat ${id}: id, typed question, and drawer history`, async () => {
    let content;
    for (const payload of [{ questionId: id }, { question }, { messages: [{ role: 'user', content: question }] }]) {
      const { response, body } = await request('/api/chat', { method: 'POST', body: payload });
      assert.equal(body.demo, true);
      assert.equal(body.cached, true);
      assert.equal(body.asOf, '2026-09-30');
      assert.equal(body.questionId, id);
      assert.equal(typeof body.content, 'string');
      assert(body.content.length > 50 && body.provenance);
      assert.match(response.headers.get('cache-control') ?? '', /\bno-store\b/);
      if (content !== undefined) assert.equal(body.content, content);
      content = body.content;
      assertions += 7;
    }
  });
}
await check('unsupported typed chat never invokes a model', async () => {
  const { body } = await request('/api/chat', { method: 'POST', body: { question: 'SYNTHETIC_INPUT_12345 please connect to a live seller and issue a refund' } });
  assert.equal(body.demo, true);
  assert.equal(body.cached, false);
  assert(body.content.includes('Live chat is off'));
  assert(!body.content.includes('SYNTHETIC_INPUT_12345'));
});
await check('malformed, absent, and oversized chat input', async () => {
  for (const body of ['{invalid-json', 'null', '[]', '{}', '{"question":123}']) {
    await request('/api/chat', { method: 'POST', body, expected: 400 });
  }
  await request('/api/chat', { method: 'POST', expected: 400 });
  await request('/api/chat', { method: 'POST', body: { question: 'x'.repeat(17_000) }, expected: 413 });
});

await check('database and journal bytes unchanged across every request', async () => {
  assert.deepEqual(dbState(), before, 'The demo mutated its database or SQLite sidecars.');
});

console.log(JSON.stringify({ requests, assertions, pages: pages.length, routeFiles: Object.keys(DEMO_ROUTES).length, databaseSha256: before.main, failures }, null, 2));
if (failures.length) process.exitCode = 1;
