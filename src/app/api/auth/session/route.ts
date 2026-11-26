import { isDemoMode } from '@/lib/demo/server';
import { guardDemoRoute } from '@/lib/demo/guard';
import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/guard';
import { currentUser } from '@/lib/auth/user-session';

export const dynamic = 'force-dynamic';

/**
 * Whether the caller holds a valid session.
 *
 * Excluded from the proxy matcher (it lives under `/api/auth/`), so it
 * checks for itself. Used by the sidebar to decide whether to offer Sign out.
 * Returns no token material and no reason -- only a boolean.
 */
export async function GET(request: Request) {
  const demoBlocked = guardDemoRoute('/api/auth/session', 'GET');
  if (demoBlocked) return demoBlocked;
  if (isDemoMode()) return NextResponse.json({ authenticated: false, configured: true, user: null, demo: true });
  const result = await authenticateRequest(request);

  if (result.status === 'misconfigured') {
    return NextResponse.json(
      { authenticated: false, configured: false },
      { status: 503 }
    );
  }

  const identity = await currentUser(request);
  return NextResponse.json({
    authenticated: Boolean(identity),
    user: identity ? { id: identity.user.id, username: identity.user.username, displayName: identity.user.displayName, isOwner: identity.user.isOwner } : null,
    configured: true,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
