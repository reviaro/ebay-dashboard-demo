vi.mock('@/lib/stores/route', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/stores/route')>(),
  withStore: (await import('@/test/store-fixture')).withUnitStore,
}));
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadUnifiedInventory, filterInventory } from '@/lib/inventory/store';

vi.mock('@/lib/inventory/store', () => ({
  loadUnifiedInventory: vi.fn(),
  filterInventory: vi.fn(),
}));

import { GET } from './route';

const load = loadUnifiedInventory as unknown as ReturnType<typeof vi.fn>;
const filter = filterInventory as unknown as ReturnType<typeof vi.fn>;

const row = (over: Record<string, unknown> = {}) => ({
  key: 'k', source: 'api', itemId: '1', sku: null, title: 'Part', brand: 'Volvo',
  price: 100, cost: null, quantity: 1, views: 0, watchers: 0, location: null,
  status: 'active', lastSeenAt: null, ...over,
});

const req = (url = 'http://localhost/api/inventory') =>
  ({ nextUrl: new URL(url) }) as unknown as import('next/server').NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  // The route's own status filter is what's under test; keep search a no-op.
  filter.mockImplementation((rows: unknown[]) => rows);
});

describe('GET /api/inventory', () => {
  it('returns every status when no status param is given', async () => {
    load.mockResolvedValue([row({ status: 'active' }), row({ status: 'sold' }), row({ status: 'ended' })]);
    const body = await (await GET(req())).json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(3);
  });

  it('?status=active returns only the active listings', async () => {
    load.mockResolvedValue([row({ status: 'active' }), row({ status: 'sold' }), row({ status: 'ended' })]);
    const body = await (await GET(req('http://localhost/api/inventory?status=active'))).json();
    expect(body.total).toBe(1);
    expect(body.items.every((i: { status: string }) => i.status === 'active')).toBe(true);
  });

  it('stats reflect the status-filtered set', async () => {
    load.mockResolvedValue([
      row({ status: 'active', price: 100, quantity: 2 }),
      row({ status: 'sold', price: 999, quantity: 9 }),
    ]);
    const body = await (await GET(req('http://localhost/api/inventory?status=active'))).json();
    expect(body.stats._count._all).toBe(1);
    expect(body.stats._avg.price).toBe(100);
    expect(body.stats._sum.quantity).toBe(2);
  });

  it('listingStatus breakdown stays over the full set, not the current filter', async () => {
    load.mockResolvedValue([
      row({ status: 'active' }), row({ status: 'active' }),
      row({ status: 'sold' }), row({ status: 'ended' }), row({ status: 'unknown' }),
    ]);
    const body = await (await GET(req('http://localhost/api/inventory?status=active'))).json();
    expect(body.listingStatus).toMatchObject({ active: 2, sold: 1, ended: 1, unknown: 1 });
  });
});
