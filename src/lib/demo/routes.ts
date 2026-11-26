export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type DemoMethod = typeof HTTP_METHODS[number];
export type DemoAccess = 'read' | 'chat-cache' | 'deny';

export const DEMO_ROUTES: Record<string, Partial<Record<DemoMethod, DemoAccess>>> = {
  '/api/advertising': { GET: 'read' },
  '/api/agent/inventory': { GET: 'deny' },
  '/api/agent/metrics': { GET: 'deny' },
  '/api/agent/orders': { GET: 'deny' },
  '/api/agent/profitability': { GET: 'deny' },
  '/api/agent/sourcing/search': { GET: 'deny' },
  '/api/agent/tasks': { GET: 'deny', POST: 'deny', PUT: 'deny', DELETE: 'deny' },
  '/api/agent/traffic': { GET: 'deny' },
  '/api/auth/accept-invitation': { POST: 'deny' },
  '/api/auth/login': { POST: 'deny' },
  '/api/auth/logout': { POST: 'deny' },
  '/api/auth/session': { GET: 'read' },
  '/api/chat': { GET: 'deny', POST: 'chat-cache' },
  '/api/ebay/auth/callback': { GET: 'deny', POST: 'deny' },
  '/api/ebay/disconnect': { POST: 'deny' },
  '/api/ebay/oauth/callback': { GET: 'deny', POST: 'deny' },
  '/api/ebay/oauth/start': { POST: 'deny' },
  '/api/ebay/status': { GET: 'read' },
  '/api/ebay/sync/advertising': { POST: 'deny' },
  '/api/ebay/sync/finances': { POST: 'deny' },
  '/api/ebay/sync/inventory': { POST: 'deny' },
  '/api/ebay/sync/logs': { GET: 'read' },
  '/api/ebay/sync/orders': { POST: 'deny' },
  '/api/ebay/sync/payouts': { POST: 'deny' },
  '/api/ebay/sync/settings': { GET: 'read', PUT: 'deny' },
  '/api/ebay/sync/status': { GET: 'read' },
  '/api/ebay/sync/traffic': { POST: 'deny' },
  '/api/expenses': { GET: 'read' },
  '/api/general-expenses': { GET: 'read', POST: 'deny', DELETE: 'deny' },
  '/api/inventory': { GET: 'read' },
  '/api/listings': { GET: 'read', POST: 'deny' },
  '/api/listings/assets': { GET: 'deny', POST: 'deny' },
  '/api/listings/metadata': { GET: 'read' },
  '/api/metrics': { GET: 'read', DELETE: 'deny' },
  '/api/orders': { GET: 'read' },
  '/api/profitability': { GET: 'read' },
  '/api/reports': { GET: 'read' },
  '/api/reset': { DELETE: 'deny' },
  '/api/sourcing/search': { GET: 'deny' },
  '/api/stores': { GET: 'read', POST: 'deny', PATCH: 'deny' },
  '/api/stores/agent-keys': { GET: 'deny', POST: 'deny', DELETE: 'deny' },
  '/api/stores/members': { GET: 'deny', POST: 'deny', PATCH: 'deny' },
  '/api/tasks': { GET: 'read', POST: 'deny', PUT: 'deny', DELETE: 'deny' },
  '/api/tasks/suggest': { GET: 'read' },
  '/api/traffic': { GET: 'read' },
  '/api/traffic/[listingId]': { GET: 'read' },
  '/api/traffic/notes': { GET: 'read', POST: 'deny' },
  '/api/upload': { POST: 'deny' },
  '/api/uploads': { GET: 'deny', DELETE: 'deny' },
  '/api/users': { GET: 'deny', PATCH: 'deny' },
};

const parameterizedRoutes = Object.keys(DEMO_ROUTES)
  .filter(path => path.includes('['))
  .map(path => ({ path, segments: path.split('/') }));

export function demoRouteAccess(pathname: string, method: string): DemoAccess {
  if (method !== 'HEAD' && !HTTP_METHODS.some(verb => verb === method)) return 'deny';
  const path = pathname.replace(/\/$/, '');
  const segments = path.split('/');
  const route = DEMO_ROUTES[path] ?? DEMO_ROUTES[parameterizedRoutes.find(route =>
    route.segments.length === segments.length && route.segments.every((segment, i) =>
      segment.startsWith('[') ? Boolean(segments[i]) : segment === segments[i])
  )?.path ?? ''];
  // Next automatically maps HEAD to GET when no HEAD handler is exported.
  if (method === 'HEAD') return route?.GET === 'read' ? 'read' : 'deny';
  return route?.[method as DemoMethod] ?? 'deny';
}
