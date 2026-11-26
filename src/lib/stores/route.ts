import { tokenHash } from '../auth/token-hash';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '../prisma';
import { currentUser } from '../auth/user-session';
import { verifySameOrigin } from '../http/request-guard';
import { hasPermission, runInStore, type StoreContext, type StorePermission, type StoreRole } from './context';
import { DEMO_STORE_ID } from '../demo/config';
import { DEMO_READ_ONLY } from '../demo/guard';
import { demoRouteAccess } from '../demo/routes';
import { isDemoMode } from '../demo/server';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
/** Scheme is case-insensitive (RFC 9110) and surrounding whitespace is tolerated, as the pre-store agent guard did. */
export const bearerToken = (header: string | null) => /^Bearer[ ]+([^\s]+)$/i.exec((header ?? '').trim())?.[1];
export { tokenHash };

export function demoStoreContext(permission: StorePermission): StoreContext {
  if (permission !== 'view') throw new HttpError(403, DEMO_READ_ONLY);
  return { storeId: DEMO_STORE_ID, actorId: 'demo:viewer', role: 'viewer', marketplaceId: 'EBAY_US' };
}

export async function authorizeStore(request: Request, permission: StorePermission): Promise<StoreContext> {
  const url = new URL(request.url);
  if (isDemoMode()) {
    if (demoRouteAccess(url.pathname, request.method) === 'deny') throw new HttpError(403, DEMO_READ_ONLY);
    return demoStoreContext(permission);
  }
  const storeId = url.searchParams.get('store');
  if (!storeId) throw new HttpError(400, 'Select a store before continuing.');
  if (url.pathname.startsWith('/api/agent/')) {
    const token = bearerToken(request.headers.get('authorization'));
    const key = token && await adminDb.agentKey.findUnique({ where: { tokenHash: tokenHash(token) }, include: { store: true } });
    if (!key || key.revokedAt || key.storeId !== storeId || key.store.archivedAt) throw new HttpError(401, 'Authentication required.');
    const taskEdit = url.pathname === '/api/agent/tasks' && key.canEditTasks && permission === 'edit';
    if (permission !== 'view' && !taskEdit) throw new HttpError(403, 'This agent key cannot perform that action.');
    return { storeId, actorId: `agent:${key.id}`, role: taskEdit ? 'editor' : 'viewer', marketplaceId: key.store.marketplaceId, agent: true };
  }
  const identity = await currentUser(request);
  if (!identity) throw new HttpError(401, 'Authentication required.');
  const membership = await adminDb.storeMembership.findUnique({
    where: { storeId_userId: { storeId, userId: identity.user.id } }, include: { store: true },
  });
  if (!membership || membership.store.archivedAt) throw new HttpError(404, 'Store not found.');
  if (!hasPermission(membership.role, permission)) throw new HttpError(403, 'Your store role does not allow this action.');
  if (!['GET', 'HEAD'].includes(request.method)) verifySameOrigin(request.headers);
  return { storeId, actorId: identity.user.id, role: membership.role as StoreRole, sessionId: identity.sessionId, marketplaceId: membership.store.marketplaceId };
}

export function routeError(error: unknown): NextResponse {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.name === 'RequestOriginError') return NextResponse.json({ error: 'Same-origin request required.' }, { status: 403 });
  if ((error as { code?: string })?.code === 'P2025') return NextResponse.json({ error: 'Record not found.' }, { status: 404 });
  if ((error as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'That record already exists.' }, { status: 409 });
  console.error('Request failed:', error instanceof Error ? error.name : 'unknown error');
  return NextResponse.json({ error: 'Unable to complete the request.' }, { status: 500 });
}

export function withStore(permission: StorePermission, handler: (request: NextRequest) => Promise<Response>): (request: Request) => Promise<Response>;
export function withStore<C>(permission: StorePermission, handler: (request: NextRequest, context: C) => Promise<Response>): (request: Request, context: C) => Promise<Response>;
export function withStore<C = unknown>(permission: StorePermission, handler: (request: NextRequest, context: C) => Promise<Response>) {
  return async (request: Request, context?: C): Promise<Response> => {
    try {
      const store = await authorizeStore(request, permission);
      const response = await runInStore(store, () => handler(request as NextRequest, context as C));
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    } catch (error) { return routeError(error); }
  };
}
