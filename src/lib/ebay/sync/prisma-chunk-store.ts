import { withStoreData } from '@/lib/stores/context';
/**
 * `EbaySyncChunk`-backed {@link ChunkStore}.
 *
 * `ensure` upserts with an empty update, so re-running a chunked job over the
 * same window reuses the existing rows rather than resetting them -- which is
 * what makes the checkpoints survive a retry. (`createMany`'s `skipDuplicates`
 * would say this more directly, but Prisma does not support it on SQLite.)
 */

import type { PrismaClient } from '@prisma/client';
import type { ChunkRange, ChunkRecord, ChunkStore } from './checkpoints';

/** Long enough to diagnose, short enough not to bloat the row. */
const ERROR_LIMIT = 500;

export function createPrismaChunkStore(prisma: PrismaClient): ChunkStore {
  const where = (runKey: string, from: Date, to: Date) => ({
    storeId_runKey_rangeStart_rangeEnd: withStoreData({ runKey, rangeStart: from, rangeEnd: to }),
  });

  return {
    async ensure(runKey: string, domain: string, ranges: ChunkRange[]): Promise<void> {
      for (const range of ranges) {
        await prisma.ebaySyncChunk.upsert({
          where: where(runKey, range.from, range.to),
          create: withStoreData({ runKey, domain, rangeStart: range.from, rangeEnd: range.to }),
          // Deliberately empty: an existing chunk keeps its status and attempts.
          update: {},
        });
      }
    },

    async pending(runKey: string): Promise<ChunkRecord[]> {
      const rows = await prisma.ebaySyncChunk.findMany({
        where: { runKey, status: { not: 'done' } },
        orderBy: { rangeStart: 'asc' },
      });
      return rows.map((row) => ({
        rangeStart: row.rangeStart,
        rangeEnd: row.rangeEnd,
        status: row.status,
        attempts: row.attempts,
        cursor: row.cursor,
        externalId: row.externalId,
      }));
    },

    async markAttempt(runKey, from, to): Promise<void> {
      await prisma.ebaySyncChunk.update({
        where: where(runKey, from, to),
        data: { attempts: { increment: 1 } },
      });
    },

    async markDone(runKey, from, to): Promise<void> {
      await prisma.ebaySyncChunk.update({
        where: where(runKey, from, to),
        data: { status: 'done', lastError: null },
      });
    },

    async markFailed(runKey, from, to, error): Promise<void> {
      await prisma.ebaySyncChunk.update({
        where: where(runKey, from, to),
        data: { status: 'failed', lastError: error.slice(0, ERROR_LIMIT) },
      });
    },

    async setExternalId(runKey, from, to, externalId): Promise<void> {
      await prisma.ebaySyncChunk.update({
        where: where(runKey, from, to),
        data: { externalId },
      });
    },
  };
}
