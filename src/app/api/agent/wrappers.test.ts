import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/app/api/metrics/route', () => ({ GET: vi.fn() }));
vi.mock('@/app/api/profitability/route', () => ({ GET: vi.fn() }));
vi.mock('@/app/api/orders/route', () => ({ GET: vi.fn() }));
vi.mock('@/app/api/inventory/route', () => ({ GET: vi.fn() }));
vi.mock('@/app/api/traffic/route', () => ({ GET: vi.fn() }));
vi.mock('@/app/api/sourcing/search/route', () => ({ GET: vi.fn() }));

import { GET as metricsWrap } from './metrics/route';
import { GET as profitabilityWrap } from './profitability/route';
import { GET as ordersWrap } from './orders/route';
import { GET as inventoryWrap } from './inventory/route';
import { GET as trafficWrap } from './traffic/route';
import { GET as sourcingWrap } from './sourcing/search/route';
import { GET as metricsGET } from '@/app/api/metrics/route';
import { GET as profitabilityGET } from '@/app/api/profitability/route';
import { GET as ordersGET } from '@/app/api/orders/route';
import { GET as inventoryGET } from '@/app/api/inventory/route';
import { GET as trafficGET } from '@/app/api/traffic/route';
import { GET as sourcingGET } from '@/app/api/sourcing/search/route';

type Mock = ReturnType<typeof vi.fn>;

const ORIGINAL = process.env.EMILY_API_TOKEN;
const authed = (path: string) =>
  new Request(`http://localhost${path}`, { headers: { authorization: 'Bearer t0ken' } });

// Delegate mock + the tag its stub returns. resetAllMocks() (below) wipes the
// stub implementations, so beforeEach re-installs them explicitly rather than
// leaning on a default surviving between tests.
const delegates: [Mock, string][] = [
  [metricsGET as unknown as Mock, 'metrics'],
  [profitabilityGET as unknown as Mock, 'profitability'],
  [ordersGET as unknown as Mock, 'orders'],
  [inventoryGET as unknown as Mock, 'inventory'],
  [trafficGET as unknown as Mock, 'traffic'],
  [sourcingGET as unknown as Mock, 'sourcing'],
];

beforeEach(() => {
  vi.resetAllMocks();
  process.env.EMILY_API_TOKEN = 't0ken';
  for (const [fn, tag] of delegates) {
    fn.mockImplementation(async () => Response.json({ from: tag }));
  }
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EMILY_API_TOKEN;
  else process.env.EMILY_API_TOKEN = ORIGINAL;
});

const cases: [string, (r: Request) => Promise<Response>, string, string][] = [
  ['metrics', metricsWrap as never, '/api/agent/metrics', 'metrics'],
  ['profitability', profitabilityWrap as never, '/api/agent/profitability', 'profitability'],
  ['orders', ordersWrap as never, '/api/agent/orders', 'orders'],
  ['inventory', inventoryWrap as never, '/api/agent/inventory', 'inventory'],
  ['traffic', trafficWrap as never, '/api/agent/traffic', 'traffic'],
  ['sourcing', sourcingWrap as never, '/api/agent/sourcing/search', 'sourcing'],
];

describe('agent read wrappers', () => {
  // Authorization is shared with browser routes and tested at stores/route.test.ts.

  it.each(cases)('%s: delegates with a valid token', async (_n, wrap, path, tag) => {
    const res = await wrap(authed(path));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ from: tag });
  });

  it('passes the request object straight through to the delegate', async () => {
    const r = authed('/api/agent/metrics?period=last30');
    await metricsWrap(r as never);
    expect((metricsGET as unknown as Mock).mock.calls[0][0]).toBe(r);
  });
});
