/** Independent safety regression tests: do not infer expected policy from its implementation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { guardDemoRoute } from './guard';
import { DEMO_ROUTES, HTTP_METHODS as CLASSIFIED_METHODS } from './routes';
import { assertLiveIntegrationAllowed, isDemoMode, reportingNow } from './server';

const effects = vi.hoisted(() => ({ database: vi.fn(), remote: vi.fn(), ai: vi.fn() }));

// A direct-handler test must never accidentally reach a real database or service.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: new Proxy({}, {
    get(_target, model) {
      if (model === 'then') return undefined;
      return new Proxy(() => {}, {
        apply(_target, _this, args) {
          effects.database(String(model), args);
          throw new Error('Unexpected database effect in blocked route');
        },
        get(_target, operation) {
          return (...args: unknown[]) => {
            effects.database(`${String(model)}.${String(operation)}`, args);
            throw new Error('Unexpected database effect in blocked route');
          };
        },
      });
    },
  }),
}));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(...args: unknown[]) {
      effects.ai(...args);
      throw new Error('Unexpected AI effect in demo');
    }
  },
}));

const ROOT = path.resolve(__dirname, '../..');
const READ_PATHS = [
  '/api/auth/session', '/api/metrics', '/api/orders', '/api/inventory',
  '/api/traffic', '/api/traffic/notes', '/api/traffic/[listingId]',
  '/api/profitability', '/api/advertising', '/api/expenses',
  '/api/general-expenses', '/api/reports', '/api/tasks', '/api/tasks/suggest',
  '/api/ebay/status', '/api/ebay/sync/status', '/api/ebay/sync/logs',
  '/api/ebay/sync/settings', '/api/listings', '/api/listings/metadata', '/api/stores',
];
const HTTP_METHODS = [...CLASSIFIED_METHODS, 'HEAD', 'OPTIONS'];
const blockedHandlers = Object.entries(DEMO_ROUTES).flatMap(([endpoint, methods]) =>
  Object.entries(methods).filter(([, access]) => access === 'deny' && endpoint !== '/api/auth/login')
    .map(([method]) => ({ endpoint, method, file: path.join(ROOT, 'app', endpoint, 'route.ts') })),
);

type Handler = (request: NextRequest, context: { params: Promise<{ listingId: string }> }) => Promise<Response>;

beforeEach(() => {
  vi.stubEnv('DEMO_MODE', '1');
  vi.clearAllMocks();
  vi.stubGlobal('fetch', (...args: unknown[]) => {
    effects.remote(...args);
    throw new Error('Unexpected outbound fetch in demo');
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('explicit server-side demo switch', () => {
  it.each([undefined, '', '0', 'true', 'yes', '01', ' 1', '1 '])('does not enable for %s', value => {
    vi.stubEnv('DEMO_MODE', value);
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', '1');
    expect(isDemoMode()).toBe(false);
    expect(guardDemoRoute('/api/tasks', 'POST')).toBeNull();
    expect(() => assertLiveIntegrationAllowed()).not.toThrow();
  });

  it('enables only for 1 and refuses independent live integration calls', () => {
    expect(isDemoMode()).toBe(true);
    expect(() => assertLiveIntegrationAllowed()).toThrow(/disabled in demo/i);
    expect(reportingNow().toISOString()).toBe(reportingNow().toISOString());
  });
});

describe('fail-closed route policy', () => {
  it.each(READ_PATHS)('allows cached reads for %s', endpoint => {
    expect(guardDemoRoute(endpoint, 'GET')).toBeNull();
    expect(guardDemoRoute(endpoint, 'HEAD')).toBeNull();
  });

  it('allows only the local chat POST exception', () => {
    expect(guardDemoRoute('/api/chat', 'POST')).toBeNull();
    expect(guardDemoRoute('/api/chat', 'GET')?.status).toBe(404);
    for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(guardDemoRoute('/api/chat', method)?.status).toBe(403);
    }
  });

  it.each(READ_PATHS)('denies every write verb on %s', endpoint => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(guardDemoRoute(endpoint, method)?.status).toBe(403);
    }
  });

  it.each([
    '/api/agent', '/api/agent/metrics', '/api/agent/tasks', '/api/agent/new-route',
    '/api/ebay/oauth/start', '/api/ebay/oauth/callback', '/api/ebay/auth/callback',
    '/api/ebay/disconnect', '/api/reset', '/api/upload', '/api/uploads',
  ])('denies all methods on the unavailable namespace %s', endpoint => {
    for (const method of HTTP_METHODS) {
      const status = ['GET', 'HEAD'].includes(method) ? 404 : 403;
      expect(guardDemoRoute(endpoint, method)?.status).toBe(status);
      expect(guardDemoRoute(endpoint + '/', method)?.status).toBe(status);
    }
  });

  it.each(['/api/unknown', '/api/auth/new-endpoint', '/api/ebay/sync/new-domain', '/api/traffic/listing/nested'])
    ('denies unknown read surface %s', endpoint => {
      expect(guardDemoRoute(endpoint, 'GET')?.status).toBe(404);
      expect(guardDemoRoute(endpoint, 'HEAD')?.status).toBe(404);
    });
});

describe('route coverage independent of the proxy', () => {
  it.each(blockedHandlers)('$method $endpoint rejects direct invocation before any effect', async route => {
    const routeModule = await import(/* @vite-ignore */ route.file) as Record<string, Handler>;
    const request = new NextRequest(`http://demo.test${route.endpoint}?id=1&code=synthetic-code&state=synthetic-state`, {
      method: route.method,
      headers: { authorization: 'Bearer synthetic-test-token', 'content-type': 'application/json' },
      ...(!['GET', 'HEAD'].includes(route.method) ? { body: '{invalid-json' } : {}),
    });
    const response = await routeModule[route.method](request, { params: Promise.resolve({ listingId: 'demo-listing' }) });
    expect([403, 404]).toContain(response.status);
    expect((await response.json()).error).toBe('Disabled in the read-only demo.');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(effects.database).not.toHaveBeenCalled();
    expect(effects.remote).not.toHaveBeenCalled();
    expect(effects.ai).not.toHaveBeenCalled();
  });

  it('does not trust request.method to downgrade a direct mutation handler', async () => {
    const { POST } = await import('@/app/api/tasks/route');
    const response = await POST(new Request('http://demo.test/api/tasks', { method: 'GET' }));
    expect(response.status).toBe(403);
    expect(effects.database).not.toHaveBeenCalled();
  });

  it('pins permitted store requests to the sample viewer and refuses unclassified endpoints', async () => {
    const { authorizeStore, demoStoreContext } = await import('@/lib/stores/route');
    expect(await authorizeStore(new Request('http://demo.test/api/orders?store=another-store'), 'view'))
      .toEqual({ storeId: 'northstar', actorId: 'demo:viewer', role: 'viewer', marketplaceId: 'EBAY_US' });
    expect(() => demoStoreContext('edit')).toThrow('Disabled in the read-only demo.');
    await expect(authorizeStore(new Request('http://demo.test/unclassified'), 'view')).rejects.toMatchObject({ status: 403 });
    expect(effects.database).not.toHaveBeenCalled();
  });

  it('blocks the Pages login handler before it examines authentication data', async () => {
    const { default: login } = await import('@/pages/api/auth/login');
    const response = { status: vi.fn().mockReturnThis(), setHeader: vi.fn(), json: vi.fn() };
    await login({ method: 'POST' } as never, response as never);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ code: 'demo_read_only', error: 'Disabled in the read-only demo.' });
    expect(response.setHeader).toHaveBeenCalledExactlyOnceWith('Cache-Control', 'no-store');
  });
});

