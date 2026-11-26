import { it } from '@/test/store-fixture';
import { describe, expect, beforeAll, afterAll } from 'vitest';
import { migrateTestDatabase } from '@/test/database';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { mapOrder } from '../mappers/orders';
import { createPrismaOrderWriter } from './prisma-order-writer';

let dir: string;
let prisma: PrismaClient;

// Three suites each migrate a throwaway database in `beforeAll`, spawning the
// Prisma migration engine over a chain that is now 17 migrations long. Run in
// parallel with the rest of the suite that intermittently passed 120s and
// failed the whole run, though each passes comfortably alone.
//
// The timeout is per hook rather than `hookTimeout` in vitest.config.ts:
// that setting was not being applied -- the failures still reported the 120000ms
// default -- so the config would have been a comment claiming a fix that was
// not in effect.
const MIGRATE_TIMEOUT_MS = 300_000;

beforeAll(() => {
  // A real migrated database: the point is to prove the upsert key and column
  // types behave, which an in-memory fake cannot show.
  dir = mkdtempSync(join(tmpdir(), 'ebay-orders-'));
  mkdirSync(join(dir, 'prisma'), { recursive: true });
  cpSync('prisma/migrations', join(dir, 'prisma/migrations'), { recursive: true });
  writeFileSync(
    join(dir, 'prisma/schema.prisma'),
    readFileSync('prisma/schema.prisma', 'utf8').replace(
      /^\s*url\s*=.*$/m,
      '  url      = "file:./test.db"'
    )
  );
  // The local binary, not `npx`: npx re-resolves the package on every call,
  // and two suites doing that at once under a loaded machine blew the 120s
  // hook timeout and failed the whole run.
  migrateTestDatabase(dir);
  prisma = new PrismaClient({
    datasources: { db: { url: `file:${join(dir, 'prisma/test.db')}` } },
  });
}, MIGRATE_TIMEOUT_MS);

afterAll(async () => {
  await prisma?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
}, MIGRATE_TIMEOUT_MS);

function order(id: string, total = '10.00') {
  return mapOrder({
    orderId: id,
    creationDate: '2026-08-01T00:00:00.000Z',
    lastModifiedDate: '2026-08-02T00:00:00.000Z',
    orderFulfillmentStatus: 'FULFILLED',
    orderPaymentStatus: 'PAID',
    buyer: { username: 'buyer_bob' },
    pricingSummary: { total: { value: total, currency: 'USD' } },
    lineItems: [],
  });
}

describe('createPrismaOrderWriter', () => {
  it('writes new orders and reports how many', async () => {
    const writer = createPrismaOrderWriter(prisma);
    await expect(writer.upsertMany([order('W-1'), order('W-2')])).resolves.toBe(2);

    expect(await prisma.ebayOrder.count({ where: { id: { startsWith: 'W-' } } })).toBe(2);
  });

  it('updates rather than duplicating when the same order is synced again', async () => {
    const writer = createPrismaOrderWriter(prisma);
    await writer.upsertMany([order('DUP-1', '10.00')]);
    await writer.upsertMany([order('DUP-1', '99.99')]);

    const rows = await prisma.ebayOrder.findMany({ where: { id: 'DUP-1' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].totalAmount).toBe(99.99);
  });

  it('preserves createdAt across a re-sync', async () => {
    const writer = createPrismaOrderWriter(prisma);
    await writer.upsertMany([order('KEEP-1')]);
    const first = await prisma.ebayOrder.findUniqueOrThrow({ where: { storeId_id: { storeId: 'legacy', id: 'KEEP-1' } } });

    await new Promise((r) => setTimeout(r, 5));
    await writer.upsertMany([order('KEEP-1', '20.00')]);
    const second = await prisma.ebayOrder.findUniqueOrThrow({ where: { storeId_id: { storeId: 'legacy', id: 'KEEP-1' } } });

    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
  });

  it('stores no buyer email, matching the mapper', async () => {
    const writer = createPrismaOrderWriter(prisma);
    await writer.upsertMany([order('PII-1')]);

    const row = await prisma.ebayOrder.findUniqueOrThrow({ where: { storeId_id: { storeId: 'legacy', id: 'PII-1' } } });
    expect(row.buyerEmail).toBeNull();
    expect(row.buyerUsername).toBe('buyer_bob');
  });

  it('handles an empty batch without touching the database', async () => {
    await expect(createPrismaOrderWriter(prisma).upsertMany([])).resolves.toBe(0);
  });
});
