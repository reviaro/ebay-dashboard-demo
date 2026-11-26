import type { PrismaClient } from '@prisma/client';
import { requireStoreId } from './context';
import { assertDemoReadOperation } from '../demo/database';
import { isDemoMode } from '../demo/server';

// This list is intentionally explicit. Unknown/global models and raw SQL are
// rejected by the business-data client; account administration uses adminDb.
export const STORE_MODELS = new Set([
  'PerformanceMetric', 'Task', 'ChatMessage', 'UploadRecord', 'EbayTransaction',
  'PromotedListingMetric', 'EbayAdReport', 'EbayAdCampaign', 'Sale',
  'InventoryExpense', 'EbayFee', 'EbayFinanceTransaction', 'EbayPayout',
  'GeneralExpense', 'Inventory', 'EbayOrder', 'EbayOffer', 'EbayTrafficDay',
  'EbayTrafficListing', 'EbayPriceComparison', 'EbaySyncLock', 'EbaySyncSetting',
  'EbaySyncChunk', 'EbaySyncLog', 'ListingNote', 'EbayAccount', 'EbayOAuthState',
  'ListingDraft', 'ListingAsset', 'ListingOperation', 'AuditEvent',
]);

type Args = Record<string, any>;
const READS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']);
const WRITES = new Set(['update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany']);

function ownedData(data: Args, storeId: string): Args {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid store data.');
  if ('storeId' in data && data.storeId !== storeId) throw new Error('Store ownership cannot be changed.');
  // Business models are scalar records. Nested relation writes must go through
  // an explicit authorized service, never a hidden connect/create operation.
  for (const key of ['store', 'draft', 'operations']) {
    if (key in data) throw new Error('Nested relation writes are not allowed.');
  }
  return { ...data, storeId };
}

export function scopeArguments(model: string | undefined, operation: string, input: Args | undefined, storeId: string): Args {
  if (!storeId || !model || !STORE_MODELS.has(model)) throw new Error('Unscoped database access is not allowed.');
  const args = { ...input };
  for (const shape of [args.select, args.include]) {
    if (shape?.store || shape?.draft || shape?.operations) throw new Error('Load related records through a scoped service.');
  }
  if (READS.has(operation) || WRITES.has(operation) || operation === 'upsert') {
    if (args.where?.storeId && args.where.storeId !== storeId) throw new Error('Store mismatch.');
    args.where = { ...args.where, storeId };
  }
  if (operation === 'create') args.data = ownedData(args.data, storeId);
  else if (operation === 'createMany' || operation === 'createManyAndReturn') {
    args.data = (Array.isArray(args.data) ? args.data : [args.data]).map((row: Args) => ownedData(row, storeId));
  } else if (operation === 'upsert') {
    args.create = ownedData(args.create, storeId);
    args.update = ownedData(args.update, storeId);
    // Prisma's upsert CREATE branch must agree with the compound selector too.
    for (const [key, value] of Object.entries(args.where)) {
      if (key.startsWith('storeId_') && (value as Args)?.storeId !== storeId) throw new Error('Store mismatch.');
    }
  } else if (operation.startsWith('update')) args.data = ownedData(args.data, storeId);
  else if (!READS.has(operation) && !WRITES.has(operation)) throw new Error(`Unsupported store operation: ${operation}`);
  return args;
}

export function createScopedClient(base: PrismaClient, resolveStoreId: () => string = requireStoreId): PrismaClient {
  return base.$extends({
    name: 'required-store-ownership',
    query: {
      $allOperations({ model, operation, args, query }) {
        if (isDemoMode()) assertDemoReadOperation(model, operation);
        return query(scopeArguments(model, operation, args, resolveStoreId()));
      },
    },
  }) as unknown as PrismaClient;
}
