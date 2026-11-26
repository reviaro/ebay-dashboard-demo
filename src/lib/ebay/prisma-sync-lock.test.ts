import { it } from '@/test/store-fixture';
import { describe, expect, vi } from 'vitest';
import { createPrismaSyncLockStore } from './prisma-sync-lock';

const now = new Date('2026-09-04T12:00:00.000Z');
const expiresAt = new Date('2026-09-04T12:30:00.000Z');

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    ebaySyncLock: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides,
    },
  } as never;
}

describe('createPrismaSyncLockStore', () => {
  it('takes over only a lease that has already expired', async () => {
    const prisma = fakePrisma({ updateMany: vi.fn().mockResolvedValue({ count: 1 }) });

    const count = await createPrismaSyncLockStore(prisma).takeOverExpired('orders', 'cli:1', now, expiresAt);

    expect(count).toBe(1);
    expect((prisma as never as { ebaySyncLock: { updateMany: ReturnType<typeof vi.fn> } }).ebaySyncLock.updateMany)
      .toHaveBeenCalledWith({
        where: { name: 'orders', expiresAt: { lte: now } },
        data: { owner: 'cli:1', acquiredAt: now, expiresAt },
      });
  });

  it('reports a live lease as a refusal rather than throwing', async () => {
    // Prisma raises P2002 when the unique index on `name` rejects the insert.
    const conflict = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const prisma = fakePrisma({ create: vi.fn().mockRejectedValue(conflict) });

    await expect(createPrismaSyncLockStore(prisma).insert('orders', 'cli:1', now, expiresAt))
      .resolves.toBe(false);
  });

  it('reports a successful insert as acquired', async () => {
    await expect(createPrismaSyncLockStore(fakePrisma()).insert('orders', 'cli:1', now, expiresAt))
      .resolves.toBe(true);
  });

  // A locked-up database is not the same as "someone else holds the lease",
  // and swallowing it would let two syncs run at once.
  it('lets an unexpected database error surface', async () => {
    const prisma = fakePrisma({ create: vi.fn().mockRejectedValue(new Error('database is locked')) });

    await expect(createPrismaSyncLockStore(prisma).insert('orders', 'cli:1', now, expiresAt))
      .rejects.toThrow('database is locked');
  });

  it('releases only its own lease', async () => {
    const prisma = fakePrisma();
    await createPrismaSyncLockStore(prisma).release('orders', 'cli:1');

    expect((prisma as never as { ebaySyncLock: { deleteMany: ReturnType<typeof vi.fn> } }).ebaySyncLock.deleteMany)
      .toHaveBeenCalledWith({ where: { name: 'orders', owner: 'cli:1' } });
  });
});
