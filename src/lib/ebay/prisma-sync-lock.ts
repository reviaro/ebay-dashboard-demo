import { withStoreData } from '@/lib/stores/context';
/**
 * `EbaySyncLock`-backed {@link SyncLockStore}.
 *
 * Both acquisition paths are single statements, so SQLite serialises them and
 * two racing runs cannot both win: the `UPDATE` matches only an expired lease,
 * and the `INSERT` is refused by the unique index on `name`.
 */

import type { PrismaClient } from '@prisma/client';
import type { SyncLockRow, SyncLockStore } from './sync-lock';

/** Prisma's unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

export function createPrismaSyncLockStore(prisma: PrismaClient): SyncLockStore {
  return {
    async takeOverExpired(name, owner, now, expiresAt): Promise<number> {
      const { count } = await prisma.ebaySyncLock.updateMany({
        where: { name, expiresAt: { lte: now } },
        data: { owner, acquiredAt: now, expiresAt },
      });
      return count;
    },

    async insert(name, owner, now, expiresAt): Promise<boolean> {
      try {
        await prisma.ebaySyncLock.create({
          data: withStoreData({ name, owner, acquiredAt: now, expiresAt }),
        });
        return true;
      } catch (error) {
        // Only a unique violation means "someone holds it". Anything else --
        // a locked database, a schema problem -- must surface, or two syncs
        // would be allowed to run at once.
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },

    async release(name, owner): Promise<void> {
      await prisma.ebaySyncLock.deleteMany({ where: { name, owner } });
    },

    async find(name): Promise<SyncLockRow | null> {
      return prisma.ebaySyncLock.findUnique({ where: { storeId_name: withStoreData({ name: name }) } });
    },
  };
}
