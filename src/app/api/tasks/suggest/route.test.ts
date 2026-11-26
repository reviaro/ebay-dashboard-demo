vi.mock('@/lib/stores/route', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/stores/route')>(),
  withStore: (await import('@/test/store-fixture')).withUnitStore,
}));
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  default: {
    ebayTrafficListing: {
      findMany: vi.fn(),
    },
  },
}));

const row = (o: Record<string, any> = {}) => ({
  date: new Date('2026-09-01T00:00:00.000Z'),
  marketplaceId: 'EBAY_MOTORS_US',
  listingId: '100000000020',
  title: 'Demo replacement headlight',
  impressionsTotal: 4000,
  viewsTotal: 120,
  transactions: 4,
  truncated: false,
  ...o,
});

describe('GET /api/tasks/suggest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.ebayTrafficListing.findMany as any).mockResolvedValue([]);
  });

  it('reads per-listing traffic from EbayTrafficListing, summed over the window', async () => {
    (prisma.ebayTrafficListing.findMany as any).mockResolvedValue([
      row({ date: new Date('2026-09-01T00:00:00.000Z'), impressionsTotal: 20, viewsTotal: 0, transactions: 0 }),
      row({ date: new Date('2026-09-02T00:00:00.000Z'), impressionsTotal: 30, viewsTotal: 0, transactions: 0 }),
    ]);

    const response = await GET(new Request('http://localhost/api/test?store=legacy'));
    const suggestions = await response.json();

    // 50 impressions over the window is below the SEO threshold of 100.
    const seo = suggestions.find((s: any) => s.type === 'seo');
    expect(seo).toBeDefined();
    expect(seo.itemId).toBe('100000000020');
  });

  it('returns an empty list when there is no per-listing traffic yet', async () => {
    const response = await GET(new Request('http://localhost/api/test?store=legacy'));
    expect(await response.json()).toEqual([]);
  });
});
