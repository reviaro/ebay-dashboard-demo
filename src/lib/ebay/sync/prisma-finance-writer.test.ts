import { it } from '@/test/store-fixture';
import { describe, expect, beforeAll, afterAll } from 'vitest';
import { migrateTestDatabase } from '@/test/database';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createPrismaFinanceStore } from './prisma-finance-writer';
import type { MappedFinanceTransaction } from '../mappers/finance-transaction';

let dir: string;
let prisma: PrismaClient;

// Same throwaway-migrated-DB pattern as prisma-order-writer.test.ts /
// prisma-chunk-store.test.ts: the point is the Decimal column and the
// accountId+transactionId upsert key, which a fake cannot show. Per-hook
// timeout because vitest.config.ts's hookTimeout was never taking effect.
const MIGRATE_TIMEOUT_MS = 300_000;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ebay-finance-'));
  mkdirSync(join(dir, 'prisma'), { recursive: true });
  cpSync('prisma/migrations', join(dir, 'prisma/migrations'), { recursive: true });
  writeFileSync(
    join(dir, 'prisma/schema.prisma'),
    readFileSync('prisma/schema.prisma', 'utf8').replace(/^\s*url\s*=.*$/m, '  url      = "file:./test.db"')
  );
  migrateTestDatabase(dir);
  prisma = new PrismaClient({ datasources: { db: { url: `file:${join(dir, 'prisma/test.db')}` } } });
}, MIGRATE_TIMEOUT_MS);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const txn = (over: Partial<MappedFinanceTransaction> = {}): MappedFinanceTransaction => ({
  accountId: 'acct-1',
  transactionId: 't1',
  transactionDate: new Date('2026-06-01T00:00:00.000Z'),
  bookingEntry: 'CREDIT',
  transactionType: 'SALE',
  amount: new Decimal('10.00'),
  feeDetails: null,
  orderId: null,
  payoutId: null,
  salesRecordRef: null,
  marketplaceId: 'EBAY_US',
  rawPayload: '{}',
  ...over,
});

describe('createPrismaFinanceStore', () => {
  it('upserts a transaction, keyed on accountId+transactionId', async () => {
    const store = createPrismaFinanceStore(prisma);

    await store.saveTransactions([txn({ transactionId: 'up1' })]);
    await store.saveTransactions([txn({ transactionId: 'up1', amount: new Decimal('12.50') })]);

    const stored = await prisma.ebayFinanceTransaction.findMany({ where: { accountId: 'acct-1', transactionId: 'up1' } });
    expect(stored).toHaveLength(1);
    expect(stored[0].amount.toString()).toBe('12.5');
  }, 60000);

  it('keeps rows for the same transactionId under different accounts apart', async () => {
    const store = createPrismaFinanceStore(prisma);
    await store.saveTransactions([txn({ accountId: 'a', transactionId: 'shared' }), txn({ accountId: 'b', transactionId: 'shared' })]);
    expect(await prisma.ebayFinanceTransaction.count({ where: { transactionId: 'shared' } })).toBe(2);
  }, 60000);

  it('upserts a payout keyed on its eBay payoutId', async () => {
    const store = createPrismaFinanceStore(prisma);
    const payout = {
      id: 'p1', accountId: 'acct-1', payoutDate: new Date('2026-06-02T00:00:00.000Z'),
      payoutStatus: 'SUCCEEDED', amount: new Decimal('100.00'), transactionCount: 3, rawPayload: '{}',
    };

    await store.savePayouts([payout]);
    await store.savePayouts([{ ...payout, payoutStatus: 'REVERSED' }]);

    const stored = await prisma.ebayPayout.findMany({ where: { id: 'p1' } });
    expect(stored).toHaveLength(1);
    expect(stored[0].payoutStatus).toBe('REVERSED');
    expect(stored[0].amount.toString()).toBe('100');
  }, 60000);

  it('attaches a payoutId to an already-stored transaction', async () => {
    const store = createPrismaFinanceStore(prisma);
    await store.saveTransactions([txn({ transactionId: 'att1' })]);

    await store.attachPayout('acct-1', 'att1', 'p-att');

    const stored = await prisma.ebayFinanceTransaction.findFirst({ where: { accountId: 'acct-1', transactionId: 'att1' } });
    expect(stored?.payoutId).toBe('p-att');
  }, 60000);

  it('reports the earliest stored transactionDate for the profitability coverage boundary', async () => {
    const store = createPrismaFinanceStore(prisma);
    await store.saveTransactions([
      txn({ accountId: 'earliest', transactionId: 'e2', transactionDate: new Date('2026-05-15T00:00:00.000Z') }),
      txn({ accountId: 'earliest', transactionId: 'e1', transactionDate: new Date('2026-03-02T00:00:00.000Z') }),
    ]);

    const earliest = await store.earliestTransactionDate();
    expect(earliest?.getTime()).toBe(new Date('2026-03-02T00:00:00.000Z').getTime());
  }, 60000);
});
