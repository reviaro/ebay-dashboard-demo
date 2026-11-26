import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import { getEbayConfig, getEbayStores } from '@/lib/ebay/server';
import { errorResponse, guardOrigin } from '@/lib/ebay/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * Removes the locally stored refresh token.
 *
 * This does NOT revoke the grant at eBay. Plan §4 keeps revocation a separate,
 * explicitly audited operation; the response says so rather than implying the
 * connection was torn down on eBay's side.
 */
async function handlePOST(request: Request) {

  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  try {
    const config = getEbayConfig();
    const { accounts } = getEbayStores();
    const existing = await accounts.find(config.environment);
    if (existing && !existing.sellerId) return NextResponse.json({ error: 'Reconnect once to verify the original seller before disconnecting this migrated store.' }, { status: 409 });
    await accounts.clear(config.environment);

    return NextResponse.json({
      disconnected: true,
      hadConnection: existing !== null,
      environment: config.environment,
      note: 'Local token removed. The grant was not revoked at eBay; revoke it in your eBay account settings if you want it withdrawn there too.',
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = withStore('admin', handlePOST);
