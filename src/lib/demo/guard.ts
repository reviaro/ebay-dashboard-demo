import { NextResponse } from 'next/server';
import { demoRouteAccess } from './routes';
import { isDemoMode } from './server';

export const DEMO_READ_ONLY = 'Disabled in the read-only demo.';

export function demoRouteDenied(path: string, method: string): boolean {
  if (!isDemoMode()) return false;
  if (path === '/api' || path.startsWith('/api/')) return demoRouteAccess(path, method) === 'deny';
  return method !== 'GET' && method !== 'HEAD';
}

export function guardDemoRoute(path: string, method: string): NextResponse | null {
  if (!demoRouteDenied(path, method)) return null;
  const read = method === 'GET' || method === 'HEAD';
  return NextResponse.json({
    code: read ? 'demo_unavailable' : 'demo_read_only',
    error: DEMO_READ_ONLY,
  }, { status: read ? 404 : 403 });
}
