import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDemoData } from '@/lib/demo/data';
import { GET as metricsGET } from './route';
import { GET as expensesGET } from '../expenses/route';

vi.mock('@/lib/auth/user-session', () => ({ currentUser: () => ({ user: { id: 'sample-viewer' } }) }));

const reads = vi.hoisted(() => ({
  sales: vi.fn(), orders: vi.fn(), finance: vi.fn(), earliestFinance: vi.fn(),
  traffic: vi.fn(), inventoryAggregate: vi.fn(), inventoryGroups: vi.fn(),
  inventory: vi.fn(), offers: vi.fn(), offerRows: vi.fn(), expenses: vi.fn(), fees: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ adminDb: { storeMembership: { findUnique: () => ({ role: 'viewer', store: { marketplaceId: 'EBAY_US' } }) } }, default: {
  sale: { findMany: reads.sales },
  ebayOrder: { findMany: reads.orders },
  ebayFinanceTransaction: { findMany: reads.finance, findFirst: reads.earliestFinance },
  ebayTrafficDay: { findMany: reads.traffic },
  inventory: { aggregate: reads.inventoryAggregate, groupBy: reads.inventoryGroups, findMany: reads.inventory },
  listingDraft: { findMany: async () => [] },
  ebayOffer: { count: reads.offers, findMany: reads.offerRows },
  inventoryExpense: { findMany: reads.expenses },
  ebayFee: { findMany: reads.fees },
} }));

const fixture = buildDemoData();
const metricsRequest = (query = '') => new Request(`http://demo.test/api/metrics${query}${query ? '&' : '?'}store=northstar`);

