import { LISTING_WRITE_SCOPE } from '../read-only';
import { createHash, randomBytes } from 'node:crypto';
import { parse } from 'node-html-parser';
import prisma, { adminDb } from '../../prisma';
import { requireStoreContext, withStoreData, runInStore } from '../../stores/context';
import { loadEbayConfig } from '../config';
import { createPrismaStores } from '../prisma-stores';
import { createTokenProvider } from '../access-token';
import { exchangeWithEbay } from '../token-exchange';
import { tradingRead, tradingWrite, TradingError, asArray, xmlValue } from './trading';
import { emptyListing, parseListing, itemXml, xml, type ListingInput } from './model';
import { uploadPhotos } from './assets';
import { assertListingWrite } from './write-access';

/**
 * One token provider per store and environment, kept for the life of the
 * process. A provider built per call never reuses its cached access token, so
 * every validate, publish, reconcile and policy lookup paid for a full
 * refresh-token exchange with eBay.
 *
 * Keyed by store because the provider's account lookup runs through the
 * store-scoped client: a provider must only ever serve the store it was built
 * for. The provider still re-reads the account on each call and drops its
 * token when the grant changes, so a disconnect or reconnect takes effect
 * immediately.
 */
const tokenProviders = new Map<string, ReturnType<typeof createTokenProvider>>();

export async function listingConnection() {
  const config = loadEbayConfig();
  const { storeId, marketplaceId } = requireStoreContext();
  config.marketplaceId = marketplaceId ?? config.marketplaceId;
  config.scopes = [...config.scopes, LISTING_WRITE_SCOPE];
  const accounts = createPrismaStores(prisma).accounts;
  const account = await accounts.find(config.environment);
  if (!account?.id || account.status !== 'connected') throw new Error('Connect this store to eBay first.');
  const providerKey = `${storeId}:${config.environment}`;
  let tokens = tokenProviders.get(providerKey);
  if (!tokens) {
    tokens = createTokenProvider({ config, accounts, exchange: exchangeWithEbay });
    tokenProviders.set(providerKey, tokens);
  }
  return { config, account, token: await tokens.getAccessToken() };
}

type Connection = Awaited<ReturnType<typeof listingConnection>>;
const snapshotKeys = ['ItemID', 'SKU', 'Title', 'Description', 'StartPrice', 'Quantity', 'PrimaryCategory', 'ConditionID', 'ConditionDescription', 'PostalCode', 'SellerProfiles', 'PictureDetails', 'ItemSpecifics', 'ItemCompatibilityList', 'InventoryTrackingMethod', 'SellingStatus'];
export function remoteSnapshot(item: Record<string, any>): string {
  const values = Object.fromEntries(snapshotKeys.map(key => [key, item[key] ?? null]));
  // Views/watchers and other volatile reporting fields are deliberately absent.
  values.SellingStatus = { QuantitySold: item.SellingStatus?.QuantitySold, ListingStatus: item.SellingStatus?.ListingStatus };
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
async function remote(connection: Connection, selector: { listingId?: string; sku?: string }) {
  const response = await tradingRead(connection.config, connection.token, 'GetItem', '<DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics><IncludeItemCompatibilityList>true</IncludeItemCompatibilityList>' + (selector.listingId ? `<ItemID>${xml(selector.listingId)}</ItemID>` : `<SKU>${xml(selector.sku)}</SKU>`));
  const item = response.Item;
  if (!item || !connection.account.username || String(item.Seller?.UserID).toLowerCase() !== connection.account.username.toLowerCase()) throw new Error('This listing does not belong to the selected seller. Reconnect if the seller username changed.');
  if (item.ListingType !== 'FixedPriceItem' || item.Variations || item.Site !== 'US') throw new Error('Only single-SKU fixed-price listings on eBay US are supported.');
  if (item.SellingStatus?.ListingStatus !== 'Active') throw new Error('This listing is no longer active.');
  return item;
}

export function fromRemote(item: Record<string, any>): ListingInput {
  const payload = emptyListing();
  const profiles = item.SellerProfiles;
  return {
    ...payload, title: xmlValue(item.Title), description: parse(xmlValue(item.Description).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p>/gi, '\n')).text.trim(), sku: xmlValue(item.SKU),
    price: xmlValue(item.StartPrice), quantity: Math.max(0, Number(item.Quantity) - Number(item.SellingStatus?.QuantitySold ?? 0)),
    categoryId: xmlValue(item.PrimaryCategory?.CategoryID), conditionId: xmlValue(item.ConditionID), conditionDescription: xmlValue(item.ConditionDescription), postalCode: xmlValue(item.PostalCode),
    paymentPolicyId: xmlValue(profiles?.SellerPaymentProfile?.PaymentProfileID), returnPolicyId: xmlValue(profiles?.SellerReturnProfile?.ReturnProfileID), fulfillmentPolicyId: xmlValue(profiles?.SellerShippingProfile?.ShippingProfileID),
    pictureUrls: asArray<any>(item.PictureDetails?.PictureURL).map(xmlValue),
    specifics: asArray<any>(item.ItemSpecifics?.NameValueList).map(s => ({ name: xmlValue(s.Name), value: asArray<any>(s.Value).map(xmlValue).join('\n') })),
    compatibility: asArray<any>(item.ItemCompatibilityList?.Compatibility).map(v => {
      const fields = Object.fromEntries(asArray<any>(v.NameValueList).map(s => [xmlValue(s.Name).toLowerCase(), xmlValue(s.Value)]));
      return { year: fields.year ?? '', make: fields.make ?? '', model: fields.model ?? '', trim: fields.trim ?? '', engine: fields.engine ?? '', notes: xmlValue(v.CompatibilityNotes) };
    }),
  };
}

