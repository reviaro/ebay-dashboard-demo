import { ebayEnvironment } from '../config';
import { adminDb } from '../../prisma';
import { hasPermission, requireStoreContext } from '../../stores/context';

export async function assertListingWrite(accountId?: string) {
  const { storeId, actorId, agent } = requireStoreContext();
  if (agent) throw new Error('Agent keys cannot publish listings.');
  const [store, member, account] = await Promise.all([
    adminDb.store.findUnique({ where: { id: storeId } }),
    adminDb.storeMembership.findUnique({ where: { storeId_userId: { storeId, userId: actorId } }, include: { user: true } }),
    adminDb.ebayAccount.findFirst({ where: { storeId, environment: ebayEnvironment(), ...(accountId ? { id: accountId } : {}) } }),
  ]);
  if (!store || store.archivedAt || !store.writeEnabled || !member || member.user.disabledAt || !hasPermission(member.role, 'publish')) throw new Error('Listing writes are disabled or your publishing permission has been removed.');
  if (!account || account.status !== 'connected' || !account.sellerId || !account.username) throw new Error('Reconnect this store to verify its eBay seller before publishing.');
  if (account.environment === 'production' && process.env.EBAY_LISTING_WRITES_ENABLED !== 'true') throw new Error('Live listing writes are disabled on this server.');
  if (account.environment !== 'production' && account.environment !== 'sandbox') throw new Error('Invalid eBay environment.');
  return account;
}