beforeEach(() => {
  vi.stubEnv('DEMO_MODE', '1');
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Market reads must stay offline'); }));
  reads.sales.mockResolvedValue(fixture.sales);
  reads.orders.mockResolvedValue(fixture.orders);
  reads.finance.mockResolvedValue([]);
  reads.earliestFinance.mockResolvedValue(null);
  reads.traffic.mockResolvedValue([]);
  reads.inventoryAggregate.mockResolvedValue({ _count: { id: 0 }, _sum: { price: 0 } });
  reads.inventoryGroups.mockResolvedValue([]);
  reads.inventory.mockResolvedValue([]);
  reads.offers.mockResolvedValue(0);
  reads.offerRows.mockResolvedValue([]);
  reads.expenses.mockResolvedValue(fixture.inventoryExpenses);
  reads.fees.mockResolvedValue(fixture.fees);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('demo-only Market read aggregates', () => {
  it.each(['UTC', 'America/New_York', 'Pacific/Auckland'])('keeps reporting-month choices on the synthetic UTC calendar in %s', async timezone => {
    vi.stubEnv('TZ', timezone);
    const { metrics } = await (await metricsGET(metricsRequest())).json();
    expect(metrics.availablePeriods).toHaveLength(12);
    expect(metrics.availablePeriods[0]).toEqual({ year: 2026, month: 9, label: 'September 2026' });
    expect(metrics.availablePeriods.at(-1)).toEqual({ year: 2025, month: 10, label: 'October 2025' });
  });

  it.each([
    ['', undefined],
    ['?month=9&year=2026', '2026-09'],
  ])('ties geography to complete filtered fixture sales independently of the aggregation helper (%s)', async (query, month) => {
    // Each fixture order has one matching Sale row; counting the source rows
    // independently checks that the real merge does not double count them.
    const sales = fixture.sales.filter(row => !month || new Date(row.saleDate).toISOString().startsWith(month));
    const domestic = sales.filter(row => row.shipToCountry === 'United States');
    const international = sales.filter(row => row.shipToCountry !== 'United States');
    const response = await metricsGET(metricsRequest(query));
    expect(response.status).toBe(200);
    const { metrics } = await response.json();
    const geography = metrics.geography;

    expect(metrics.totalOrders).toBe(sales.length);
    expect(geography.domesticOrders).toBe(domestic.length);
    expect(geography.internationalOrders).toBe(international.length);
    expect(geography.domesticOrders + geography.internationalOrders + geography.unknownCountryOrders).toBe(metrics.totalOrders);
    expect(geography.unknownCountryOrders).toBe(0);
    expect(geography.statesReached).toBe(new Set(domestic.map(row => row.shipToState)).size);
    expect(geography.countriesReached).toBe(new Set(sales.map(row => row.shipToCountry)).size);
    expect(geography.states).toHaveLength(geography.statesReached);
    for (const state of new Set(domestic.map(row => row.shipToState))) {
      const source = domestic.filter(row => row.shipToState === state);
      const actual = geography.states.find((row: { state: string }) => row.state === state);
      expect(actual.orders).toBe(source.length);
      expect(actual.revenue).toBeCloseTo(source.reduce((total, row) => total + (row.soldFor ?? 0), 0), 8);
    }
    for (const country of new Set(sales.map(row => row.shipToCountry))) {
      const source = sales.filter(row => row.shipToCountry === country);
      const actual = geography.countries.find((row: { country: string }) => row.country === country);
      expect(actual.orders).toBe(source.length);
      expect(actual.revenue).toBeCloseTo(source.reduce((total, row) => total + (row.soldFor ?? 0), 0), 8);
    }
    const stateCounts = [...new Set(domestic.map(row => row.shipToState))]
      .map(state => domestic.filter(row => row.shipToState === state).length)
      .sort((a, b) => b - a);
    const topFive = stateCounts.slice(0, 5).reduce((sum, count) => sum + count, 0);
    expect(geography.topFiveDomesticOrders).toBe(topFive);
    expect(geography.topFiveDomesticShareDenominator).toBe(domestic.length);
    expect(geography.topFiveDomesticShare).toBe(topFive / domestic.length);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the largest purchase and trip count directly from deterministic expense rows', async () => {
    const response = await expensesGET(new Request('http://demo.test/api/expenses?store=northstar'));
    expect(response.status).toBe(200);
    const result = await response.json();
    const maxAmount = Math.max(...fixture.inventoryExpenses.map(row => row.amount));
    const expected = fixture.inventoryExpenses.find(row => row.amount === maxAmount)!;
    expect(result.largestPurchase).toEqual({ amount: maxAmount, vendor: expected.vendor, date: new Date(expected.date).toISOString() });
    expect(result.tripCount).toBe(fixture.inventoryExpenses.length);
    expect(result.totalInventoryCost).toBeCloseTo(fixture.inventoryExpenses.reduce((sum, row) => sum + row.amount, 0), 8);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns empty aggregates when there are no rows', async () => {
    reads.sales.mockResolvedValue([]);
    reads.orders.mockResolvedValue([]);
    reads.expenses.mockResolvedValue([]);
    const { metrics } = await (await metricsGET(metricsRequest())).json();
    const expenses = await (await expensesGET(new Request('http://demo.test/api/expenses?store=northstar'))).json();
    expect(metrics.geography).toMatchObject({ domesticOrders: 0, internationalOrders: 0, statesReached: 0, countriesReached: 0, states: [], countries: [], topFiveDomesticShare: 0 });
    expect(expenses.largestPurchase).toBeNull();
    expect(expenses.tripCount).toBe(0);
  });

  it('adds no demo geography to ordinary responses; the largest purchase comes from recorded expenses', async () => {
    vi.stubEnv('DEMO_MODE', '0');
    const { metrics } = await (await metricsGET(metricsRequest())).json();
    const expenses = await (await expensesGET(new Request('http://demo.test/api/expenses?store=northstar'))).json();
    expect(metrics).not.toHaveProperty('geography');
    expect(expenses).toHaveProperty('largestPurchase');
    expect(expenses.tripCount).toBe(fixture.inventoryExpenses.length);
  });
});
