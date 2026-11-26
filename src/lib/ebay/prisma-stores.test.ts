import { it } from '@/test/store-fixture';
import { describe, expect, beforeAll, afterAll } from 'vitest';
import { migrateTestDatabase } from '@/test/database';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { createPrismaStores } from './prisma-stores';

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
  // A real migrated database: the point of this file is to prove the actual
  // columns and constraints behave, which a fake store cannot show.
  dir = mkdtempSync(join(tmpdir(), 'ebay-stores-'));
  mkdirSync(join(dir, 'prisma'), { recursive: true });
  cpSync('prisma/migrations', join(dir, 'prisma/migrations'), { recursive: true });
  writeFileSync(
    join(dir, 'prisma/schema.prisma'),
    // Point the copied schema at a throwaway database. Matches the `url` line
    // in whatever form it takes -- a literal `file:...` or `env("DATABASE_URL")`
    // -- so that changing the datasource cannot silently leave this test
    // running against the real database.
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
});

describe('PrismaOAuthStateStore', () => {
  it('round-trips a state through create and consume', async () => {
    const { states } = createPrismaStores(prisma);
    const now = new Date();
    await states.create('st-ok', 'production', new Date(now.getTime() + 60_000), []);
    expect(await states.consume('st-ok', now)).not.toBeNull();
  });

  it('returns null for a state that was never created', async () => {
    const { states } = createPrismaStores(prisma);
    expect(await states.consume('st-missing', new Date())).toBeNull();
  });

  it('refuses to consume the same state twice', async () => {
    const { states } = createPrismaStores(prisma);
    const now = new Date();
    await states.create('st-replay', 'production', new Date(now.getTime() + 60_000), []);
    expect(await states.consume('st-replay', now)).not.toBeNull();
    expect(await states.consume('st-replay', now)).toBeNull();
  });

  it('refuses an expired state', async () => {
    const { states } = createPrismaStores(prisma);
    const now = new Date();
    await states.create('st-expired', 'production', new Date(now.getTime() - 1), []);
    expect(await states.consume('st-expired', now)).toBeNull();
  });

  it('lets exactly one of many concurrent consumes win', async () => {
    const { states } = createPrismaStores(prisma);
    const now = new Date();
    await states.create('st-race', 'production', new Date(now.getTime() + 60_000), []);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => states.consume('st-race', now))
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});

describe('PrismaAccountStore', () => {
  const account = {
    environment: 'production',
    marketplaceId: 'EBAY_US',
    refreshTokenCiphertext: 'ct',
    refreshTokenIv: 'iv',
    refreshTokenAuthTag: 'tag',
    refreshTokenKeyVersion: 'v1',
    refreshTokenExpiresAt: new Date('2028-03-03T12:00:00Z'),
    scopes: JSON.stringify(['https://api.ebay.com/oauth/api_scope']),
    status: 'connected' as const,
    authorizedAt: new Date('2026-09-03T00:00:00Z'),
  };

  it('stores and reads back an account', async () => {
    const { accounts } = createPrismaStores(prisma);
    await accounts.upsert(account);
    const found = await accounts.find('production');
    expect(found?.refreshTokenCiphertext).toBe('ct');
    expect(found?.refreshTokenKeyVersion).toBe('v1');
    expect(found?.status).toBe('connected');
  });

  it('replaces the existing account rather than creating a second one', async () => {
    const { accounts } = createPrismaStores(prisma);
    await accounts.upsert(account);
    await accounts.upsert({ ...account, refreshTokenCiphertext: 'ct2' });
    expect((await accounts.find('production'))?.refreshTokenCiphertext).toBe('ct2');
    expect(await prisma.ebayAccount.count({ where: { environment: 'production' } })).toBe(1);
  });

  it('keeps environments separate', async () => {
    const { accounts } = createPrismaStores(prisma);
    await accounts.upsert(account);
    await accounts.upsert({ ...account, environment: 'sandbox', refreshTokenCiphertext: 'sbx' });
    expect((await accounts.find('production'))?.refreshTokenCiphertext).toBe('ct');
    expect((await accounts.find('sandbox'))?.refreshTokenCiphertext).toBe('sbx');
  });

  it('returns null when nothing is connected', async () => {
    const { accounts } = createPrismaStores(prisma);
    expect(await accounts.find('nonexistent-env')).toBeNull();
  });

  it('clear removes the stored token entirely', async () => {
    const { accounts } = createPrismaStores(prisma);
    await accounts.upsert({ ...account, environment: 'to-clear' });
    await accounts.clear('to-clear');
    expect(await accounts.find('to-clear')).toMatchObject({ status: 'disconnected', refreshTokenCiphertext: '' });
  });

  it('a delayed refresh failure cannot restore disconnected credentials', async () => {
    const { accounts } = createPrismaStores(prisma);
    const saved = { ...account, environment: 'disconnect-race' };
    await accounts.upsert(saved);
    await accounts.clear(saved.environment);
    await accounts.upsert({ ...saved, status: 'reauthorization_required' });
    expect(await accounts.find(saved.environment)).toMatchObject({ status: 'disconnected', refreshTokenCiphertext: '' });
  });
});
