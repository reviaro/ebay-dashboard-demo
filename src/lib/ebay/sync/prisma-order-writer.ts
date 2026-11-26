import { withStoreData } from '@/lib/stores/context';
/**
 * Persists mapped orders.
 *
 * Upsert keyed on the eBay order id, so re-running a sync over an overlapping
 * window updates rather than duplicates -- which is what makes the whole sync
 * safe to retry. `createdAt` is left alone on update so the first-seen time
 * survives; `syncedAt` moves so freshness is visible.
 */

import type { PrismaClient } from '@prisma/client';
import type { MappedOrder } from '../mappers/orders';
import type { OrderWriter } from './orders';

export function createPrismaOrderWriter(prisma: PrismaClient): OrderWriter {
  return {
    async upsertMany(orders: MappedOrder[]): Promise<number> {
      let written = 0;

      for (const order of orders) {
        const { id, ...fields } = order;
        await prisma.ebayOrder.upsert({
          where: { storeId_id: withStoreData({ id: id }) },
          create: withStoreData({ id, ...fields }),
          update: fields,
        });
        written++;
      }

      return written;
    },
  };
}
