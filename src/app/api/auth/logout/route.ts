import { guardDemoRoute } from '@/lib/demo/guard';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/user-session';
import { adminDb } from '@/lib/prisma';
import { clearedCookieOptions, isSecureRequest } from '@/lib/auth/cookie';
import {
  RequestOriginError,
  verifySameOrigin,
} from '@/lib/http/request-guard';

export const dynamic = 'force-dynamic';

/**
 * Clears the session cookie.
 *
 * Sessions are stateless, so there is nothing server-side to revoke: the token
 * stays cryptographically valid until it expires. That is the accepted cost of
 * having no session table. Rotating `DASHBOARD_SESSION_SECRET` invalidates
 * every outstanding session at once if that is ever needed.
 */
export async function POST(request: Request) {
  const demoBlocked = guardDemoRoute('/api/auth/logout', 'POST');
  if (demoBlocked) return demoBlocked;
  try {
    verifySameOrigin(request.headers);
  } catch (error) {
    if (error instanceof RequestOriginError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const identity = await currentUser(request);
  if (identity) await adminDb.userSession.deleteMany({ where: { id: identity.sessionId } });
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    ...clearedCookieOptions({ secure: isSecureRequest(request) }),
    value: '',
  });

  return response;
}
