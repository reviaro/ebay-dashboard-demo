import { LISTING_WRITE_SCOPE } from '@/lib/ebay/read-only';
import { adminDb } from '@/lib/prisma';
import { requireStoreId } from '@/lib/stores/context';
import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import { getEbayConfig, getEbayStores } from '@/lib/ebay/server';
import { startAuthorization } from '@/lib/ebay/oauth-service';
import { errorResponse, guardOrigin } from '@/lib/ebay/route-helpers';

export const dynamic = 'force-dynamic';

/** Issues a consent URL for the operator to open in a browser. */
async function handlePOST(request: Request) {

  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  try {
    const config = getEbayConfig();
    const store = await adminDb.store.findUniqueOrThrow({ where: { id: requireStoreId() } });
    if (store.writeEnabled) config.scopes = [...config.scopes, LISTING_WRITE_SCOPE];
    const { states } = getEbayStores();
    const { url } = await startAuthorization(config, states);

    // The URL carries client_id and the RuName, both of which the browser must
    // see. It carries no secret.
    return NextResponse.json({ url, environment: config.environment });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = withStore('admin', handlePOST);
