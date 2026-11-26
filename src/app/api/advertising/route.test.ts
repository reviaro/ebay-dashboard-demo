vi.mock('@/lib/stores/route', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/stores/route')>(),
  withStore: (await import('@/test/store-fixture')).withUnitStore,
}));
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ads/summary', () => ({ loadAdSummary: vi.fn() }));

import { loadAdSummary } from '@/lib/ads/summary';
import { GET } from './route';

const mockLoad = loadAdSummary as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockResolvedValue({ spend: 42, byCampaign: [], byWindow: [], winners: [], losers: [], rosterOnly: [] });
});

describe('GET /api/advertising', () => {
  it('returns the loadAdSummary payload as JSON at 200', async () => {
    const res = await GET(new Request('http://localhost/api/advertising'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ spend: 42 });
    expect(mockLoad).toHaveBeenCalledWith({ from: undefined, to: undefined });
  });

  it('passes from/to through as day-bounded dates', async () => {
    await GET(new Request('http://localhost/api/advertising?from=2026-06-01&to=2026-06-30'));
    const arg = mockLoad.mock.calls[0][0];
    expect(arg.from).toEqual(new Date('2026-06-01T00:00:00'));
    expect(arg.to).toEqual(new Date('2026-06-30T23:59:59.999'));
  });

  it('returns 500 when the summary load throws', async () => {
    mockLoad.mockRejectedValue(new Error('db down'));
    const res = await GET(new Request('http://localhost/api/advertising'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/advertising/i);
  });
});
