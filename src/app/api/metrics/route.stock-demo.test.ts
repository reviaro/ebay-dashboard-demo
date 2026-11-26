import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildDemoData } from '@/lib/demo/data';
import { normalizeBrand } from '@/lib/brand-normalizer';
import { loadUnifiedInventory } from '@/lib/inventory/store';
import { mergeInventory } from '@/lib/inventory/unified';
import { GET as metricsGET } from './route';
import { GET as inventoryGET } from '../inventory/route';

vi.mock('@/lib/auth/user-session', () => ({ currentUser: () => ({ user: { id: 'sample-viewer' } }) }));

const reads = vi.hoisted(() => ({
  sales: vi.fn(), orders: vi.fn(), finance: vi.fn(), earliestFinance: vi.fn(),
  traffic: vi.fn(), aggregate: vi.fn(), groups: vi.fn(), inventory: vi.fn(),
  offerCount: vi.fn(), offers: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ adminDb: { storeMembership: { findUnique: () => ({ role: 'viewer', store: { marketplaceId: 'EBAY_US' } }) } }, default: {
  sale: { findMany: reads.sales },
  listingDraft: { findMany: async () => [] },
  ebayOrder: { findMany: reads.orders },
  ebayFinanceTransaction: { findMany: reads.finance, findFirst: reads.earliestFinance },
  ebayTrafficDay: { findMany: reads.traffic },
  inventory: { aggregate: reads.aggregate, groupBy: reads.groups, findMany: reads.inventory },
  ebayOffer: { count: reads.offerCount, findMany: reads.offers },
} }));

const fixture = buildDemoData();
const activeOffers = fixture.offers.filter(row => row.status === 'active');
const activeValue = activeOffers.reduce((sum, row) => sum + row.price! * row.quantity!, 0);

