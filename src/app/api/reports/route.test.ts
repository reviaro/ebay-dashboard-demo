vi.mock('@/lib/stores/route', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/stores/route')>(),
  withStore: (await import('@/test/store-fixture')).withUnitStore,
}));
import { describe, expect, it, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';
import { loadUnifiedOrders } from '@/lib/orders/store';
import { filterOrders } from '@/lib/orders/unified';

vi.mock('@/lib/prisma', () => ({
  default: {
    ebayTransaction: { findMany: vi.fn() },
    inventory: { count: vi.fn() },
    ebayOffer: { count: vi.fn() },
  },
}));
vi.mock('@/lib/orders/store', () => ({ loadUnifiedOrders: vi.fn() }));
vi.mock('@/lib/orders/unified', () => ({ filterOrders: vi.fn() }));

import { GET } from './route';

const ebayOfferCount = (prisma.ebayOffer as unknown as { count: ReturnType<typeof vi.fn> }).count;

beforeEach(() => {
  vi.clearAllMocks();
  (loadUnifiedOrders as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (filterOrders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([]);
  (prisma.ebayTransaction.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (prisma.inventory.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(300);
  ebayOfferCount.mockResolvedValue(120);
});

describe('GET /api/reports', () => {
  it('reports activeListings as the count of active eBay listings, not the CSV table', async () => {
    const body = await (await GET(new Request('http://localhost/api/test?store=legacy'))).json();
    expect(body.inventory.activeListings).toBe(120);
    expect(ebayOfferCount.mock.calls[0][0]).toEqual({ where: { status: 'active' } });
  });
});
