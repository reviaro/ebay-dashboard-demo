import { withStoreData } from '@/lib/stores/context';
/**
 * `EbaySyncLog`-backed {@link SyncRunRecorder}.
 *
 * A row opens as `running` and is updated in place, so a crashed sync leaves a
 * `running` row behind rather than no row at all -- which is the difference
 * between "it died" and "it never started". Readers must treat a stale
 * `running` row as a failure, not as work in progress.
 */

import type { PrismaClient } from '@prisma/client';
import type { SyncRunRecorder, SyncRunUpdate } from './run-log';

export function createPrismaSyncLog(prisma: PrismaClient): SyncRunRecorder {
  return {
    async start(type: string, startedAt: Date): Promise<number> {
      const row = await prisma.ebaySyncLog.create({
        data: withStoreData({ type, status: 'running', startedAt }),
      });
      return row.id;
    },

    async finish(id: number, update: SyncRunUpdate): Promise<void> {
      await prisma.ebaySyncLog.update({
        where: { id },
        data: {
          status: update.status,
          count: update.count,
          message: update.message,
          finishedAt: update.finishedAt,
        },
      });
    },
  };
}
