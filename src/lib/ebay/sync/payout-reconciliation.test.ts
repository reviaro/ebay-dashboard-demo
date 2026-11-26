import { describe, expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { reconcilePayouts } from './payout-reconciliation';

/**
 * `payout_summary` is called once per calendar month (it truncates `amount`
 * over wider windows). These synthetic mocks return a per-month figure keyed
 * off the filter's start month.
 */
const perMonth: Record<string, { payoutCount: number; amount: { value: string } }> = {
  '2026-06': { payoutCount: 4, amount: { value: '400.00' } },
  '2026-07': { payoutCount: 3, amount: { value: '300.00' } },
  '2026-08': { payoutCount: 5, amount: { value: '500.00' } },
};

const monthClient = () => ({
  get: vi.fn().mockImplementation(async (_path: string, opts: { query: { filter: string } }) => {
    const month = opts.query.filter.slice('payoutDate:['.length, 'payoutDate:['.length + 7);
    return perMonth[month] ?? null;
  }),
  request: vi.fn(),
});

describe('reconcilePayouts', () => {
  it('sums payout_summary per calendar month and matches the stored total', async () => {
    const client = monthClient();
    const result = await reconcilePayouts({
      client: client as never,
      from: new Date('2026-06-01'),
      to: new Date('2026-08-31'),
      stored: async () => ({ count: 12, amount: new Decimal('1200.00') }),
    });

    expect(client.get).toHaveBeenCalledTimes(3);
    expect(result.ebayCount).toBe(12);
    expect(result.ebayAmount.toString()).toBe('1200');
    expect(result.matches).toBe(true);
    expect(result.months.map(m => m.month)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(result.months[2]).toMatchObject({ count: 5 });
  });

  it('builds one whole-calendar-month filter per month in range', async () => {
    const client = monthClient();
    await reconcilePayouts({
      client: client as never,
      from: new Date('2026-07-10'),
      to: new Date('2026-08-20'),
      stored: async () => ({ count: 8, amount: new Decimal('800.00') }),
    });
    expect(client.get.mock.calls.map(c => c[1].query.filter)).toEqual([
      'payoutDate:[2026-07-01T00:00:00.000Z..2026-07-31T23:59:59.999Z]',
      'payoutDate:[2026-08-01T00:00:00.000Z..2026-08-31T23:59:59.999Z]',
    ]);
  });

  it('flags a count mismatch without throwing', async () => {
    const client = monthClient();
    const result = await reconcilePayouts({
      client: client as never,
      from: new Date('2026-06-01'),
      to: new Date('2026-08-31'),
      stored: async () => ({ count: 9, amount: new Decimal('1200.00') }),
    });
    expect(result.matches).toBe(false);
    expect(result.storedCount).toBe(9);
    expect(result.ebayCount).toBe(12);
  });

  it('flags an amount mismatch without throwing', async () => {
    const client = monthClient();
    const result = await reconcilePayouts({
      client: client as never,
      from: new Date('2026-06-01'),
      to: new Date('2026-08-31'),
      stored: async () => ({ count: 12, amount: new Decimal('1180.00') }),
    });
    expect(result.matches).toBe(false);
  });

  it('treats a null month body as a zero summary for that month', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(null),
      request: vi.fn(),
    };
    const result = await reconcilePayouts({
      client: client as never,
      from: new Date('2026-06-01'),
      to: new Date('2026-06-30'),
      stored: async () => ({ count: 0, amount: new Decimal('0') }),
    });
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(result.matches).toBe(true);
    expect(result.ebayCount).toBe(0);
    expect(result.months).toEqual([{ month: '2026-06', count: 0, amount: new Decimal('0') }]);
  });
});
