vi.mock('@/lib/stores/route', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/stores/route')>(),
  withStore: (await import('@/test/store-fixture')).withUnitStore,
}));
import { describe, expect, it, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';
import { loadUnifiedOrders } from '@/lib/orders/store';
import { filterOrders } from '@/lib/orders/unified';

vi.mock('@/lib/prisma', () => ({
  default: { ebayFinanceTransaction: { findMany: vi.fn() } },
}));
vi.mock('@/lib/orders/store', () => ({ loadUnifiedOrders: vi.fn() }));
vi.mock('@/lib/orders/unified', () => ({ filterOrders: vi.fn() }));

import { GET } from './route';

const financeFindMany = (prisma.ebayFinanceTransaction as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany;
const mockFilter = filterOrders as unknown as ReturnType<typeof vi.fn>;

const order = (over: Record<string, unknown> = {}) => ({
  soldFor: 100, totalPrice: 110, eBayTax: 8, shipping: 5, saleDate: new Date('2026-06-05T00:00:00Z'), ...over,
});

const req = (url = 'http://localhost/api/orders') =>
  ({ nextUrl: new URL(url) }) as unknown as import('next/server').NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  (loadUnifiedOrders as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  mockFilter.mockReturnValue([order(), order({ soldFor: 50, totalPrice: 55 })]);
  financeFindMany.mockResolvedValue([{ amount: '15.00' }, { amount: '5.50' }]);
});

describe('GET /api/orders', () => {
  it('adds a positive refundTotal summed from finance REFUND rows', async () => {
    const body = await (await GET(req())).json();
    expect(body.stats.refundTotal).toBe(20.5);
  });

  it('queries only REFUND transactions', async () => {
    await GET(req());
    expect(financeFindMany.mock.calls[0][0].where.transactionType).toBe('REFUND');
  });

  it('passes the date range through to the finance query', async () => {
    await GET(req('http://localhost/api/orders?dateFrom=2026-06-01&dateTo=2026-06-30'));
    const where = financeFindMany.mock.calls[0][0].where;
    expect(where.transactionDate.gte).toEqual(new Date('2026-06-01T00:00:00'));
    expect(where.transactionDate.lte).toEqual(new Date('2026-06-30T23:59:59.999'));
  });

  it('reads dateFrom and dateTo as the same local calendar days', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      await GET(req('http://localhost/api/orders?dateFrom=2026-09-01&dateTo=2026-09-30'));
      const where = financeFindMany.mock.calls[0][0].where;
      // Midnight Sept 1 to the last millisecond of Sept 30, US Eastern (UTC-4).
      expect(where.transactionDate.gte.toISOString()).toBe('2026-09-01T04:00:00.000Z');
      expect(where.transactionDate.lte.toISOString()).toBe('2026-10-01T03:59:59.999Z');
      expect(mockFilter.mock.calls[0][1].dateFrom.toISOString()).toBe('2026-09-01T04:00:00.000Z');
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });

  it('is zero, not an error, when no finance refunds exist', async () => {
    financeFindMany.mockResolvedValue([]);
    const body = await (await GET(req())).json();
    expect(body.stats.refundTotal).toBe(0);
  });

  it('adds proceedsAfterFees (Σ SALE amount) and ebayFees (Σ feeDetails)', async () => {
    financeFindMany
      .mockResolvedValueOnce([{ amount: '15.00' }]) // REFUND
      .mockResolvedValueOnce([ // SALE — amount is already net of fees
        { amount: '90.00', feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '9.50' }, { feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: '0.50' }]) },
        { amount: '45.00', feeDetails: JSON.stringify([{ feeType: 'FINAL_VALUE_FEE', amount: '5.00' }]) },
      ]);
    const body = await (await GET(req())).json();
    expect(body.stats.proceedsAfterFees).toBe(135);
    expect(body.stats.ebayFees).toBe(15);
  });

  it('queries REFUND then SALE transactions', async () => {
    await GET(req());
    expect(financeFindMany.mock.calls[0][0].where.transactionType).toBe('REFUND');
    expect(financeFindMany.mock.calls[1][0].where.transactionType).toBe('SALE');
  });

  it('fee and proceeds figures are 0, not an error, when no finance SALE rows exist', async () => {
    financeFindMany.mockResolvedValue([]);
    const body = await (await GET(req())).json();
    expect(body.stats.ebayFees).toBe(0);
    expect(body.stats.proceedsAfterFees).toBe(0);
  });
});
