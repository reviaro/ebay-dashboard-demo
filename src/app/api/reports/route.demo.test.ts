import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/user-session', () => ({ currentUser: () => ({ user: { id: 'sample-viewer' } }) }));

const reads = vi.hoisted(() => ({ orders: vi.fn(), transactions: vi.fn(), ledger: vi.fn(), inventory: vi.fn(), finance: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ adminDb: { storeMembership: { findUnique: () => ({ role: 'viewer', store: { marketplaceId: 'EBAY_US' } }) } }, default: {
  ebayTransaction: { findMany: reads.transactions },
  ebayFinanceTransaction: { findMany: reads.ledger },
  ebayOffer: { count: reads.inventory },
} }));
vi.mock('@/lib/orders/store', () => ({ loadUnifiedOrders: reads.orders }));
vi.mock('@/lib/orders/unified', () => ({ filterOrders: (rows: unknown[]) => rows }));
vi.mock('@/lib/finance/summary', () => ({ loadFinanceSummary: reads.finance }));
import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DEMO_MODE', '1');
  reads.orders.mockResolvedValue([{ soldFor: 100, shipping: 20, quantity: 1, brand: 'Sample', shipToCountry: 'United States' }]);
  reads.transactions.mockResolvedValue([{ type: 'Order', itemSubtotal: 100, netAmount: 105 }]);
  reads.inventory.mockResolvedValue(60);
  reads.finance.mockResolvedValue({ grossRevenue: 120, byBrand: [{ brand: 'Sample', grossRevenue: 120, units: 1 }] });
  reads.ledger.mockResolvedValue([{ bookingEntry: 'CREDIT', amount: '105' }, { bookingEntry: 'DEBIT', amount: '10' }]);
});
afterEach(() => vi.unstubAllEnvs());

describe('downloaded demo report reconciliation', () => {
  it('uses gross receipts including shipping and the same settlement ledger as Profit & Ads', async () => {
    const body = await (await GET(new Request('http://demo.test/api/reports?store=northstar'))).json();
    expect(body.sales.revenue).toBe(120);
    expect(body.topBrands).toEqual([{ brand: 'Sample', revenue: 120, units: 1 }]);
    expect(body.transactionActivity).toEqual({ orderRevenue: 120, netAfterEbayActivity: 95, deductionRatePct: 25 / 120 * 100 });
    expect(body.generatedAt).toBe('2026-09-30T23:59:59.999Z');
    expect(body.notes.join(' ')).toContain('collected shipping exactly once');
  });

  it('retains the existing ordinary-mode source and calculations', async () => {
    vi.stubEnv('DEMO_MODE', '0');
    const body = await (await GET(new Request('http://demo.test/api/reports?store=northstar'))).json();
    expect(body.sales.revenue).toBe(100);
    expect(body.transactionActivity.orderRevenue).toBe(100);
    expect(body.transactionActivity.netAfterEbayActivity).toBe(105);
    expect(reads.finance).not.toHaveBeenCalled();
    expect(reads.ledger).not.toHaveBeenCalled();
  });
});
