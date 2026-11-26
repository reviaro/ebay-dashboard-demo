import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Keep the real PrismaClient from being constructed at import time; every case
// here exercises only the 401 path, which returns before any DB access.
vi.mock('@/lib/prisma', () => ({ default: {} }));

/*
 * AUTO-DISCOVERY — this suite maintains itself.
 *
 * It globs every `src/app/api/agent/<...>/route.ts` and, for each module, every
 * function-valued export whose name is an HTTP method, then asserts that export
 * answers 401 to a request carrying NO Authorization header. A brand-new agent
 * route file, or a new verb (`PATCH`, ...) added to an existing one, is covered
 * the moment it exists — there is no manual registration list to keep in sync.
 *
 * This is the ONLY thing protecting the proxy-excluded `/api/agent/*` namespace
 * from a route that forgets `requireAgentToken()`: such a route is outside the
 * proxy matcher, so without this check a guardless handler would ship green.
 */

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// Relative to this file (src/app/api/agent/). `{ eager: true }` gives us the
// evaluated module namespace for each match.
const routeModules = (
  import.meta as unknown as {
    glob: (
      pattern: string,
      opts: { eager: boolean },
    ) => Record<string, Record<string, unknown>>;
  }
).glob('./**/route.ts', { eager: true });

const ORIGINAL = process.env.EMILY_API_TOKEN;
beforeEach(() => {
  // Set the token so the guard's "no auth" answer is 401, not the 503 it gives
  // when the agent API is unconfigured.
  process.env.EMILY_API_TOKEN = 't0ken';
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EMILY_API_TOKEN;
  else process.env.EMILY_API_TOKEN = ORIGINAL;
});

describe('every /api/agent route rejects an unauthenticated request', () => {
  const routePaths = Object.keys(routeModules).sort();

  it('discovers the agent route files (glob is wired up)', () => {
    // Guards against a silently-empty glob turning this whole suite into a no-op.
    expect(routePaths.length).toBeGreaterThanOrEqual(7);
    expect(routePaths.some((p) => p.endsWith('/tasks/route.ts'))).toBe(true);
  });

  for (const routePath of routePaths) {
    const mod = routeModules[routePath];
    // './metrics/route.ts' -> 'metrics'; './sourcing/search/route.ts' -> 'sourcing/search'
    const urlPath = routePath.replace(/^\.\//, '').replace(/\/route\.ts$/, '');

    for (const exportName of Object.keys(mod)) {
      const handler = mod[exportName];
      if (typeof handler !== 'function' || !HTTP_METHODS.includes(exportName)) continue;

      it(`${exportName} /api/agent/${urlPath} -> 401 with no Authorization header`, async () => {
        const res = await (handler as (r: Request) => Promise<Response>)(
          new Request(`http://localhost/api/agent/${urlPath}?store=legacy`, { method: exportName }),
        );
        expect(res.status).toBe(401);
      });
    }
  }
});
