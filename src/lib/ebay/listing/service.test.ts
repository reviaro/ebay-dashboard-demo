import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { migrateTestDatabase, testDatabaseUrl } from '@/test/database';
import { runInStore, withStoreData } from '@/lib/stores/context';
import { createScopedClient } from '@/lib/stores/scoped-client';
import { encryptToken, parseEncryptionKeys } from '../token-store';
import { EBAY_READ_SCOPES } from '../read-only';
import { emptyListing, itemXml, parseListing } from './model';
import { enqueueListing, processListingOperation, recoverInterruptedOperations, releaseUncertainCreate, RELEASE_WAIT_MS, remoteSnapshot, validateDraft, fromRemote, revisionBody } from './service';
import { tradingWrite, TradingError } from './trading';

vi.setConfig({ testTimeout: 30000 });
const db = vi.hoisted(() => ({ raw: null as unknown as PrismaClient, scoped: null as unknown as PrismaClient }));
vi.mock('@/lib/prisma', () => ({
  adminDb: new Proxy({}, { get: (_, key) => { const v = db.raw[key as keyof PrismaClient]; return typeof v === 'function' ? v.bind(db.raw) : v; } }),
  default: new Proxy({}, { get: (_, key) => { const v = db.scoped[key as keyof PrismaClient]; return typeof v === 'function' ? v.bind(db.scoped) : v; } }),
}));
const context = { storeId: 'legacy', actorId: 'publisher', role: 'publisher' as const, marketplaceId: 'EBAY_US' };
const sample = { ...emptyListing(), title: 'Used Volvo alternator', sku: 'A-01', description: 'Tested used part.', price: '45.00', categoryId: '33573', conditionDescription: 'Scratches on housing.', postalCode: '22406', paymentPolicyId: '1', returnPolicyId: '2', fulfillmentPolicyId: '3', pictureUrls: ['https://i.ebayimg.com/images/example.jpg'] };
let directory: string;
let creates: number;
let interrupt: boolean;
let lastXml: string;
let getItem: (() => Response) | null;
let tokenExchanges = 0;
const xmlResponse = (method: string, content = '') => new Response(`<${method}Response><Ack>Success</Ack>${content}</${method}Response>`, { status: 200 });

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'listing-security-'));
  mkdirSync(join(directory, 'prisma'));
  cpSync('prisma/migrations', join(directory, 'prisma/migrations'), { recursive: true });
  migrateTestDatabase(directory);
  db.raw = new PrismaClient({ datasources: { db: { url: testDatabaseUrl(directory) } } });
  db.scoped = createScopedClient(db.raw);
  const key = Buffer.alloc(32, 4).toString('base64');
  for (const [name, value] of Object.entries({ EBAY_ENVIRONMENT: 'sandbox', EBAY_CLIENT_ID: 'test', EBAY_CLIENT_SECRET: 'secret', EBAY_RUNAME: 'test-runame', EBAY_TOKEN_ENCRYPTION_KEY: key })) vi.stubEnv(name, value);
  await db.raw.user.create({ data: { id: 'publisher', username: 'publisher', displayName: 'Publisher' } });
  await db.raw.storeMembership.create({ data: { storeId: 'legacy', userId: 'publisher', role: 'publisher' } });
  const token = encryptToken('fake-refresh-token', parseEncryptionKeys(key));
  await db.raw.ebayAccount.create({ data: { id: 'account1', storeId: 'legacy', environment: 'sandbox', marketplaceId: 'EBAY_US', sellerId: 'seller-id', username: 'seller-name', refreshTokenCiphertext: token.ciphertext, refreshTokenIv: token.iv, refreshTokenAuthTag: token.authTag, refreshTokenKeyVersion: token.keyVersion, scopes: JSON.stringify([...EBAY_READ_SCOPES, 'https://api.ebay.com/oauth/api_scope/sell.inventory']), status: 'connected', authorizedAt: new Date() } });
}, 30000);
beforeEach(async () => {
  creates = 0; interrupt = false; lastXml = ''; getItem = null;
  await db.raw.store.update({ where: { id: 'legacy' }, data: { writeEnabled: true } });
  await db.raw.storeMembership.update({ where: { storeId_userId: { storeId: 'legacy', userId: 'publisher' } }, data: { role: 'publisher' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/oauth2/token')) { tokenExchanges++; return Response.json({ access_token: 'fake-access-token', expires_in: 7200 }); }
    expect(url).toBe('https://api.sandbox.ebay.com/ws/api.dll');
    const method = new Headers(options?.headers).get('X-EBAY-API-CALL-NAME')!;
    if (method === 'VerifyAddFixedPriceItem') return xmlResponse(method, '<Fees><Fee><Name>InsertionFee</Name><Fee currencyID="USD">0.35</Fee></Fee></Fees>');
    if (method === 'AddFixedPriceItem') {
      creates++; lastXml = String(options?.body);
      if (interrupt) throw new Error('socket reset');
      return xmlResponse(method, `<ItemID>${Date.now()}${creates}</ItemID>`);
    }
    if (method === 'GetItem' && getItem) return getItem();
    if (method === 'GetItem') throw new Error('Snapshot lookup temporarily unavailable');
    throw new Error('Unexpected API request');
  }));
});
afterAll(async () => { await db.raw?.$disconnect(); if (directory) rmSync(directory, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function draft() {
  return db.scoped.listingDraft.create({ data: withStoreData({ createdById: 'publisher', title: sample.title, payload: JSON.stringify({ ...sample, sku: randomBytes(5).toString('hex') }) }) });
}
const key = () => randomBytes(16).toString('hex');

describe('publishing safety with a real database and mocked eBay', () => {
  it('preserves separate Seller Hub values when another item specific changes', () => {
    const item = { ItemID: '123', SKU: 'part', ItemSpecifics: { NameValueList: [{ Name: 'Placement', Value: ['Front', 'Left'] }, { Name: 'Brand', Value: 'OEM' }] } };
    const before = fromRemote(item);
    const specifics = before.specifics.map(s => s.name === 'Brand' ? { ...s, value: 'Updated' } : s);
    const body = revisionBody({ ...before, specifics }, [], item, key());
    expect(body).toContain('<Name>Placement</Name><Value>Front</Value><Value>Left</Value>');
    expect(body).toContain('<Name>Brand</Name><Value>Updated</Value>');
    expect(revisionBody({ ...before, specifics: [] }, [], item, key())).toContain('<DeletedField>Item.ItemSpecifics</DeletedField>');
  });
  it('preserves untouched Seller Hub HTML and fields during a price revision', () => {
    const item = { ItemID: '123', SKU: 'part', Title: 'Part', Description: '<p><em>Seller Hub formatting</em></p>', StartPrice: '20.00', Quantity: '2', SellingStatus: { QuantitySold: '1' }, InventoryTrackingMethod: 'SKU' };
    const before = fromRemote(item);
    const body = revisionBody({ ...before, price: '25.00' }, [], item, key());
    expect(body).toContain('<StartPrice>25.00</StartPrice>');
    expect(body).not.toContain('<Description>');
    expect(body).not.toContain('<Title>');
    expect(body).not.toContain('<Quantity>');
  });
  it('reuses the seller access token instead of exchanging the refresh token on every request', async () => runInStore(context, async () => {
    const first = await draft(); await validateDraft(first.id, first.version);
    const before = tokenExchanges;
    const second = await draft(); await validateDraft(second.id, second.version);
    const job = await enqueueListing(second.id, second.version, key()); await processListingOperation(job.id);
    expect(tokenExchanges).toBe(before);
  }));
  it('validates without publishing and rejects stale versions', async () => runInStore(context, async () => {
    const row = await draft();
    const check = await validateDraft(row.id, row.version);
    expect(check.fees).toEqual([{ name: 'InsertionFee', amount: '0.35', currency: 'USD' }]);
    expect(creates).toBe(0);
    await expect(enqueueListing(row.id, 99, key())).rejects.toThrow(/Validate/);
  }));
  it('deduplicates publication and claims a queued request only once', async () => runInStore(context, async () => {
    const row = await draft(); await validateDraft(row.id, row.version);
    const idempotencyKey = key();
    const first = await enqueueListing(row.id, row.version, idempotencyKey);
    const second = await enqueueListing(row.id, row.version, idempotencyKey);
    expect(second.id).toBe(first.id);
    await Promise.all([processListingOperation(first.id), processListingOperation(first.id)]);
    expect(creates).toBe(1);
    expect(lastXml).toContain(`<UUID>${idempotencyKey.toUpperCase()}</UUID>`);
    expect((await db.raw.listingOperation.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('succeeded');
    expect((await db.raw.listingDraft.findUniqueOrThrow({ where: { id: row.id } })).publishedPayload).toContain(sample.title);
  }));
  it.each(['disabled-store', 'revoked-publisher'])('rechecks %s after enqueue and before any eBay write', async mode => runInStore(context, async () => {
    const row = await draft(); await validateDraft(row.id, row.version);
    const job = await enqueueListing(row.id, row.version, key());
    if (mode === 'disabled-store') await db.raw.store.update({ where: { id: 'legacy' }, data: { writeEnabled: false } });
    else await db.raw.storeMembership.update({ where: { storeId_userId: { storeId: 'legacy', userId: 'publisher' } }, data: { role: 'viewer' } });
    await processListingOperation(job.id);
    expect(creates).toBe(0);
    expect((await db.raw.listingOperation.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('failed');
  }));
  it('never replays a create after an ambiguous network failure', async () => runInStore(context, async () => {
    const row = await draft(); await validateDraft(row.id, row.version);
    const job = await enqueueListing(row.id, row.version, key()); interrupt = true;
    await processListingOperation(job.id); await processListingOperation(job.id);
    expect(creates).toBe(1);
    expect((await db.raw.listingOperation.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('unknown');
    await expect(enqueueListing(row.id, row.version, key())).rejects.toThrow(/Validate/);
  }));
  it('holds an interrupted worker for reconciliation instead of requeueing it', async () => runInStore(context, async () => {
    const row = await draft(); await validateDraft(row.id, row.version);
    const job = await enqueueListing(row.id, row.version, key());
    await db.raw.listingOperation.update({ where: { id: job.id }, data: { status: 'running', startedAt: new Date(Date.now() - 20 * 60000) } });
    await recoverInterruptedOperations();
    expect((await db.raw.listingOperation.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('unknown');
    expect(creates).toBe(0);
  }));
  async function uncertainCreate(ageMs = RELEASE_WAIT_MS + 1000) {
    const row = await draft(); await validateDraft(row.id, row.version);
    const requestKey = key();
    const job = await enqueueListing(row.id, row.version, requestKey); interrupt = true;
    await processListingOperation(job.id); interrupt = false;
    await db.raw.listingOperation.update({ where: { id: job.id }, data: { finishedAt: new Date(Date.now() - ageMs) } });
    return { row, job, requestKey };
  }
  const notFound = () => new Response('<GetItemResponse><Ack>Failure</Ack><Errors><ErrorCode>17</ErrorCode><LongMessage>Item not found.</LongMessage></Errors></GetItemResponse>', { status: 200 });
  it('releases an uncertain create that eBay never made, without sending anything, and requires fresh validation', async () => runInStore(context, async () => {
    const { row, job } = await uncertainCreate(); getItem = notFound;
    expect(await releaseUncertainCreate(job.id)).toBe('released');
    expect(creates).toBe(1);
    expect((await db.raw.listingOperation.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('abandoned');
    const released = await db.raw.listingDraft.findUniqueOrThrow({ where: { id: row.id } });
    expect([released.status, released.version, released.validation]).toEqual(['draft', row.version + 1, null]);
    expect(await db.raw.auditEvent.count({ where: { action: 'listing.create.released', entityId: job.id } })).toBe(1);
    await expect(enqueueListing(row.id, released.version, key())).rejects.toThrow(/Validate/);
    await expect(releaseUncertainCreate(job.id)).rejects.toThrow(/Only an uncertain/);
  }));
  it('records the publication instead of releasing when eBay shows this request’s listing', async () => runInStore(context, async () => {
    const { row, job, requestKey } = await uncertainCreate();
    const sku = JSON.parse(row.payload).sku;
    getItem = () => xmlResponse('GetItem', `<Item><ItemID>110099</ItemID><UUID>${requestKey.toUpperCase()}</UUID><SKU>${sku}</SKU><Title>Used Volvo alternator</Title><StartPrice>45.00</StartPrice><Quantity>1</Quantity><ListingType>FixedPriceItem</ListingType><Site>US</Site><Seller><UserID>seller-name</UserID></Seller><SellingStatus><ListingStatus>Active</ListingStatus><QuantitySold>0</QuantitySold></SellingStatus></Item>`);
    expect(await releaseUncertainCreate(job.id)).toBe('published');
    expect((await db.raw.listingOperation.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('succeeded');
    const published = await db.raw.listingDraft.findUniqueOrThrow({ where: { id: row.id } });
    expect([published.status, published.listingId]).toEqual(['published', '110099']);
  }));
  it('refuses to release too soon or when eBay cannot be asked', async () => runInStore(context, async () => {
    const early = await uncertainCreate(60_000); getItem = notFound;
    await expect(releaseUncertainCreate(early.job.id)).rejects.toThrow(/Wait 10 minutes/);
    const unreachable = await uncertainCreate(); getItem = null;
    await expect(releaseUncertainCreate(unreachable.job.id)).rejects.toThrow(/could not be reached/);
    for (const { job } of [early, unreachable]) expect((await db.raw.listingOperation.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('unknown');
  }));
  it('treats a write refused by the permission check as a certain failure, with nothing sent', async () => runInStore(context, async () => {
    await db.raw.store.update({ where: { id: 'legacy' }, data: { writeEnabled: false } });
    const error = await tradingWrite({ marketplaceId: 'EBAY_US', apiBaseUrl: 'https://api.sandbox.ebay.com' } as never, 'token', 'AddFixedPriceItem', '', 'account1').catch(e => e);
    expect(error).toBeInstanceOf(TradingError);
    expect(error.uncertain).toBe(false);
    expect(creates).toBe(0);
  }));
  it('lets a sold-out published listing keep zero available but requires stock for a new one', () => {
    const soldOut = fromRemote({ Title: 'Part', SKU: 'A-01', StartPrice: '10.00', Quantity: '3', SellingStatus: { QuantitySold: '3' } });
    expect(soldOut.quantity).toBe(0);
    expect(parseListing(soldOut).quantity).toBe(0);
    expect(parseListing({ ...sample, quantity: 0 }, true, true).quantity).toBe(0);
    expect(() => parseListing({ ...sample, quantity: 0 }, true)).toThrow(/at least 1/);
    expect(() => parseListing({ ...sample, quantity: -1 })).toThrow(/Quantity/);
  });
  it('escapes listing text and detects Seller Hub edits while ignoring views', () => {
    const body = itemXml({ ...sample, title: 'Part <script> & "OEM"', description: '<script>alert(1)</script>' }, sample.pictureUrls, { uuid: key() });
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;');
    expect(() => parseListing({ ...sample, price: '-1' }, true)).toThrow(/price/);
    const original = { Title: 'Part', StartPrice: '10', WatchCount: '1' };
    expect(remoteSnapshot({ ...original, WatchCount: '9' })).toBe(remoteSnapshot(original));
    expect(remoteSnapshot({ ...original, Title: 'Edited in Seller Hub' })).not.toBe(remoteSnapshot(original));
  });
});
