import { it } from '@/test/store-fixture';
import { describe, expect, beforeAll, afterAll } from 'vitest';
import { migrateTestDatabase } from '@/test/database';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { createPrismaChunkStore } from './prisma-chunk-store';
import { runChunked } from './checkpoints';

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
  // A real migrated database: the unique key and the resume behaviour are the
  // point, and an in-memory fake cannot show either.
  dir = mkdtempSync(join(tmpdir(), 'ebay-chunks-'));
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

const day = (n: number) => new Date(Date.UTC(2026, 8, n));
const ranges = [
  { from: day(1), to: day(2) },
  { from: day(2), to: day(3) },
];

describe('createPrismaChunkStore', () => {
  it('resumes a run instead of redoing committed chunks', async () => {
    const store = createPrismaChunkStore(prisma);
    const runKey = 'orders:resume';

    // First pass: the second chunk fails.
    let call = 0;
    const first = await runChunked({
      store, runKey, domain: 'orders', ranges,
      work: async () => { if (++call === 2) throw new Error('eBay 500'); },
    });
    expect(first).toMatchObject({ completed: 1, failed: 1, skipped: 0 });

    // Second pass: only the failed chunk is retried.
    const retried: string[] = [];
    const second = await runChunked({
      store, runKey, domain: 'orders', ranges,
      work: async (chunk) => { retried.push(chunk.rangeStart.toISOString()); },
    });

    expect(retried).toEqual([day(2).toISOString()]);
    expect(second).toMatchObject({ completed: 1, skipped: 1 });
  }, 60000);

  it('records the failure on the chunk that failed', async () => {
    const store = createPrismaChunkStore(prisma);
    const runKey = 'orders:error';
    await runChunked({
      store, runKey, domain: 'orders', ranges: [ranges[0]],
      work: async () => { throw new Error('rate limited'); },
    });

    const row = await prisma.ebaySyncChunk.findFirst({ where: { runKey } });
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    expect(row?.lastError).toContain('rate limited');
  }, 60000);

  it('reuses rows across runs rather than duplicating the window', async () => {
    const store = createPrismaChunkStore(prisma);
    const runKey = 'orders:idempotent';
    const work = async () => {};

    await runChunked({ store, runKey, domain: 'orders', ranges, work });
    await runChunked({ store, runKey, domain: 'orders', ranges, work });

    expect(await prisma.ebaySyncChunk.count({ where: { runKey } })).toBe(2);
  }, 60000);

  it('stores externalId via setExternalId', async () => {
    const store = createPrismaChunkStore(prisma);
    const runKey = 'ads:external-id-store';

    await store.ensure(runKey, 'ads', ranges);
    await store.setExternalId(runKey, ranges[0].from, ranges[0].to, 'task-789');

    const row = await prisma.ebaySyncChunk.findFirst({ where: { runKey } });
    expect(row?.externalId).toBe('task-789');
  }, 60000);

  it('includes externalId in pending()', async () => {
    const store = createPrismaChunkStore(prisma);
    const runKey = 'ads:external-id-pending';

    await store.ensure(runKey, 'ads', ranges);
    await store.setExternalId(runKey, ranges[0].from, ranges[0].to, 'task-999');

    const pending = await store.pending(runKey);
    const chunk = pending.find((c) => c.rangeStart.getTime() === day(1).getTime());
    expect(chunk?.externalId).toBe('task-999');
  }, 60000);
});
