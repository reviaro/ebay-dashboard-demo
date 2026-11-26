import { withStoreData, requireStoreContext } from '@/lib/stores/context';
/**
 * Prisma-backed implementations of the OAuth persistence interfaces.
 *
 * Kept deliberately thin: all decision-making lives in oauth-service.ts, which
 * is tested without a database. What must be proven here is that the columns
 * and constraints behave — especially that consuming a state is atomic.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  AccountStore,
  ConsumedState,
  OAuthStateStore,
  StoredAccount,
} from './stores';

export function createPrismaStores(prisma: PrismaClient): {
  states: OAuthStateStore;
  accounts: AccountStore;
} {
  const states: OAuthStateStore = {
    async create(state, environment, expiresAt, scopes) {
      const context = requireStoreContext();
      if (!context.sessionId) throw new Error('A browser session is required to connect eBay.');
      await prisma.ebayOAuthState.create({
        data: withStoreData({ state, environment, expiresAt, userId: context.actorId, sessionId: context.sessionId, requestedScopes: JSON.stringify(scopes) }),
      });
    },

    async consume(state, now): Promise<ConsumedState | null> {
      // A conditional UPDATE, not read-then-write: SQLite executes it as one
      // statement, so concurrent callers cannot both observe an unconsumed row
      // and each proceed to exchange the same authorization code.
      const { count } = await prisma.ebayOAuthState.updateMany({
        where: { state, storeId: requireStoreContext().storeId, userId: requireStoreContext().actorId, sessionId: requireStoreContext().sessionId ?? '', consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (count === 0) return null;

      const row = await prisma.ebayOAuthState.findUnique({ where: { state } });
      return row ? { state: row.state, expiresAt: row.expiresAt, environment: row.environment, scopes: JSON.parse(row.requestedScopes) } : null;
    },
  };

  const accounts: AccountStore = {
    async upsert(account: StoredAccount) {
      const existing = await prisma.ebayAccount.findUnique({ where: { storeId_environment: withStoreData({ environment: account.environment }) } });
      // A delayed refresh failure must not restore a token after disconnect or
      // overwrite a newer consent. This branch changes status only.
      if (account.status === 'reauthorization_required') {
        await prisma.ebayAccount.updateMany({ where: { environment: account.environment, status: 'connected', authorizedAt: account.authorizedAt, revokedAt: null }, data: { status: account.status } });
        return account;
      }
      if (existing?.sellerId && account.sellerId !== existing.sellerId) throw new Error('This store is linked to a different eBay seller. Create another store instead.');
      const data = {
        marketplaceId: account.marketplaceId,
        sellerId: account.sellerId ?? null,
        username: account.username ?? null,
        refreshTokenCiphertext: account.refreshTokenCiphertext,
        refreshTokenIv: account.refreshTokenIv,
        refreshTokenAuthTag: account.refreshTokenAuthTag,
        refreshTokenKeyVersion: account.refreshTokenKeyVersion,
        refreshTokenExpiresAt: account.refreshTokenExpiresAt ?? null,
        scopes: account.scopes,
        status: account.status,
        authorizedAt: account.authorizedAt,
        revokedAt: null,
      };
      const saved = await prisma.ebayAccount.upsert({
        where: { storeId_environment: withStoreData({ environment: account.environment }), sellerId: existing?.sellerId ?? null },
        update: data,
        create: withStoreData({ environment: account.environment, ...data }),
      });
      return { ...account, id: saved.id };
    },

    async find(environment): Promise<StoredAccount | null> {
      const row = await prisma.ebayAccount.findUnique({ where: { storeId_environment: withStoreData({ environment: environment }) } });
      if (!row) return null;
      return {
        id: row.id,
        environment: row.environment,
        marketplaceId: row.marketplaceId,
        sellerId: row.sellerId,
        username: row.username,
        refreshTokenCiphertext: row.refreshTokenCiphertext,
        refreshTokenIv: row.refreshTokenIv,
        refreshTokenAuthTag: row.refreshTokenAuthTag,
        refreshTokenKeyVersion: row.refreshTokenKeyVersion,
        refreshTokenExpiresAt: row.refreshTokenExpiresAt,
        scopes: row.scopes,
        status: row.status as StoredAccount['status'],
        authorizedAt: row.authorizedAt,
      };
    },

    async clear(environment) {
      await prisma.ebayAccount.updateMany({ where: { environment }, data: {
        status: 'disconnected', revokedAt: new Date(), refreshTokenCiphertext: '', refreshTokenIv: '', refreshTokenAuthTag: '', refreshTokenKeyVersion: '',
      } });
    },
  };

  return { states, accounts };
}
