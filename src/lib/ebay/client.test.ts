import { describe, expect, it, vi } from 'vitest';
import { loadEbayConfig } from './config';
import { EbayWriteBlockedError } from './read-only';
import { EbayApiError, EbayAuthError, EbayRateLimitError } from './errors';
import { createEbayClient } from './client';

const CONFIG = loadEbayConfig({
  EBAY_ENVIRONMENT: 'sandbox',
  EBAY_CLIENT_ID: 'SBX-a1b2c3d4e5f6-1a2b-3c4d-5e6f',
  EBAY_CLIENT_SECRET: 'SBX-a1b2c3d4e5f6-1a2b-3c4d-5e6f',
  EBAY_RUNAME: 'Test_Name-TestName-testap-abcdef',
  EBAY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64'),
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function client(
  fetchImpl: typeof fetch,
  overrides: { maxAttempts?: number; getAccessToken?: () => Promise<string> } = {}
) {
  return createEbayClient({
    config: CONFIG,
    getAccessToken: overrides.getAccessToken ?? (async () => 'access-token-xyz'),
    fetchImpl,
    // Deterministic and instant: the backoff schedule has its own tests.
    sleep: async () => {},
    maxAttempts: overrides.maxAttempts ?? 3,
  });
}

describe('read-only enforcement', () => {
  // This is the test that earns the read-only claim. It is not a mocked
  // assertion that a guard was invoked -- it drives the real client and proves
  // no request reaches the network.
  it.each([
    ['PUT', '/sell/inventory/v1/inventory_item/SKU-1'],
    ['POST', '/sell/inventory/v1/offer'],
    ['PATCH', '/sell/inventory/v1/offer/123'],
    ['DELETE', '/sell/inventory/v1/inventory_item/SKU-1'],
    ['DELETE', '/sell/marketing/v1/ad_report_task/9'],
  ])('refuses %s %s and never calls fetch', async (method, path) => {
    const fetchImpl = vi.fn();
    const c = client(fetchImpl as unknown as typeof fetch);

    await expect(c.request(method, path)).rejects.toThrow(EbayWriteBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a write even when the path carries a query string', async () => {
    const fetchImpl = vi.fn();
    const c = client(fetchImpl as unknown as typeof fetch);

    await expect(
      c.request('PUT', '/sell/inventory/v1/offer?limit=1')
    ).rejects.toThrow(EbayWriteBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows the one permitted POST: creating an ad report task', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ taskId: 't-1' }));
    const c = client(fetchImpl as unknown as typeof fetch);

    await expect(
      c.request('POST', '/sell/marketing/v1/ad_report_task', { body: { a: 1 } })
    ).resolves.toEqual({ taskId: 't-1' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('requests', () => {
  it('returns the parsed JSON body of a GET', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ total: 7 }));
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/sell/fulfillment/v1/order')
    ).resolves.toEqual({ total: 7 });
  });

  it('targets the configured environment host', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await client(fetchImpl as unknown as typeof fetch).get('/sell/fulfillment/v1/order');

    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toBe('https://api.sandbox.ebay.com/sell/fulfillment/v1/order');
  });

  it('sends the bearer token and marketplace header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await client(fetchImpl as unknown as typeof fetch).get('/x');

    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer access-token-xyz');
    expect(headers.get('x-ebay-c-marketplace-id')).toBe('EBAY_US');
  });

  it('appends query parameters, skipping undefined ones', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await client(fetchImpl as unknown as typeof fetch).get('/sell/fulfillment/v1/order', {
      query: { limit: 50, offset: undefined, filter: 'a b' },
    });

    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('limit=50');
    expect(url).toContain('filter=a+b');
    expect(url).not.toContain('offset');
  });

  it('asks for a fresh access token on every request', async () => {
    const getAccessToken = vi.fn(async () => 'tok');
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const c = client(fetchImpl as unknown as typeof fetch, { getAccessToken });

    await c.get('/a');
    await c.get('/b');

    // Caching belongs to the token provider, not here -- the client must not
    // hold a token across calls or it will keep using a revoked one.
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });

  it('returns null for a 204 with no body', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/x')
    ).resolves.toBeNull();
  });
});

