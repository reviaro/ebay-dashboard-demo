/**
 * Authentication gate for the whole dashboard.
 *
 * This is Next 16's `proxy` convention -- the former `middleware.ts`, renamed
 * along with its exported function. Behaviour is unchanged; the old name is
 * deprecated and warns on every build.
 *
 * Session verification uses Web Crypto
 * (`src/lib/auth/session.ts`) rather than `node:crypto`.
 *
 * This is a convenience gate, not the security boundary. Sensitive route
 * handlers use store authorization and database-backed sessions so that a mistake in the matcher
 * below cannot silently expose them.
 *
 * IMPORTANT: `next start` serves the built output. Changes here do nothing
 * until `npm run build` && `systemctl --user restart ebay-dashboard`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth/guard';
import { LOGIN_PATH } from '@/lib/auth/redirect';
import { guardDemoRoute } from '@/lib/demo/guard';
import { isDemoMode } from '@/lib/demo/server';

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (isDemoMode()) {
    const blocked = guardDemoRoute(path, request.method);
    if (blocked) return blocked;
    const response = path === '/login'
      ? NextResponse.redirect(new URL('/', request.url))
      : NextResponse.next();
    response.headers.set('X-Demo-Mode', 'read-only');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'");
    return response;
  }
  if (/^\/(?:login(?:$|\/)|join(?:$|\/)|api\/auth\/|api\/agent\/)/.test(path)) {
    return NextResponse.next();
  }

  const result = await authenticateRequest(request);
  if (result.status === 'ok' && result.session.sid) return NextResponse.next();

  const isApiRequest = request.nextUrl.pathname.startsWith('/api/');

  if (result.status === 'misconfigured') {
    // Fail closed, loudly. The operator sees exactly which variable is missing;
    // this text never reaches an unauthenticated third party in practice
    // because the dashboard is not publicly reachable.
    return isApiRequest
      ? NextResponse.json(
          { error: result.reason, code: 'auth_not_configured' },
          { status: 503 }
        )
      : new NextResponse(
          `Dashboard authentication is not configured.\n\n${result.reason}\n`,
          { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }
        );
  }

  if (isApiRequest) {
    return NextResponse.json(
      { error: 'Authentication required.', code: 'unauthenticated' },
      { status: 401 }
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = LOGIN_PATH;
  loginUrl.search = '';
  // Round-trip where the operator was heading. Validated on the way back out
  // by `safeRedirectPath`, so a crafted link cannot turn login into an open
  // redirect.
  loginUrl.searchParams.set(
    'next',
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );

  return NextResponse.redirect(loginUrl);
}

export const config = {
  /**
   * Apply the demo policy to every API, including login and agent API routes.
   * In ordinary mode the proxy function preserves those routes' exclusions.
   *
   * - `login`            the sign-in page
   * - `api/auth/`        sign in / sign out / session probe
   * - `api/agent/`       the Emily bearer-token API; each route calls
   *                      `withStore()` itself, so exclusion here does
   *                      not make it public (same rationale as `api/auth/`).
   * - `_next/static`,    build assets and fonts, needed to render the login
   *   `_next/image`      page at all
   * - `favicon.ico`
   *
   * The eBay OAuth callbacks (`/api/ebay/oauth/callback`, `/api/ebay/auth/callback`)
   * are deliberately NOT excluded. eBay returns the operator by top-level
   * navigation, which `SameSite=Lax` allows the session cookie to ride along
   * with, so a logged-in operator completes consent normally. With a 30-day
   * default session the window for expiring mid-consent is negligible, and the
   * alternative -- a publicly callable endpoint that accepts an authorization
   * code -- is a worse trade.
   */
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