describe('independent offline integration boundaries', () => {
  it('stops eBay HTTP access before asking for an access token or using an injected fetch', async () => {
    const { createEbayClient } = await import('@/lib/ebay/client');
    const token = vi.fn(async () => 'synthetic-token');
    const network = vi.fn();
    const client = createEbayClient({
      config: {} as never,
      getAccessToken: token,
      fetchImpl: network,
    });
    await expect(client.get('/sell/fulfillment/v1/order')).rejects.toThrow(/disabled in demo/i);
    expect(token).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it('stops token exchange before request data is inspected or sent', async () => {
    const { exchangeWithEbay } = await import('@/lib/ebay/token-exchange');
    await expect(exchangeWithEbay({} as never)).rejects.toThrow(/disabled in demo/i);
    expect(effects.remote).not.toHaveBeenCalled();
  });

  it('stops identity, listing and media clients before inspecting a live account', async () => {
    const { identifySeller, legacySellerUsername } = await import('@/lib/ebay/identity');
    const { categorySuggestions, categoryAspects } = await import('@/lib/ebay/listing/taxonomy');
    const { tradingRead, tradingWrite } = await import('@/lib/ebay/listing/trading');
    const { uploadPhotos } = await import('@/lib/ebay/listing/assets');
    const config = {} as never;
    await expect(identifySeller(config, '')).rejects.toThrow(/disabled in demo/i);
    await expect(legacySellerUsername(config, '')).rejects.toThrow(/disabled in demo/i);
    await expect(categorySuggestions(config, 'sample part')).rejects.toThrow(/disabled in demo/i);
    await expect(categoryAspects(config, '999001')).rejects.toThrow(/disabled in demo/i);
    expect(() => tradingRead(config, '', 'GetItem', '')).toThrow(/disabled in demo/i);
    await expect(tradingWrite(config, '', 'AddFixedPriceItem', '', '')).rejects.toThrow(/disabled in demo/i);
    await expect(uploadPhotos(config, '', '', [])).rejects.toThrow(/disabled in demo/i);
    expect(effects.remote).not.toHaveBeenCalled();
  });

  it.each(['gemini', 'openai', 'anthropic'] as const)('blocks direct live %s calls', async provider => {
    const { generateReply } = await import('@/lib/ai/providers');
    await expect(generateReply(provider, '', [{ role: 'user', content: 'Sample question' }]))
      .rejects.toThrow(/disabled in demo/i);
    expect(effects.ai).not.toHaveBeenCalled();
    expect(effects.remote).not.toHaveBeenCalled();
  });

  it.each(['searchAllYards', 'searchPickAPart', 'searchRuperts'] as const)
    ('stops %s before external requests', async name => {
      const yards = await import('@/lib/yard-parser');
      await expect(yards[name]('Toyota', 'Camry')).rejects.toThrow(/disabled in demo/i);
      expect(effects.remote).not.toHaveBeenCalled();
    });

  it('keeps the sourcing fixture usable without database or network', async () => {
    const { searchDemoYards } = await import('./sourcing');
    const results = searchDemoYards('Toyota', 'Camry');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(row => row.yard.startsWith('Demo Yard'))).toBe(true);
    expect(effects.database).not.toHaveBeenCalled();
    expect(effects.remote).not.toHaveBeenCalled();
  });

  it.each(['/api/auth/session', '/api/ebay/status'])('returns credential-free synthetic status for %s', async endpoint => {
    const file = path.join(ROOT, 'app', endpoint, 'route.ts');
    const { GET } = await import(/* @vite-ignore */ file);
    const response = await GET(new NextRequest(`http://demo.test${endpoint}`));
    expect(response.status).toBe(200);
    expect((await response.json()).demo).toBe(true);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(effects.database).not.toHaveBeenCalled();
    expect(effects.remote).not.toHaveBeenCalled();
  });

  it.each(['sync-due.ts', 'listing-worker.ts', 'bootstrap-owner.ts', 'reset-user.ts', 'backfill-brands.ts', 'seed-advertising-setting.ts'])
    ('rejects standalone %s before opening any database', async script => {
      const { spawnSync } = await import('node:child_process');
      const result = spawnSync(process.execPath,
        ['--import', './scripts/ts-resolver.mjs', `scripts/${script}`], {
          cwd: path.resolve(ROOT, '..'),
          env: { ...process.env, DEMO_MODE: '1', DATABASE_URL: 'file:./must-not-open.db' },
          encoding: 'utf8', timeout: 15_000,
        });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('External integrations and background writes are disabled in demo mode.');
      expect(result.stdout).not.toMatch(/nothing due|setting ensured|updated/);
    });
});

describe('proxy defense and normal-mode compatibility', () => {
  it('redirects demo sign-in to the browsable dashboard without authentication cookies', async () => {
    const { proxy } = await import('@/proxy');
    const response = await proxy(new NextRequest('http://demo.test/login'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://demo.test/');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-demo-mode')).toBe('read-only');
  });

  it('permits an anonymous demo page with same-origin-only resource policy', async () => {
    const { proxy } = await import('@/proxy');
    const response = await proxy(new NextRequest('http://demo.test/orders'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-demo-mode')).toBe('read-only');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("form-action 'none'");
  });

  it.each([
    ['/api/agent/metrics', 'GET', 404], ['/api/ebay/oauth/callback', 'GET', 404],
    ['/api/auth/login', 'POST', 403], ['/api/tasks', 'DELETE', 403],
    ['/api/new-unreviewed-route', 'GET', 404],
  ])('blocks %s %s independently', async (endpoint, method, status) => {
    const { proxy } = await import('@/proxy');
    const response = await proxy(new NextRequest(`http://demo.test${endpoint}`, { method: String(method) }));
    expect(response.status).toBe(status);
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });

  it.each(['/login', '/login/nested', '/api/auth/session', '/api/agent/metrics'])
    ('preserves normal-mode proxy exclusion %s', async endpoint => {
      vi.stubEnv('DEMO_MODE', undefined);
      const { proxy } = await import('@/proxy');
      const response = await proxy(new NextRequest(`http://demo.test${endpoint}`));
      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(response.headers.get('x-demo-mode')).toBeNull();
    });

  it.each(['/orders', '/api/orders', '/login-lookalike', '/api/agent-lookalike'])
    ('keeps normal-mode authentication fail-closed for %s', async endpoint => {
      vi.stubEnv('DEMO_MODE', undefined);
      vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', '1');
      vi.stubEnv('DASHBOARD_PASSWORD_HASH', undefined);
      vi.stubEnv('DASHBOARD_SESSION_SECRET', undefined);
      const { proxy } = await import('@/proxy');
      const response = await proxy(new NextRequest(`http://demo.test${endpoint}`));
      expect(response.status).toBe(503);
      expect(response.headers.get('x-middleware-next')).toBeNull();
    });
});

describe('normal-mode sessions remain mandatory and use the real clock', () => {
  function configureSyntheticAuth() {
    vi.stubEnv('DEMO_MODE', undefined);
    const secret = Buffer.alloc(32, 7);
    vi.stubEnv('DASHBOARD_SESSION_SECRET', secret.toString('base64'));
    // A shape-valid fixture, never a password for an operational account.
    vi.stubEnv('DASHBOARD_PASSWORD_HASH', ['scrypt', '16384', '8', '1',
      Buffer.alloc(16, 2).toString('base64'), Buffer.alloc(64, 3).toString('base64')].join(':'));
    return secret;
  }

  it('returns 401 for an API request without a session', async () => {
    configureSyntheticAuth();
    const { proxy } = await import('@/proxy');
    const response = await proxy(new NextRequest('http://demo.test/api/orders'));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('unauthenticated');
  });

  it('redirects a normal page to login with its original query', async () => {
    configureSyntheticAuth();
    const { proxy } = await import('@/proxy');
    const response = await proxy(new NextRequest('http://demo.test/orders?page=2'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/orders?page=2');
  });

  it('accepts a valid normal session without applying demo policies', async () => {
    const secret = configureSyntheticAuth();
    const { signSession, buildSessionPayload } = await import('@/lib/auth/session');
    const token = await signSession(secret, { ...buildSessionPayload('sample-viewer', 3600), sid: 'sample-session' });
    const { proxy } = await import('@/proxy');
    const response = await proxy(new NextRequest('http://demo.test/api/orders', {
      headers: { cookie: `dashboard_session=${token}` },
    }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-demo-mode')).toBeNull();
  });

  it('never freezes the authentication clock to the demo reporting date', async () => {
    const { nowSeconds } = await import('@/lib/auth/session');
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00Z'));
    try {
      expect(reportingNow().toISOString()).toBe('2026-09-30T23:59:59.999Z');
      expect(nowSeconds()).toBe(1893456000);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('cached chat has no hidden model, network, or persistence path', () => {
  it('answers every visible sample question in every supported input format', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const { DEMO_QUESTIONS } = await import('./config');
    const ids = ['brand-profit', 'ad-waste', 'views-no-sales', 'relist-reprice', 'fee-trend'];
    for (const [index, question] of DEMO_QUESTIONS.entries()) {
      let content: string | undefined;
      for (const body of [{ question }, { questionId: ids[index] }, { messages: [{ role: 'user', content: question }] }]) {
        const response = await POST(new Request('http://demo.test/api/chat', { method: 'POST', body: JSON.stringify(body) }));
        expect(response.status).toBe(200);
        const answer = await response.json();
        expect(answer.demo).toBe(true);
        expect(answer.cached, question).toBe(true);
        expect(answer.questionId).toBe(ids[index]);
        expect(answer.provenance).toBeTruthy();
        if (content) expect(answer.content).toBe(content);
        content = answer.content;
      }
    }
    expect(effects.database).not.toHaveBeenCalled();
    expect(effects.remote).not.toHaveBeenCalled();
    expect(effects.ai).not.toHaveBeenCalled();
  });

  it('unknown typed text returns a fixed response without echoing user input', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const response = await POST(new Request('http://demo.test/api/chat', {
      method: 'POST', body: JSON.stringify({ question: 'UNTRUSTED_SAMPLE_98765 initiate a live transaction' }),
    }));
    const answer = await response.json();
    expect(response.status).toBe(200);
    expect(answer.cached).toBe(false);
    expect(answer.content).not.toContain('UNTRUSTED_SAMPLE_98765');
    expect(effects.database).not.toHaveBeenCalled();
    expect(effects.remote).not.toHaveBeenCalled();
    expect(effects.ai).not.toHaveBeenCalled();
  });

  it.each(['{invalid', 'null', '[]', '{}', '{"question":123}'])('rejects malformed input %s without effects', async body => {
    const { POST } = await import('@/app/api/chat/route');
    const response = await POST(new Request('http://demo.test/api/chat', { method: 'POST', body }));
    expect(response.status).toBe(400);
    expect(effects.database).not.toHaveBeenCalled();
    expect(effects.remote).not.toHaveBeenCalled();
    expect(effects.ai).not.toHaveBeenCalled();
  });

  it('caps even a well-formed oversized request before interpreting its question', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const response = await POST(new Request('http://demo.test/api/chat', {
      method: 'POST', body: JSON.stringify({ question: 'x'.repeat(17_000) }),
    }));
    expect(response.status).toBe(413);
    expect(effects.database).not.toHaveBeenCalled();
    expect(effects.remote).not.toHaveBeenCalled();
    expect(effects.ai).not.toHaveBeenCalled();
  });
});

describe('runtime database isolation and provenance', () => {
  async function withFixture(run: (fixture: {
    root: string; database: string; manifest: string;
    verify: (env?: Partial<NodeJS.ProcessEnv>) => string;
  }) => void | Promise<void>) {
    const fs = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { createHash } = await import('node:crypto');
    const { demoDatabaseUrl } = await import('./database');
    const root = fs.mkdtempSync(path.join(tmpdir(), 'demo-boundary-test-'));
    fs.mkdirSync(path.join(root, 'prisma'));
    const database = path.join(root, 'prisma/demo.db');
    const manifest = path.join(root, 'prisma/demo-manifest.json');
    const bytes = 'Synthetic test bytes; no real database is opened by this suite.';
    fs.writeFileSync(database, bytes, { mode: 0o444 });
    fs.writeFileSync(manifest, JSON.stringify({
      schemaVersion: 1, synthetic: true, asOf: '2026-09-30',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    const uid = process.getuid && vi.spyOn(process, 'getuid').mockReturnValue(1000);
    try { await run({ root, database, manifest, verify: env => demoDatabaseUrl({ NODE_ENV: 'test', ...env }) }); }
    finally { cwd.mockRestore(); uid?.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); }
  }

  it('refuses root before accessing the runtime database', async () => {
    if (!process.getuid) return;
    const getuid = vi.spyOn(process, 'getuid').mockReturnValue(0);
    try {
      const { demoDatabaseUrl } = await import('./database');
      expect(() => demoDatabaseUrl()).toThrow(/non-root/);
    } finally { getuid.mockRestore(); }
  });

  it('accepts only a matching immutable synthetic local file', async () => {
    await withFixture(({ database, verify }) => {
      expect(verify()).toBe(`file:${database}`);
      expect(verify({ DATABASE_URL: 'file:./demo.db' })).toBe(`file:${database}`);
    });
  });

  it.each(['', 'file:./other.db', 'file:/tmp/demo.db', 'file:./demo.db?mode=ro', 'postgresql://example.invalid/db'])
    ('refuses destination %s before opening it', async DATABASE_URL => {
      await withFixture(({ verify }) => expect(() => verify({ DATABASE_URL })).toThrow(/only accepts/));
    });

  it('refuses writable database bits', async () => {
    const fs = await import('node:fs');
    await withFixture(({ database, verify }) => {
      fs.chmodSync(database, 0o600);
      expect(() => verify()).toThrow(/read-only permissions/);
    });
  });

  it.each(['-wal', '-shm', '-journal'])('refuses even ordinary %s sidecars', async suffix => {
    const fs = await import('node:fs');
    await withFixture(({ database, verify }) => {
      fs.writeFileSync(database + suffix, 'synthetic');
      expect(() => verify()).toThrow(/sidecars/);
    });
  });

  it('refuses a hard-linked database', async () => {
    const fs = await import('node:fs');
    await withFixture(({ root, database, verify }) => {
      fs.linkSync(database, path.join(root, 'another-file'));
      expect(() => verify()).toThrow(/regular file/);
    });
  });

  it('refuses a symlinked database', async () => {
    const fs = await import('node:fs');
    await withFixture(({ root, database, verify }) => {
      const target = path.join(root, 'synthetic-target');
      fs.renameSync(database, target);
      fs.symlinkSync(target, database);
      expect(() => verify()).toThrow(/regular file/);
    });
  });

  it('refuses a symlinked prisma directory', async () => {
    const fs = await import('node:fs');
    await withFixture(({ root, verify }) => {
      fs.renameSync(path.join(root, 'prisma'), path.join(root, 'synthetic-prisma'));
      fs.symlinkSync(path.join(root, 'synthetic-prisma'), path.join(root, 'prisma'));
      expect(() => verify()).toThrow(/directory must not be a symlink/);
    });
  });

  it('refuses a directory masquerading as a database', async () => {
    const fs = await import('node:fs');
    await withFixture(({ database, verify }) => {
      fs.unlinkSync(database);
      fs.mkdirSync(database);
      expect(() => verify()).toThrow(/regular file/);
    });
  });

  it.each([
    { synthetic: false }, { asOf: '2020-01-01' }, { schemaVersion: 2 }, { sha256: 'bad-checksum' },
  ])('refuses mismatched provenance %j', async patch => {
    const fs = await import('node:fs');
    await withFixture(({ manifest, verify }) => {
      const original = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      fs.writeFileSync(manifest, JSON.stringify({ ...original, ...patch }));
      expect(() => verify()).toThrow(/provenance does not match/);
    });
  });

  it('refuses missing provenance', async () => {
    const fs = await import('node:fs');
    await withFixture(({ manifest, verify }) => {
      fs.unlinkSync(manifest);
      expect(() => verify()).toThrow(/provenance is missing/);
    });
  });

  it('refuses symlinked provenance', async () => {
    const fs = await import('node:fs');
    await withFixture(({ root, manifest, verify }) => {
      const target = path.join(root, 'synthetic-manifest');
      fs.renameSync(manifest, target);
      fs.symlinkSync(target, manifest);
      expect(() => verify()).toThrow(/provenance must be a regular/);
    });
  });

  it('never admits raw SQL or model mutations in the query allowlist', async () => {
    const { DEMO_READ_OPERATIONS } = await import('./database');
    for (const operation of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
      '$executeRaw', '$executeRawUnsafe', '$queryRaw', '$queryRawUnsafe', '$runCommandRaw']) {
      expect(DEMO_READ_OPERATIONS.has(operation), operation).toBe(false);
    }
  });
});
