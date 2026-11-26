import { describe, expect, it, vi } from 'vitest';
import { beforeEach, afterEach } from 'vitest';
import { EbayApiError } from '../errors';
import { syncOrders, type OrderWriter } from './orders';

function order(id: string, modified = '2026-08-02T00:00:00.000Z') {
  return {
    orderId: id,
    creationDate: '2026-08-01T00:00:00.000Z',
    lastModifiedDate: modified,
    orderFulfillmentStatus: 'FULFILLED',
    orderPaymentStatus: 'PAID',
    pricingSummary: { total: { value: '10.00', currency: 'USD' } },
    lineItems: [],
  };
}

/** Collects what the sync would persist, without a database. */
function writer() {
  const rows = new Map<string, unknown>();
  const w: OrderWriter & { rows: Map<string, unknown> } = {
    async upsertMany(batch) {
      for (const row of batch) rows.set(row.id, row);
      return batch.length;
    },
    rows,
  };
  return w;
}

/** A client whose GET returns queued pages in order. */
function client(pages: unknown[]) {
  const get = vi.fn(async () => pages.shift() ?? { orders: [], total: 0 });
  return { get, request: vi.fn() } as never;
}

const RANGE = {
  from: new Date('2026-08-01T00:00:00Z'),
  to: new Date('2026-08-10T00:00:00Z'),
};

describe('syncOrders', () => {
  it('stores the orders it fetches', async () => {
    const w = writer();
    const result = await syncOrders({
      client: client([{ orders: [order('A'), order('B')], total: 2 }]),
      writer: w,
      range: RANGE,
    });

    expect(result.fetched).toBe(2);
    expect([...w.rows.keys()]).toEqual(['A', 'B']);
  });

  it('follows pagination until the page is short', async () => {
    const w = writer();
    const c = client([
      { orders: [order('A'), order('B')], total: 3, limit: 2, offset: 0 },
      { orders: [order('C')], total: 3, limit: 2, offset: 2 },
    ]);

    const result = await syncOrders({ client: c, writer: w, range: RANGE, pageSize: 2 });

    expect(result.fetched).toBe(3);
    expect(w.rows.size).toBe(3);
  });

  it('requests only GET, never a mutating method', async () => {
    const c = client([{ orders: [], total: 0 }]);
    await syncOrders({ client: c, writer: writer(), range: RANGE });

    // The read-only guard would block a write anyway; this proves the sync does
    // not even try, so the guard is never load-bearing in normal operation.
    expect((c as unknown as { request: ReturnType<typeof vi.fn> }).request)
      .not.toHaveBeenCalled();
  });

  it('filters by lastmodifieddate so an edited old order is picked up', async () => {
    const c = client([{ orders: [], total: 0 }]);
    await syncOrders({ client: c, writer: writer(), range: RANGE });

    const [, options] = (c as unknown as { get: ReturnType<typeof vi.fn> }).get
      .mock.calls[0];
    expect(String(options.query.filter)).toContain('lastmodifieddate');
  });

  it('asks eBay through the exact current instant, not midnight of today', async () => {
    // A refresh always requests `to: now()`, a precise timestamp partway
    // through today. Chunking works in whole UTC days, but the *newest*
    // chunk's upper bound must still carry that exact instant -- rounding it
    // down to midnight would silently exclude every order touched today, on
    // every run, forever (the bug this test guards against).
    const preciseNow = new Date('2026-09-03T19:28:00.000Z');
    const c = client([{ orders: [], total: 0 }, { orders: [], total: 0 }]);

    await syncOrders({
      client: c,
      writer: writer(),
      range: { from: new Date('2026-08-01T00:00:00Z'), to: preciseNow },
      now: preciseNow,
    });

    const calls = (c as unknown as { get: ReturnType<typeof vi.fn> }).get.mock.calls;
    const filters = calls.map(([, options]) => String(options.query.filter));
    expect(filters.some((f) => f.includes(preciseNow.toISOString()))).toBe(true);
  });

  it('splits a long range into chunks within the 30-day API window', async () => {
    const c = client([]);
    await syncOrders({
      client: c,
      writer: writer(),
      range: {
        from: new Date('2026-06-06T00:00:00Z'),
        to: new Date('2026-09-03T00:00:00Z'),
      },
      // Keep the retention boundary aligned with this fixed range.
      now: new Date('2026-09-03T00:00:00Z'),
    });

    const calls = (c as unknown as { get: ReturnType<typeof vi.fn> }).get.mock
      .calls.length;
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('clamps a range older than eBay exposes and says so', async () => {
    const result = await syncOrders({
      client: client([]),
      writer: writer(),
      range: {
        from: new Date('2025-01-01T00:00:00Z'),
        to: new Date('2026-09-03T00:00:00Z'),
      },
      now: new Date('2026-09-03T00:00:00Z'),
    });

    // Never silently shorten: the caller has to be able to tell the operator.
    expect(result.clamped).toBe(true);
    expect(result.effectiveFrom.getTime()).toBeGreaterThan(
      new Date('2026-05-01T00:00:00Z').getTime()
    );
  });

  it('makes no request when the whole range predates eBay retention', async () => {
    const c = client([]);
    const result = await syncOrders({
      client: c,
      writer: writer(),
      range: {
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-02-01T00:00:00Z'),
      },
      now: new Date('2026-09-03T00:00:00Z'),
    });

    expect(result.outOfRetention).toBe(true);
    expect(result.fetched).toBe(0);
    expect((c as unknown as { get: ReturnType<typeof vi.fn> }).get)
      .not.toHaveBeenCalled();
  });

  it('is idempotent: running twice stores each order once', async () => {
    const w = writer();
    const args = { writer: w, range: RANGE };

    await syncOrders({ ...args, client: client([{ orders: [order('A')], total: 1 }]) });
    await syncOrders({ ...args, client: client([{ orders: [order('A')], total: 1 }]) });

    expect(w.rows.size).toBe(1);
  });

  it('reports an empty result rather than failing when there are no orders', async () => {
    const result = await syncOrders({
      client: client([{ orders: [], total: 0 }]),
      writer: writer(),
      range: RANGE,
    });

    expect(result.fetched).toBe(0);
    expect(result.stored).toBe(0);
  });

  it('skips an unmappable order but keeps the rest and counts it', async () => {
    const w = writer();
    const result = await syncOrders({
      client: client([
        { orders: [order('A'), { orderId: 'B', creationDate: 'broken' }, order('C')], total: 3 },
      ]),
      writer: w,
      range: RANGE,
    });

    // One malformed order must not abandon a whole sync run.
    expect(result.stored).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain('B');
  });

  it('propagates an API failure rather than reporting a silent success', async () => {
    const failing = {
      get: vi.fn(async () => {
        throw new EbayApiError('upstream exploded', 500);
      }),
      request: vi.fn(),
    } as never;

    await expect(
      syncOrders({ client: failing, writer: writer(), range: RANGE })
    ).rejects.toThrow(EbayApiError);
  });

  it('stops after the page cap so a bad cursor cannot loop forever', async () => {
    const endless = {
      get: vi.fn(async () => ({ orders: [order(`o-${Math.random()}`)], total: 1e9 })),
      request: vi.fn(),
    } as never;

    const result = await syncOrders({
      client: endless,
      writer: writer(),
      range: RANGE,
      pageSize: 1,
      maxPages: 5,
    });

    expect(result.fetched).toBe(5);
    expect(result.truncated).toBe(true);
  });
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-01T12:00:00Z')); });
afterEach(() => vi.useRealTimers());
