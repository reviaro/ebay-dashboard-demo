import { describe, expect, it, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { checkOrderEarnings } from './order-earnings';
import { EbayApiError } from '../errors';

describe('checkOrderEarnings', () => {
  it('reports ineligible without error on a 403', async () => {
    const client = {
      get: vi.fn().mockImplementation(async () => {
        throw new EbayApiError('Insufficient permissions to fulfill the request.', 403);
      }),
      request: vi.fn(),
    };
    const result = await checkOrderEarnings({ client: client as never, orderId: 'o1', computedNet: new Decimal('10') });
    expect(result).toEqual({ eligible: false, discrepancy: null });
  });

  it('reports ineligible on a 404 too', async () => {
    const client = {
      get: vi.fn().mockImplementation(async () => { throw new EbayApiError('not found', 404); }),
      request: vi.fn(),
    };
    const result = await checkOrderEarnings({ client: client as never, orderId: 'o1', computedNet: new Decimal('10') });
    expect(result.eligible).toBe(false);
  });

  it('rethrows an unexpected status (e.g. 500)', async () => {
    const client = {
      get: vi.fn().mockImplementation(async () => { throw new EbayApiError('server error', 500); }),
      request: vi.fn(),
    };
    await expect(
      checkOrderEarnings({ client: client as never, orderId: 'o1', computedNet: new Decimal('10') })
    ).rejects.toThrow(EbayApiError);
  });

  it('reports the absolute discrepancy against computed net when eligible', async () => {
    const client = {
      get: vi.fn().mockImplementation(async () => ({ netAmount: { value: '9.50' } })),
      request: vi.fn(),
    };
    const result = await checkOrderEarnings({ client: client as never, orderId: 'o1', computedNet: new Decimal('10') });
    expect(result.eligible).toBe(true);
    expect(result.discrepancy?.toString()).toBe('0.5');
  });
});
