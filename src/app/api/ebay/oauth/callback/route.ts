import { guardDemoRoute } from '@/lib/demo/guard';
import { withStore, routeError, HttpError } from '@/lib/stores/route';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/prisma';
import { currentUser } from '@/lib/auth/user-session';
import { requireStoreId } from '@/lib/stores/context';
import { identifySeller, legacySellerUsername } from '@/lib/ebay/identity';
import { createTokenProvider } from '@/lib/ebay/access-token';
import { OAuthFlowError } from '@/lib/ebay/oauth-service';
import { getEbayConfig, getEbayStores } from '@/lib/ebay/server';
import { completeAuthorization } from '@/lib/ebay/oauth-service';
import { exchangeWithEbay } from '@/lib/ebay/token-exchange';
import { errorResponse, guardOrigin } from '@/lib/ebay/route-helpers';

export const dynamic = 'force-dynamic';

async function connect(redirectInput: string) {
  const config = getEbayConfig();
  const stores = getEbayStores();
  const account = await completeAuthorization(config, redirectInput, stores, {
    exchange: exchangeWithEbay,
    identify: async token => {
      const seller = await identifySeller(config, token);
      const old = await stores.accounts.find(config.environment);
      if (old && !old.sellerId) {
        if (old.status !== 'connected') throw new OAuthFlowError('The original seller must be verified before reconnecting this migrated store. Use the owner recovery procedure.');
        const tokens = createTokenProvider({ config, accounts: stores.accounts, exchange: exchangeWithEbay });
        const username = await legacySellerUsername(config, await tokens.getAccessToken());
        if (username.toLowerCase() !== seller.username.toLowerCase()) throw new OAuthFlowError('This eBay seller does not match the original store. Create another store for this account.');
      }
      return seller;
    },
  });
  return {
    connected: true,
    environment: account.environment,
    marketplaceId: account.marketplaceId,
    authorizedAt: account.authorizedAt,
  };
}

/**
 * Paste-back completion.
 *
 * This deployment has no public HTTPS callback, so the operator copies the
 * address bar after approving access and posts it here.
 */
async function handlePOST(request: Request) {

  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      redirectUrl?: unknown;
    };
    if (typeof body.redirectUrl !== 'string' || !body.redirectUrl.trim()) {
      return NextResponse.json(
        { error: 'Provide the redirect URL you were sent to after approving access.' },
        { status: 400 }
      );
    }
    return NextResponse.json(await connect(body.redirectUrl));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Direct callback, used only if the RuName's redirect actually reaches this
 * host. Same handler, so both paths share one code exchange.
 */
async function handleGET(request: Request) {

  try {
    const result = await connect(request.url);
    const target = new URL('/settings', request.url);
    target.searchParams.set('ebay', 'connected');
    target.searchParams.set('store', requireStoreId());
    target.searchParams.set('environment', result.environment);
    return NextResponse.redirect(target);
  } catch {
    // Redirect rather than render, so the authorization code never stays in
    // the address bar of a page the operator might screenshot or share.
    const target = new URL('/settings', request.url);
    target.searchParams.set('ebay', 'error');
    target.searchParams.set('store', requireStoreId());
    return NextResponse.redirect(target);
  }
}

export const POST = withStore('admin', handlePOST);

export async function GET(request: NextRequest) {
  const demoBlocked = guardDemoRoute('/api/ebay/oauth/callback', 'GET');
  if (demoBlocked) return demoBlocked;
  try {
    const identity = await currentUser(request);
    if (!identity) throw new HttpError(401, 'Sign in before completing the connection.');
    const state = new URL(request.url).searchParams.get('state') ?? '';
    const pending = await adminDb.ebayOAuthState.findFirst({ where: { state, userId: identity.user.id, sessionId: identity.sessionId, consumedAt: null, expiresAt: { gt: new Date() } }, select: { storeId: true } });
    if (!pending) throw new HttpError(400, 'Invalid or expired authorization. Start the connection again.');
    const url = new URL(request.url);
    url.searchParams.set('store', pending.storeId);
    return withStore('admin', handleGET)(new NextRequest(url, { headers: request.headers }));
  } catch (error) { return routeError(error); }
}
