import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { migrateTestDatabase, testDatabaseUrl } from '@/test/database';
import { runInStore, withStoreData } from './context';
import { createScopedClient } from './scoped-client';
import { createPrismaStores } from '../ebay/prisma-stores';
import { createUserSession } from '../auth/user-session';
import { loadAuthConfig, SESSION_COOKIE_NAME } from '../auth/config';
import { withStore, tokenHash } from './route';

vi.setConfig({ testTimeout: 30000 });
const database = vi.hoisted(() => ({ raw: null as unknown as PrismaClient, scoped: null as unknown as PrismaClient }));
vi.mock('@/lib/prisma', () => ({
  adminDb: new Proxy({}, { get: (_, key) => { const v = database.raw[key as keyof PrismaClient]; return typeof v === 'function' ? v.bind(database.raw) : v; } }),
  default: new Proxy({}, { get: (_, key) => { const v = database.scoped[key as keyof PrismaClient]; return typeof v === 'function' ? v.bind(database.scoped) : v; } }),
}));
const a = { storeId: 'legacy', actorId: 'owner', role: 'admin' as const, sessionId: 's1', marketplaceId: 'EBAY_US' };
const b = { ...a, storeId: 'second' };
let directory: string;
let ownerCookie: string;
let viewerCookie: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'stores-security-'));
  mkdirSync(join(directory, 'prisma'));
  cpSync('prisma/migrations', join(directory, 'prisma/migrations'), { recursive: true });
  migrateTestDatabase(directory);
  database.raw = new PrismaClient({ datasources: { db: { url: testDatabaseUrl(directory) } } });
  database.scoped = createScopedClient(database.raw);
  await database.raw.store.create({ data: { id: 'second', name: 'Store 2' } });
  for (const id of ['owner', 'viewer']) await database.raw.user.create({ data: { id, username: id, displayName: id } });
  await database.raw.storeMembership.createMany({ data: [{ storeId: 'legacy', userId: 'owner', role: 'admin' }, { storeId: 'second', userId: 'owner', role: 'admin' }, { storeId: 'legacy', userId: 'viewer', role: 'viewer' }] });
  vi.stubEnv('DASHBOARD_SESSION_SECRET', Buffer.alloc(32, 9).toString('base64'));
  vi.stubEnv('DASHBOARD_PASSWORD_HASH', '');
  const config = loadAuthConfig();
  ownerCookie = `${SESSION_COOKIE_NAME}=${await createUserSession('owner', config)}`;
  viewerCookie = `${SESSION_COOKIE_NAME}=${await createUserSession('viewer', config)}`;
}, 30000);
afterAll(async () => { await database.raw?.$disconnect(); if (directory) rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe('real database store isolation', () => {
  it('fails closed without an authorized store and disallows global models/raw SQL', async () => {
    await expect(database.scoped.task.findMany()).rejects.toThrow(/store/i);
    await runInStore(a, async () => {
      await expect(database.scoped.user.findMany()).rejects.toThrow(/Unscoped/);
      await expect(database.scoped.$queryRawUnsafe('SELECT * FROM Task')).rejects.toThrow(/Unscoped/);
    });
  });
  it('allows overlapping SKUs, item IDs, uploads, and checkpoints while keeping results separate', async () => {
    await Promise.all([a, b].map(context => runInStore(context, async () => {
      await database.scoped.inventory.create({ data: withStoreData({ itemId: '123', sku: 'SAME-SKU', title: context.storeId, brand: 'Volvo', price: 20 }) });
      await database.scoped.uploadRecord.create({ data: withStoreData({ contentHash: 'same-file', filename: 'report.csv', type: 'inventory' }) });
      await database.scoped.ebaySyncSetting.create({ data: withStoreData({ domain: 'overlap-test', frequency: 'manual' }) });
      expect((await database.scoped.inventory.findMany()).map(row => row.title)).toEqual([context.storeId]);
      expect(await database.scoped.uploadRecord.count()).toBe(1);
    })));
    expect(await database.raw.inventory.count()).toBe(2);
  });
  it('blocks guessed IDs, forged ownership, and a compound upsert targeting another store', async () => {
    const other = await database.raw.inventory.findFirstOrThrow({ where: { storeId: 'second' } });
    await runInStore(a, async () => {
      expect(await database.scoped.inventory.findUnique({ where: { id: other.id } })).toBeNull();
      await expect(database.scoped.inventory.update({ where: { id: other.id }, data: { title: 'leak' } })).rejects.toMatchObject({ code: 'P2025' });
      await expect(database.scoped.inventory.updateMany({ data: { storeId: 'second' } })).rejects.toThrow(/ownership/);
      await expect(database.scoped.inventory.upsert({ where: { storeId_sku: { storeId: 'second', sku: 'SAME-SKU' } }, create: withStoreData({ sku: 'SAME-SKU', title: 'bad', brand: '', price: 1 }), update: { title: 'bad' } })).rejects.toThrow(/mismatch/);
    });
    expect((await database.raw.inventory.findUniqueOrThrow({ where: { id: other.id } })).title).toBe('second');
  });
  it('scopes transactions and mass deletes, including transaction callbacks', async () => {
    await runInStore(a, async () => {
      await database.scoped.$transaction(async tx => { await tx.inventory.updateMany({ data: { price: 30 } }); });
      await database.scoped.$transaction([database.scoped.uploadRecord.deleteMany()]);
    });
    expect((await database.raw.inventory.findFirstOrThrow({ where: { storeId: 'second' } })).price).toBe(20);
    expect(await database.raw.uploadRecord.count({ where: { storeId: 'second' } })).toBe(1);
  });
  it('binds OAuth state to the initiating user, session and store', async () => {
    const stores = createPrismaStores(database.scoped);
    await runInStore(a, () => stores.states.create('bound-state', 'sandbox', new Date(Date.now() + 60000), ['base']));
    for (const wrong of [b, { ...a, actorId: 'viewer' }, { ...a, sessionId: 'other-session' }]) await runInStore(wrong, async () => expect(await stores.states.consume('bound-state', new Date())).toBeNull());
    await runInStore(a, async () => {
      expect(await stores.states.consume('bound-state', new Date())).toMatchObject({ environment: 'sandbox', scopes: ['base'] });
      expect(await stores.states.consume('bound-state', new Date())).toBeNull();
    });
  });
});

const handler = withStore('view', async () => Response.json(await database.scoped.inventory.findMany()));
const edit = withStore('edit', async () => Response.json({ ok: true }));
const publish = withStore('publish', async () => Response.json({ ok: true }));
function request(store: string, cookie = ownerCookie, method = 'GET', origin = 'http://localhost') {
  return new Request(`http://localhost/api/inventory?store=${store}`, { method, headers: { cookie, origin, host: 'localhost' } });
}
describe('authorization at the actual HTTP boundary', () => {
  it('denies missing identity, missing store, and a store without membership', async () => {
    expect((await handler(request('legacy', ''))).status).toBe(401);
    expect((await handler(new Request('http://localhost/api/inventory', { headers: { cookie: ownerCookie } }))).status).toBe(400);
    expect((await handler(request('second', viewerCookie))).status).toBe(404);
  });
  it('returns only the chosen store and denies viewer edits and cross-origin writes', async () => {
    const response = await handler(request('legacy', viewerCookie));
    expect(response.status).toBe(200);
    expect((await response.json()).map((r: { storeId: string }) => r.storeId)).toEqual(['legacy']);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await edit(request('legacy', viewerCookie, 'POST'))).status).toBe(403);
    expect((await edit(request('legacy', ownerCookie, 'POST', 'https://evil.example'))).status).toBe(403);
  });
  it('enforces role changes and session revocation without waiting for cookie expiry', async () => {
    await database.raw.storeMembership.update({ where: { storeId_userId: { storeId: 'legacy', userId: 'viewer' } }, data: { role: 'editor' } });
    expect((await edit(request('legacy', viewerCookie, 'POST'))).status).toBe(200);
    expect((await publish(request('legacy', viewerCookie, 'POST'))).status).toBe(403);
    await database.raw.storeMembership.delete({ where: { storeId_userId: { storeId: 'legacy', userId: 'viewer' } } });
    expect((await handler(request('legacy', viewerCookie))).status).toBe(404);
    await database.raw.userSession.deleteMany({ where: { userId: 'viewer' } });
    expect((await handler(request('legacy', viewerCookie))).status).toBe(401);
  });
  it('limits agent tokens to one store and the task-edit capability; revocation is immediate', async () => {
    const key = await database.raw.agentKey.create({ data: { storeId: 'legacy', name: 'Test agent', tokenHash: tokenHash('token-1'), canEditTasks: true } });
    const agent = (store: string, path = 'tasks', method = 'GET') => new Request(`http://localhost/api/agent/${path}?store=${store}`, { method, headers: { authorization: 'Bearer token-1' } });
    expect((await handler(agent('legacy'))).status).toBe(200);
    expect((await handler(agent('second'))).status).toBe(401);
    // Header forms the pre-store agent guard accepted must keep working after the upgrade.
    for (const authorization of ['bearer token-1', 'Bearer   token-1', 'Bearer token-1  ', 'BEARER token-1'])
      expect((await handler(new Request('http://localhost/api/agent/tasks?store=legacy', { headers: { authorization } }))).status).toBe(200);
    for (const authorization of ['token-1', 'Bearer', 'Bearer token-1 extra', 'Basic token-1'])
      expect((await handler(new Request('http://localhost/api/agent/tasks?store=legacy', { headers: { authorization } }))).status).toBe(401);
    expect((await edit(agent('legacy', 'tasks', 'POST'))).status).toBe(200);
    expect((await edit(agent('legacy', 'inventory', 'POST'))).status).toBe(403);
    expect((await publish(agent('legacy', 'tasks', 'POST'))).status).toBe(403);
    expect((await handler(new Request('http://localhost/api/inventory?store=legacy', { headers: { authorization: 'Bearer token-1' } }))).status).toBe(401);
    await database.raw.agentKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    expect((await handler(agent('legacy'))).status).toBe(401);
  });
});
