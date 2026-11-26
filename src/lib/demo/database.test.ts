import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { runInStore } from '../stores/context';
import { DEMO_STORE_ID } from './config';
import { demoDatabaseSha256, writeDemoManifest } from './seed-safety';

it('rejects writes and raw SQL through both clients, including within interactive transactions', async () => {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
  };
  const directory = mkdtempSync(join(tmpdir(), 'demo-read-only-test-'));
  mkdirSync(join(directory, 'prisma'));
  const path = join(directory, 'prisma', 'demo.db');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE Store (id TEXT PRIMARY KEY);
    INSERT INTO Store VALUES ('northstar');
    CREATE TABLE Inventory (id INTEGER PRIMARY KEY, storeId TEXT NOT NULL);
    INSERT INTO Inventory VALUES (1, 'northstar'), (2, 'other-sample');
  `);
  db.close();
  writeDemoManifest(path);
  chmodSync(path, 0o444);
  const before = demoDatabaseSha256(path);
  vi.stubEnv('DEMO_MODE', '1');
  vi.stubEnv('DATABASE_URL', 'file:./demo.db');
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  const uid = process.getuid && vi.spyOn(process, 'getuid').mockReturnValue(1000);
  let admin: PrismaClient | undefined;
  try {
    const { adminDb, default: scoped } = await import('../prisma');
    admin = adminDb;
    expect(await adminDb.store.findMany({ select: { id: true } })).toEqual([{ id: DEMO_STORE_ID }]);
    await expect(adminDb.store.deleteMany()).rejects.toThrow('Demo database accepts only model reads.');
    await expect(adminDb.$queryRaw`SELECT 1`).rejects.toThrow('Demo database accepts only model reads.');
    await expect(adminDb.$transaction(tx => tx.store.deleteMany())).rejects.toThrow('Demo database accepts only model reads.');
    await expect(adminDb.$transaction(tx => tx.$executeRawUnsafe('DELETE FROM Store'))).rejects.toThrow('Demo database accepts only model reads.');

    await runInStore({ storeId: DEMO_STORE_ID, actorId: 'demo:viewer', role: 'viewer', marketplaceId: 'EBAY_US' }, async () => {
      expect(await scoped.inventory.findMany({ select: { id: true } })).toEqual([{ id: 1 }]);
      expect(await scoped.$transaction(tx => tx.inventory.count())).toBe(1);
      await expect(scoped.inventory.deleteMany()).rejects.toThrow('Demo database accepts only model reads.');
      await expect(scoped.$queryRaw`SELECT 1`).rejects.toThrow('Demo database accepts only model reads.');
      await expect(scoped.$transaction(tx => tx.inventory.deleteMany())).rejects.toThrow('Demo database accepts only model reads.');
      await expect(scoped.$transaction(tx => tx.$queryRawUnsafe('SELECT 1'))).rejects.toThrow('Demo database accepts only model reads.');
    });
    expect(demoDatabaseSha256(path)).toBe(before);
  } finally {
    await admin?.$disconnect();
    cwd.mockRestore();
    uid?.mockRestore();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
