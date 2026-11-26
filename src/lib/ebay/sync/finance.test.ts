import { describe, expect, it, vi } from 'vitest';
import { FinanceFetchError, fetchPayoutWindow, fetchTransactionWindow } from './finance';

function fakeClient(pages: (Record<string, unknown> | null)[]) {
  let call = 0;
  return {
    get: vi.fn().mockImplementation(async () => pages[call++]),
    request: vi.fn(),
  };
}

const txn = (id: string, date = '2026-06-01T00:00:00.000Z') => ({
  transactionId: id,
  transactionDate: date,
  transactionType: 'SALE',
  bookingEntry: 'CREDIT',
  amount: { value: '10.00', currency: 'USD' },
});

describe('fetchTransactionWindow', () => {
  it('collects every page and returns mapped rows', async () => {
    const client = fakeClient([
      { total: 2, transactions: [txn('t1')], next: 'https://apiz.ebay.com/sell/finances/v1/transaction?offset=200' },
      { total: 2, transactions: [txn('t2', '2026-06-02T00:00:00.000Z')] },
    ]);

    const rows = await fetchTransactionWindow({
      client: client as never,
      accountId: 'acct-1',
      marketplaceId: 'EBAY_US',
      from: new Date('2026-06-01'),
      to: new Date('2026-06-02'),
    });

    expect(rows.map((r) => r.transactionId)).toEqual(['t1', 't2']);
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it('sends a transactionDate range filter and paginates by offset', async () => {
    const client = fakeClient([{ total: 1, transactions: [txn('t1')] }]);

    await fetchTransactionWindow({
      client: client as never,
      accountId: 'acct-1',
      marketplaceId: 'EBAY_US',
      from: new Date('2026-06-01T12:00:00Z'),
      to: new Date('2026-06-30T09:00:00Z'),
    });

    const [path, opts] = client.get.mock.calls[0];
    expect(path).toBe('/sell/finances/v1/transaction');
    expect(opts.query.filter).toBe('transactionDate:[2026-06-01T00:00:00.000Z..2026-06-30T23:59:59.999Z]');
    expect(opts.query.offset).toBe(0);
  });

  it('throws when the rows collected do not match eBay-reported total', async () => {
    const client = fakeClient([{ total: 5, transactions: [txn('t1')] }]);

    await expect(
      fetchTransactionWindow({
        client: client as never,
        accountId: 'acct-1',
        marketplaceId: 'EBAY_US',
        from: new Date('2026-06-01'),
        to: new Date('2026-06-02'),
      })
    ).rejects.toThrow(FinanceFetchError);
  });

  it('does not throw a completeness error when eBay omits total', async () => {
    const client = fakeClient([{ transactions: [txn('t1')] }]);

    const rows = await fetchTransactionWindow({
      client: client as never,
      accountId: 'acct-1',
      marketplaceId: 'EBAY_US',
      from: new Date('2026-06-01'),
      to: new Date('2026-06-02'),
    });
    expect(rows).toHaveLength(1);
  });

  it('treats a bare null body (empty window) as zero rows', async () => {
    const client = fakeClient([null]);
    const rows = await fetchTransactionWindow({
      client: client as never,
      accountId: 'acct-1',
      marketplaceId: 'EBAY_US',
      from: new Date('2026-06-01'),
      to: new Date('2026-06-02'),
    });
    expect(rows).toEqual([]);
  });
});

describe('fetchPayoutWindow', () => {
  it('collects payouts across pages', async () => {
    const client = fakeClient([
      {
        total: 1,
        payouts: [
          { payoutId: 'p1', payoutStatus: 'SUCCEEDED', amount: { value: '100.00' }, payoutDate: '2026-06-02T00:00:00.000Z', transactionCount: 3 },
        ],
      },
    ]);

    const rows = await fetchPayoutWindow({
      client: client as never,
      accountId: 'acct-1',
      from: new Date('2026-06-01'),
      to: new Date('2026-06-03'),
    });

    expect(rows.map((r) => r.id)).toEqual(['p1']);
    expect(client.get.mock.calls[0][1].query.filter).toBe('payoutDate:[2026-06-01T00:00:00.000Z..2026-06-03T23:59:59.999Z]');
  });

  it('throws when payout pages do not match the reported total', async () => {
    const client = fakeClient([{ total: 4, payouts: [] }]);
    await expect(
      fetchPayoutWindow({ client: client as never, accountId: 'acct-1', from: new Date('2026-06-01'), to: new Date('2026-06-03') })
    ).rejects.toThrow(FinanceFetchError);
  });

  it('treats a bare null body as zero payouts', async () => {
    const client = fakeClient([null]);
    const rows = await fetchPayoutWindow({
      client: client as never, accountId: 'acct-1', from: new Date('2026-06-01'), to: new Date('2026-06-03'),
    });
    expect(rows).toEqual([]);
  });
});
