import { isDemoMode } from '@/lib/demo/server';
import { LISTING_WRITE_SCOPE } from '@/lib/ebay/read-only';
import { adminDb } from '@/lib/prisma';
import { requireStoreId } from '@/lib/stores/context';
import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import { getEbayConfig, getEbayStores } from '@/lib/ebay/server';
import { errorResponse } from '@/lib/ebay/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * Connection health. Deliberately returns no token material: not the
 * ciphertext, not the IV, not the auth tag, not the key version.
 */
async function handleGET() {
  if (isDemoMode()) return NextResponse.json({ connected: false, environment: 'demo', marketplaceId: 'EBAY_US', readOnly: true, demo: true });

  try {
    const config = getEbayConfig();
    const store = await adminDb.store.findUniqueOrThrow({ where: { id: requireStoreId() } });
    if (store.writeEnabled) config.scopes = [...config.scopes, LISTING_WRITE_SCOPE];
    const { accounts } = getEbayStores();
    const account = await accounts.find(config.environment);

    if (!account) {
      return NextResponse.json({
        connected: false,
        environment: config.environment,
        marketplaceId: config.marketplaceId,
        requestedScopes: config.scopes,
        readOnly: !store.writeEnabled,
      });
    }

    let grantedScopes: string[] = [];
    try {
      grantedScopes = JSON.parse(account.scopes);
    } catch {
      grantedScopes = [];
    }

    const missingScopes = config.scopes.filter((s) => !grantedScopes.includes(s));

    return NextResponse.json({
      connected: account.status === 'connected',
      status: account.status,
      environment: account.environment,
      marketplaceId: account.marketplaceId,
      sellerId: account.sellerId ?? null,
      username: account.username ?? null,
      authorizedAt: account.authorizedAt,
      refreshTokenExpiresAt: account.refreshTokenExpiresAt ?? null,
      grantedScopes,
      missingScopes,
      readOnly: !store.writeEnabled,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = withStore('view', handleGET);