describe('errors and retries', () => {
  it('maps 401 to an auth error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ errorId: 1001, message: 'Invalid access token' }] }, 401)
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/x')
    ).rejects.toThrow(EbayAuthError);
  });

  it('does not retry a 400', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: [] }, 400));
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/x')
    ).rejects.toThrow(EbayApiError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('retries a 500 and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/x')
    ).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a 429 and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/x')
    ).resolves.toEqual({ ok: true });
  });

  it('gives up after maxAttempts and throws the last error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 503));
    await expect(
      client(fetchImpl as unknown as typeof fetch, { maxAttempts: 3 }).get('/x')
    ).rejects.toThrow(EbayApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries a network failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(
        // Shaped like a real Node fetch failure: errno on the cause.
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), {
            code: 'ENOTFOUND',
          }),
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/x')
    ).resolves.toEqual({ ok: true });
  });

  it('never retries a blocked write', async () => {
    const fetchImpl = vi.fn();
    await expect(
      client(fetchImpl as unknown as typeof fetch).request('PUT', '/x')
    ).rejects.toThrow(EbayWriteBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces a rate-limit error when retries are exhausted', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429));
    await expect(
      client(fetchImpl as unknown as typeof fetch, { maxAttempts: 2 }).get('/x')
    ).rejects.toThrow(EbayRateLimitError);
  });

  it('does not leak the access token in the retained error details either', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ errorId: 1001, message: 'bad access-token-xyz' }] }, 401)
    );

    const error = await client(fetchImpl as unknown as typeof fetch)
      .get('/x')
      .catch((e) => e);

    expect((error as EbayApiError).details).toBeDefined();
    expect(JSON.stringify((error as EbayApiError).details)).not.toContain(
      'access-token-xyz'
    );
  });

  it('does not leak the access token in an error message', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ errorId: 1001, message: 'bad token access-token-xyz' }] }, 401)
    );

    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/x')
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('access-token-xyz'),
      })
    );
  });

  // Sell Inventory rejects a request with no Accept-Language, reporting it as
  // "Invalid value for header Accept-Language" rather than as missing.
  describe('Accept-Language', () => {
    it('sends a language matching the marketplace', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      await client(fetchImpl as unknown as typeof fetch).get('/sell/inventory/v1/inventory_item');

      const headers = new Headers(fetchImpl.mock.calls[0][1].headers);
      expect(headers.get('accept-language')).toBe('en-US');
    });

    it('lets a caller override it', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      await client(fetchImpl as unknown as typeof fetch)
        .get('/sell/inventory/v1/inventory_item', { headers: { 'accept-language': 'de-DE' } });

      const headers = new Headers(fetchImpl.mock.calls[0][1].headers);
      expect(headers.get('accept-language')).toBe('de-DE');
    });
  });

  // The Active Inventory Report arrives as a ZIP. Reading it with
  // `response.text()`, as every other call does, corrupts the bytes before
  // anything can unzip them.
  describe('binary responses', () => {
    const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x01]);

    it('returns the bytes untouched when asked for them', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(ZIP, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
      );

      const bytes = await client(fetchImpl as unknown as typeof fetch)
        .get<Uint8Array>('/sell/feed/v1/task/t-1/download_result_file', { responseType: 'bytes' });

      expect(Array.from(bytes)).toEqual(Array.from(ZIP));
    });

    it('still surfaces an API error rather than handing back an error page as bytes', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ errors: [{ errorId: 1001, message: 'task not found' }] }, 404)
      );

      await expect(
        client(fetchImpl as unknown as typeof fetch)
          .get('/sell/feed/v1/task/nope/download_result_file', { responseType: 'bytes' })
      ).rejects.toThrow(EbayApiError);
    });

    it('leaves JSON calls parsing as before', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ total: 3 }));
      const body = await client(fetchImpl as unknown as typeof fetch).get<{ total: number }>('/sell/feed/v1/inventory_task');
      expect(body.total).toBe(3);
    });
  });
});