beforeEach(() => {
  vi.stubEnv('DEMO_MODE', '1');
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Inventory metrics must stay offline'); }));
  reads.sales.mockResolvedValue(fixture.sales);
  reads.orders.mockResolvedValue(fixture.orders);
  reads.finance.mockResolvedValue([]);
  reads.earliestFinance.mockResolvedValue(null);
  reads.traffic.mockResolvedValue([]);
  reads.inventory.mockImplementation(({ select }) => Promise.resolve(fixture.inventory.map(row => {
    const { condition, ...rest } = row;
    return select.condition ? { ...rest, condition } : rest;
  })));
  reads.offers.mockResolvedValue(fixture.offers);
  reads.aggregate.mockResolvedValue({ _count: { id: 60 }, _sum: { price: 123 } });
  reads.groups.mockResolvedValue([]);
  reads.offerCount.mockResolvedValue(56);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('demo current-stock metrics', () => {
  it.each(['', '?period=last30', '?month=9&year=2026', '?period=this-year'])
    ('reconciles active counts, quantity-valued stock and watched items with inventory for %s', async query => {
      const response = await metricsGET(new Request(`http://demo.test/api/metrics${query}`));
      expect(response.status).toBe(200);
      const { metrics } = await response.json();
      const inventory = await (await inventoryGET(new NextRequest('http://demo.test/api/inventory?status=active&limit=100'))).json();

      expect(metrics.activeListings).toBe(56);
      expect(metrics.inventoryCount).toBe(inventory.listingStatus.active);
      expect(metrics.inventoryCount).toBe(metrics.activeListings);
      expect(metrics.inventoryValue).toBeCloseTo(activeValue, 8);
      expect(metrics.inventoryValue).toBe(inventory.listingStatus.activeValue);
      expect(metrics.inventoryByBrand.reduce((sum: number, row: { count: number }) => sum + row.count, 0)).toBe(56);
      expect(metrics.inventoryByBrand.reduce((sum: number, row: { totalValue: number }) => sum + row.totalValue, 0)).toBeCloseTo(activeValue, 8);

      for (const row of metrics.inventoryByBrand) {
        const offers = activeOffers.filter(offer => normalizeBrand(fixture.inventory.find(item => item.itemId === offer.listingId)!.brand) === row.brand);
        expect(row.count).toBe(offers.length);
        expect(row.totalValue).toBeCloseTo(offers.reduce((sum, offer) => sum + offer.price! * offer.quantity!, 0), 8);
        expect(row.avgPrice).toBeCloseTo(offers.reduce((sum, offer) => sum + offer.price!, 0) / offers.length, 8);
      }

      const watched = inventory.items.filter((row: { watchers: number }) => row.watchers > 0)
        .sort((a: { watchers: number }, b: { watchers: number }) => b.watchers - a.watchers)
        .slice(0, 5)
        .map(({ title, price, views, watchers, brand }: { title: string; price: number; views: number; watchers: number; brand: string }) => ({ title, price, views, watchers, brand }));
      expect(metrics.topWatchedItems).toEqual(watched);
      expect(reads.aggregate).not.toHaveBeenCalled();
      expect(reads.groups).not.toHaveBeenCalled();
      expect(reads.offerCount).not.toHaveBeenCalled();
      for (const [args] of reads.inventory.mock.calls) expect(args).not.toHaveProperty('where');
      if (query) expect(metrics.totalOrders).toBeLessThan(fixture.sales.length);
      expect(fetch).not.toHaveBeenCalled();
    });

  it('uses current offer prices and excludes sold/ended rows even when they have the most watchers', async () => {
    const ended = fixture.inventory.find(row => fixture.offers.find(offer => offer.listingId === row.itemId)?.status === 'ended')!;
    reads.inventory.mockResolvedValue(fixture.inventory.map(row => ({ ...row, price: 1, watchers: row.itemId === ended.itemId ? 999999 : row.watchers })));
    const { metrics } = await (await metricsGET(new Request('http://demo.test/api/metrics'))).json();
    expect(metrics.inventoryValue).toBeCloseTo(activeValue, 8);
    expect(metrics.topWatchedItems).not.toContainEqual(expect.objectContaining({ title: ended.title }));
    for (const row of metrics.topWatchedItems) {
      const listing = fixture.inventory.find(item => item.title === row.title)!;
      expect(row.price).toBe(activeOffers.find(offer => offer.listingId === listing.itemId)!.price);
    }
  });

  it('handles an empty active snapshot without falling back to historical inventory', async () => {
    reads.offers.mockResolvedValue([]);
    const { metrics } = await (await metricsGET(new Request('http://demo.test/api/metrics?period=last30'))).json();
    expect(metrics).toMatchObject({ activeListings: 0, inventoryCount: 0, inventoryValue: 0, inventoryByBrand: [], topWatchedItems: [] });
    expect(reads.aggregate).not.toHaveBeenCalled();
  });

  it('preserves ordinary-mode CSV/date calculations and skips the new loader', async () => {
    vi.stubEnv('DEMO_MODE', '0');
    reads.groups.mockResolvedValue([{ brand: 'VW', _count: { id: 2 }, _sum: { price: 123 }, _avg: { price: 61.5 } }]);
    const { metrics } = await (await metricsGET(new Request('http://demo.test/api/metrics?month=9&year=2026&store=northstar'))).json();
    expect(metrics).toMatchObject({ activeListings: 56, inventoryCount: 60, inventoryValue: 123 });
    expect(metrics.inventoryByBrand).toEqual([{ brand: 'Volkswagen', count: 2, totalValue: 123, avgPrice: 61.5 }]);
    expect(reads.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { createdAt: { gte: expect.any(Date), lte: expect.any(Date) } } }));
    expect(reads.offers).not.toHaveBeenCalled();
  });
});

describe('demo inventory condition projection', () => {
  it('retains seeded conditions for the catalog and inventory responses', async () => {
    const body = await (await inventoryGET(new NextRequest('http://demo.test/api/inventory?limit=100'))).json();
    expect(body.items).toHaveLength(60);
    for (const row of body.items) {
      expect(row.condition).toBe(fixture.inventory.find(item => item.itemId === row.itemId)!.condition);
      expect(row.condition).toBeTruthy();
    }
    expect(reads.inventory).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ condition: true }) }));
  });

  it('does not select or add condition in ordinary mode', async () => {
    vi.stubEnv('DEMO_MODE', '0');
    const rows = await loadUnifiedInventory();
    expect(reads.inventory.mock.calls[0][0].select).not.toHaveProperty('condition');
    expect(rows.every(row => !Object.hasOwn(row, 'condition'))).toBe(true);
  });

  it('passes optional condition through CSV-only rows without adding missing fields', () => {
    const rows = mergeInventory([
      { id: 1, itemId: 'conditioned', sku: null, title: 'Part', brand: 'Volvo', price: 10, cost: null, quantity: 1, views: 0, watchers: 0, location: null, condition: 'Used' },
      { id: 2, itemId: 'no-condition', sku: null, title: 'Part', brand: 'Volvo', price: 10, cost: null, quantity: 1, views: 0, watchers: 0, location: null },
    ], []);
    expect(rows[0].condition).toBe('Used');
    expect(rows[1]).not.toHaveProperty('condition');
  });
});
