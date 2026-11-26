import { withStoreData } from '@/lib/stores/context';
/**
 * Persists finance transactions and payouts.
 *
 * Batched into `$transaction`s for the same reason as `prisma-traffic-writer.ts`:
 * SQLite syncs to disk per statement, so upserting a backfill one row at a time
 * measures in single-digit rows/second. One transaction per batch is one sync.
 *
 * Transactions are keyed on `[accountId, transactionId]` (eBay's own id), so a
 * re-fetch of the settling window overwrites rather than duplicating. Payouts
 * are keyed on eBay's `payoutId`.
 */

import type { PrismaClient } from '@prisma/client';
import type { MappedFinanceTransaction } from '../mappers/finance-transaction';
import type { MappedPayout } from '../mappers/payout';

export interface FinanceStore {
  saveTransactions(rows: MappedFinanceTransaction[]): Promise<number>;
  savePayouts(rows: MappedPayout[]): Promise<number>;
  attachPayout(accountId: string, transactionId: string, payoutId: string): Promise<void>;
  /**
   * Earliest transaction date stored, or null if nothing is synced yet -- the
   * boundary `/api/profitability` uses to decide where the CSV fallback ends.
   */
  earliestTransactionDate(): Promise<Date | null>;
}

/** Bounded so one transaction cannot hold the single SQLite writer too long. */
const BATCH_SIZE = 250;

function batches<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) out.push(rows.slice(i, i + BATCH_SIZE));
  return out;
}

export function createPrismaFinanceStore(prisma: PrismaClient): FinanceStore {
  return {
    async saveTransactions(rows: MappedFinanceTransaction[]): Promise<number> {
      for (const batch of batches(rows)) {
        await prisma.$transaction(
          batch.map((row) => {
            const { accountId, transactionId, ...rest } = row;
            return prisma.ebayFinanceTransaction.upsert({
              where: { storeId_accountId_transactionId: withStoreData({ accountId, transactionId }) },
              create: withStoreData({ accountId, transactionId, ...rest }),
              update: { ...rest },
            });
          })
        );
      }
      return rows.length;
    },

    async savePayouts(rows: MappedPayout[]): Promise<number> {
      for (const batch of batches(rows)) {
        await prisma.$transaction(
          batch.map((row) => {
            const { id, ...rest } = row;
            return prisma.ebayPayout.upsert({
              where: { storeId_id: withStoreData({ id: id }) },
              create: withStoreData({ id, ...rest }),
              update: { ...rest },
            });
          })
        );
      }
      return rows.length;
    },

    async attachPayout(accountId: string, transactionId: string, payoutId: string): Promise<void> {
      await prisma.ebayFinanceTransaction.update({
        where: { storeId_accountId_transactionId: withStoreData({ accountId, transactionId }) },
        data: { payoutId },
      });
    },

    async earliestTransactionDate(): Promise<Date | null> {
      const row = await prisma.ebayFinanceTransaction.findFirst({
        orderBy: { transactionDate: 'asc' },
        select: { transactionDate: true },
      });
      return row?.transactionDate ?? null;
    },
  };
}
