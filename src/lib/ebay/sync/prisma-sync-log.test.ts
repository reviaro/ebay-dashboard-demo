import { it } from '@/test/store-fixture';
import { describe, expect, vi } from 'vitest';
import { createPrismaSyncLog } from './prisma-sync-log';

function fakePrisma() {
  const create = vi.fn().mockResolvedValue({ id: 7 });
  const update = vi.fn().mockResolvedValue({});
  return { prisma: { ebaySyncLog: { create, update } } as never, create, update };
}

describe('createPrismaSyncLog', () => {
  it('opens a row marked running and returns its id', async () => {
    const { prisma, create } = fakePrisma();
    const startedAt = new Date('2026-09-04T12:00:00.000Z');

    const id = await createPrismaSyncLog(prisma).start('orders', startedAt);

    expect(id).toBe(7);
    expect(create).toHaveBeenCalledWith({
      data: { storeId: 'legacy', type: 'orders', status: 'running', startedAt },
    });
  });

  it('closes the row it opened', async () => {
    const { prisma, update } = fakePrisma();
    const finishedAt = new Date('2026-09-04T12:00:05.000Z');

    await createPrismaSyncLog(prisma).finish(7, {
      status: 'ok', count: 42, message: null, finishedAt,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'ok', count: 42, message: null, finishedAt },
    });
  });
});