export async function refreshDraft(id: string, version: number) {
  const draft = await prisma.listingDraft.findUniqueOrThrow({ where: { id } });
  if (!draft.listingId || draft.version !== version || ['queued', 'running', 'unknown'].includes(draft.status)) throw new Error('This draft cannot be refreshed right now. Reload it first.');
  const connection = await listingConnection();
  const item = await remote(connection, { listingId: draft.listingId });
  const payload = fromRemote(item);
  const result = await prisma.listingDraft.updateMany({ where: { id, version, status: draft.status }, data: { payload: JSON.stringify(payload), title: payload.title, remoteSnapshot: remoteSnapshot(item), publishedPayload: JSON.stringify(payload), version: { increment: 1 }, validation: null, status: 'draft' } });
  if (!result.count) throw new Error('The draft changed. Reload it.');
  return prisma.listingDraft.findUniqueOrThrow({ where: { id } });
}

type Validation = { accountId: string; version: number; at: string; fees: { name: string; amount: string; currency: string }[]; warnings: string[] };
/** Send only changed fields; preserve Seller Hub HTML and other untouched data. */
export function revisionBody(payload: ListingInput, photos: string[], item: Record<string, any>, idempotencyKey: string): string {
  const before = fromRemote(item);
  if (payload.sku !== before.sku) throw new Error('The SKU cannot be changed here.');
  const generated = itemXml(payload, photos, { listingId: xmlValue(item.ItemID), soldQuantity: Number(item.SellingStatus?.QuantitySold ?? 0) });
  const groups: [keyof ListingInput, string][] = [['title', 'Title'], ['description', 'Description'], ['price', 'StartPrice'], ['quantity', 'Quantity'], ['categoryId', 'PrimaryCategory'], ['conditionId', 'ConditionID'], ['conditionDescription', 'ConditionDescription'], ['postalCode', 'PostalCode'], ['specifics', 'ItemSpecifics'], ['compatibility', 'ItemCompatibilityList']];
  const fields: string[] = [];
  let deleted = '';
  const copy = (tag: string) => { const match = generated.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`)); if (match) fields.push(match[0]); };
  for (const [key, tag] of groups) if (JSON.stringify(payload[key]) !== JSON.stringify(before[key])) {
    if (key === 'specifics' && !payload.specifics.some(s => s.name && s.value)) deleted = '<DeletedField>Item.ItemSpecifics</DeletedField>';
    else copy(tag);
  }
  if (JSON.stringify(photos) !== JSON.stringify(before.pictureUrls)) copy('PictureDetails');
  if (['paymentPolicyId', 'returnPolicyId', 'fulfillmentPolicyId'].some(key => payload[key as keyof ListingInput] !== before[key as keyof ListingInput])) copy('SellerProfiles');
  if (!fields.length && !deleted) throw new Error('There are no listing changes to publish.');
  return deleted + `<Item><ItemID>${xml(item.ItemID)}</ItemID>` + (item.InventoryTrackingMethod === 'SKU' ? `<InventoryTrackingMethod>SKU</InventoryTrackingMethod><SKU>${xml(payload.sku)}</SKU>` : '') + fields.join('') + `</Item><InvocationID>${xml(idempotencyKey.toUpperCase())}</InvocationID>`;
}
function fees(response: Record<string, any>): Validation['fees'] {
  return asArray<any>(response.Fees?.Fee).filter(f => Number(xmlValue(f.Fee)) !== 0).map(f => ({ name: xmlValue(f.Name), amount: xmlValue(f.Fee), currency: f.Fee?.['@_currencyID'] ?? 'USD' }));
}
export async function validateDraft(id: string, version: number) {
  const account = await assertListingWrite();
  const draft = await prisma.listingDraft.findUniqueOrThrow({ where: { id } });
  if (draft.version !== version || ['queued', 'running', 'unknown'].includes(draft.status)) throw new Error('Reload this draft before validating it.');
  const payload = parseListing(JSON.parse(draft.payload), true, Boolean(draft.listingId));
  const connection = await listingConnection();
  const photos = [...payload.pictureUrls, ...await uploadPhotos(connection.config, connection.token, account.id, payload.assetIds)];
  let result: Record<string, any> = {};
  if (draft.listingId) {
    const item = await remote(connection, { listingId: draft.listingId });
    if (!draft.remoteSnapshot || remoteSnapshot(item) !== draft.remoteSnapshot) throw new Error('This listing changed in eBay. Refresh from eBay and review your changes again.');
    if (xmlValue(item.SKU) !== payload.sku) throw new Error('The SKU of a published listing cannot be changed here.');
    if (asArray(item.ItemCompatibilityList?.Compatibility).length && !payload.compatibility.length) throw new Error('Remove all vehicle compatibility in Seller Hub, then refresh this draft.');
  } else result = await tradingRead(connection.config, connection.token, 'VerifyAddFixedPriceItem', itemXml(payload, photos, { uuid: randomBytes(16).toString('hex').toUpperCase() }));
  const validation: Validation = { accountId: account.id, version, at: new Date().toISOString(), fees: fees(result), warnings: asArray<any>(result.Errors).map(e => xmlValue(e.LongMessage || e.ShortMessage)) };
  if (draft.listingId) validation.warnings.push('eBay validates revisions when they are submitted. Existing listing fees and policies still apply.');
  const changed = await prisma.listingDraft.updateMany({ where: { id, version, status: draft.status }, data: { validation: JSON.stringify(validation), status: 'validated' } });
  if (!changed.count) throw new Error('The draft changed while it was being validated. Validate it again.');
  return validation;
}

export async function enqueueListing(id: string, version: number, key: string) {
  if (!/^[0-9a-f]{32}$/i.test(key)) throw new Error('Invalid publishing request identifier.');
  const account = await assertListingWrite();
  const { actorId } = requireStoreContext();
  return prisma.$transaction(async tx => {
    const prior = await tx.listingOperation.findUnique({ where: { storeId_idempotencyKey: withStoreData({ idempotencyKey: key }) } });
    if (prior) {
      if (prior.draftId !== id || prior.draftVersion !== version || prior.actorId !== actorId) throw new Error('Publishing request identifier already used.');
      return prior;
    }
    const draft = await tx.listingDraft.findUniqueOrThrow({ where: { id } });
    const validation: Validation | null = draft.validation ? JSON.parse(draft.validation) : null;
    if (draft.version !== version || draft.status !== 'validated' || !validation || validation.accountId !== account.id || validation.version !== version || Date.now() - Date.parse(validation.at) > 15 * 60_000) throw new Error('Validate the current draft before publishing. Validation is valid for 15 minutes.');
    const changed = await tx.listingDraft.updateMany({ where: { id, version, status: 'validated' }, data: { status: 'queued' } });
    if (!changed.count) throw new Error('This draft is already being published.');
    const operation = await tx.listingOperation.create({ data: withStoreData({ draftId: id, draftVersion: version, actorId, accountId: account.id, kind: draft.listingId ? 'revise' : 'create', listingId: draft.listingId, idempotencyKey: key, payload: JSON.stringify({ listing: JSON.parse(draft.payload), remoteSnapshot: draft.remoteSnapshot, validation }) }) });
    await tx.auditEvent.create({ data: withStoreData({ actorId, action: `listing.${operation.kind}.queued`, entityId: operation.id }) });
    return operation;
  });
}

async function finish(operation: { id: string; draftId: string; actorId: string }, listingId: string, snapshot: string | null, payload: ListingInput) {
  await prisma.$transaction(async tx => {
    await tx.listingOperation.update({ where: { id: operation.id }, data: { status: 'succeeded', listingId, finishedAt: new Date(), error: null } });
    await tx.listingDraft.update({ where: { id: operation.draftId }, data: { status: 'published', listingId, remoteSnapshot: snapshot, publishedPayload: JSON.stringify(payload), validation: null } });
    await tx.ebayOffer.upsert({ where: { storeId_listingId: withStoreData({ listingId }) },
      create: withStoreData({ listingId, sku: payload.sku, price: Number(payload.price), currency: 'USD', quantity: payload.quantity, status: 'active', lastSeenAt: new Date(), syncedAt: new Date() }),
      update: { sku: payload.sku, price: Number(payload.price), quantity: payload.quantity, status: 'active', lastSeenAt: new Date(), syncedAt: new Date() },
    });
    await tx.auditEvent.create({ data: withStoreData({ actorId: operation.actorId, action: 'listing.published', entityId: listingId }) });
  });
}

/** Claim once, never automatically replay a request whose outcome is unknown. */
export async function processListingOperation(operationId: string) {
  const job = await adminDb.listingOperation.findUnique({ where: { id: operationId } });
  if (!job || job.status !== 'queued') return;
  const store = await adminDb.store.findUniqueOrThrow({ where: { id: job.storeId } });
  return runInStore({ storeId: job.storeId, actorId: job.actorId, role: 'publisher', marketplaceId: store.marketplaceId }, async () => {
    const claimed = await prisma.listingOperation.updateMany({ where: { id: job.id, status: 'queued' }, data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } } });
    if (!claimed.count) return;
    let sent = false;
    try {
      await assertListingWrite(job.accountId);
      const draft = await prisma.listingDraft.findUniqueOrThrow({ where: { id: job.draftId } });
      if (draft.version !== job.draftVersion || draft.status !== 'queued') throw new Error('Draft version changed before publication.');
      const stored = JSON.parse(job.payload);
      const payload = parseListing(stored.listing, true, job.kind === 'revise');
      const connection = await listingConnection();
      if (connection.account.id !== job.accountId) throw new Error('The connected seller changed.');
      const photos = [...payload.pictureUrls, ...await uploadPhotos(connection.config, connection.token, job.accountId, payload.assetIds)];
      let revision: string | undefined;
      if (job.kind === 'revise') {
        const item = await remote(connection, { listingId: job.listingId! });
        if (remoteSnapshot(item) !== stored.remoteSnapshot) throw new Error('This listing changed in eBay. Refresh from eBay before submitting another revision.');
        revision = revisionBody(payload, photos, item, job.idempotencyKey);
      } else {
        const check = await tradingRead(connection.config, connection.token, 'VerifyAddFixedPriceItem', itemXml(payload, photos, { uuid: job.idempotencyKey.toUpperCase() }));
        if (JSON.stringify(fees(check)) !== JSON.stringify(stored.validation.fees)) throw new Error('eBay fees changed. Validate and review the draft again.');
      }
      // All mutations are fixed operations with a frozen payload and a final
      // authorization check inside tradingWrite. No generic write proxy exists.
      await assertListingWrite(job.accountId);
      sent = true;
      const result = await tradingWrite(connection.config, connection.token, job.kind === 'create' ? 'AddFixedPriceItem' : 'ReviseFixedPriceItem',
        revision ?? itemXml(payload, photos, { uuid: job.idempotencyKey.toUpperCase() }), job.accountId);
      const listingId = xmlValue(result.ItemID || job.listingId);
      if (!/^\d+$/.test(listingId)) throw new TradingError('eBay accepted the request without a listing ID. Reconcile before retrying.', true);
      // Mark acceptance durably before fetching optional reporting details.
      await finish(job, listingId, null, payload);
      try {
        const item = await remote(connection, { listingId });
        await prisma.listingDraft.update({ where: { id: job.draftId }, data: { remoteSnapshot: remoteSnapshot(item) } });
      } catch { /* A refresh can recover the snapshot without re-publishing. */ }
    } catch (error) {
      // If the success transaction committed, a reporting error must not undo it.
      const current = await prisma.listingOperation.findUnique({ where: { id: job.id } });
      if (current?.status === 'succeeded') return;
      const uncertain = sent && (!(error instanceof TradingError) || error.uncertain);
      const status = uncertain ? 'unknown' : 'failed';
      const message = error instanceof Error ? error.message.slice(0, 2000) : 'Publishing failed.';
      await prisma.$transaction([
        prisma.listingOperation.update({ where: { id: job.id }, data: { status, error: message, finishedAt: new Date() } }),
        prisma.listingDraft.update({ where: { id: job.draftId }, data: { status, validation: null } }),
      ]);
    }
  });
}

export async function reconcileOperation(id: string) {
  const job = await prisma.listingOperation.findUniqueOrThrow({ where: { id } });
  if (job.status !== 'unknown') throw new Error('Only an uncertain operation needs reconciliation.');
  const connection = await listingConnection();
  if (job.accountId !== connection.account.id) throw new Error('Reconnect the original seller.');
  const stored = JSON.parse(job.payload);
  const item = await remote(connection, job.listingId ? { listingId: job.listingId } : { sku: stored.listing.sku });
  // An existing listing with the same SKU is not evidence that our create worked.
  if (job.kind === 'create' && xmlValue(item.UUID).toUpperCase() !== job.idempotencyKey.toUpperCase()) throw new Error('The SKU exists but eBay did not confirm this publishing request. Check Seller Hub before resolving manually.');
  if (job.kind === 'revise') {
    const payload = fromRemote(item);
    await prisma.$transaction([
      prisma.listingOperation.update({ where: { id: job.id }, data: { status: 'reconciled', error: 'Current eBay version adopted after an uncertain revision.', finishedAt: new Date() } }),
      prisma.listingDraft.update({ where: { id: job.draftId }, data: { title: payload.title, payload: JSON.stringify(payload), publishedPayload: JSON.stringify(payload), remoteSnapshot: remoteSnapshot(item), version: { increment: 1 }, status: 'draft', validation: null } }),
    ]);
    return;
  }
  await finish(job, xmlValue(item.ItemID), remoteSnapshot(item), fromRemote(item));
}

export const RELEASE_WAIT_MS = 10 * 60_000;
/**
 * The only exit for a create whose outcome eBay never confirms. Without it a
 * request that failed before eBay accepted it leaves the draft locked forever:
 * reconciliation finds nothing, and every other action refuses `unknown`.
 *
 * Nothing is sent to eBay. The publisher attests that Seller Hub shows no such
 * listing; this re-reads eBay first and, if it does find this request's
 * listing, records the publication instead of releasing. The released draft
 * gets a new version, so publishing again needs a fresh validation and a new
 * request identifier.
 */
export async function releaseUncertainCreate(id: string): Promise<'published' | 'released'> {
  const job = await prisma.listingOperation.findUniqueOrThrow({ where: { id } });
  if (job.status !== 'unknown' || job.kind !== 'create') throw new Error('Only an uncertain new listing can be released.');
  if (!job.finishedAt || Date.now() - job.finishedAt.getTime() < RELEASE_WAIT_MS) throw new Error('Wait 10 minutes after the attempt so eBay can show the listing if it was created, then check Seller Hub.');
  const connection = await listingConnection();
  if (job.accountId !== connection.account.id) throw new Error('Reconnect the original seller.');
  const stored = JSON.parse(job.payload);
  let item: Record<string, any> | null = null;
  try { item = await remote(connection, { sku: stored.listing.sku }); }
  catch (error) { if (error instanceof TradingError && !error.answered) throw new Error('eBay could not be reached to check for the listing. Try again later.'); }
  if (item && xmlValue(item.UUID).toUpperCase() === job.idempotencyKey.toUpperCase()) {
    await finish(job, xmlValue(item.ItemID), remoteSnapshot(item), fromRemote(item));
    return 'published';
  }
  const { actorId } = requireStoreContext();
  await prisma.$transaction(async tx => {
    const changed = await tx.listingOperation.updateMany({ where: { id: job.id, status: 'unknown' }, data: { status: 'abandoned', error: 'Released after the publisher confirmed in Seller Hub that no listing was created.' } });
    if (!changed.count) throw new Error('This operation was already resolved. Reload the draft.');
    await tx.listingDraft.updateMany({ where: { id: job.draftId, status: 'unknown' }, data: { status: 'draft', version: { increment: 1 }, validation: null } });
    await tx.auditEvent.create({ data: withStoreData({ actorId, action: 'listing.create.released', entityId: job.id }) });
  });
  return 'released';
}

export async function recoverInterruptedOperations() {
  const stale = await adminDb.listingOperation.findMany({ where: { status: 'running', startedAt: { lt: new Date(Date.now() - 15 * 60_000) } } });
  for (const job of stale) await adminDb.$transaction(async tx => {
    const changed = await tx.listingOperation.updateMany({ where: { id: job.id, status: 'running' }, data: { status: 'unknown', error: 'Worker stopped before the outcome was recorded. Reconcile before retrying.', finishedAt: new Date() } });
    if (changed.count) await tx.listingDraft.updateMany({ where: { id: job.draftId, storeId: job.storeId }, data: { status: 'unknown', validation: null } });
  });
}
