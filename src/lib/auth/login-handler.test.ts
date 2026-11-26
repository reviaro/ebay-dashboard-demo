import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiResolver } from 'next/dist/server/api-utils/node/api-resolver';
import * as loginRoute from '@/pages/api/auth/login';
import { attemptLogin } from './login-service';

vi.mock('./login-service', () => ({ attemptLogin: vi.fn() }));

let server: Server;
let base: string;
const attempt = vi.mocked(attemptLogin);

beforeAll(async () => {
  server = createServer((request, response) => {
    void apiResolver(request, response, {}, loginRoute, {
      dev: false, previewModeId: '', previewModeEncryptionKey: '', previewModeSigningKey: '',
    }, false);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
  vi.stubEnv('DASHBOARD_TRUSTED_PROXY_IPS', '');
  attempt.mockReset();
  attempt.mockResolvedValue({ status: 'ok', token: 'synthetic-session-token', ttlSeconds: 60, redirectTo: '/' });
});
afterEach(() => vi.unstubAllEnvs());

function send(body = JSON.stringify({ password: 'synthetic password', next: '/inventory' }), headers: Record<string, string> = {}) {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST', body,
    headers: { Origin: base, 'Content-Type': 'application/json', ...headers },
  });
}

describe('login Pages API through the Next request parser', () => {
  it('accepts the existing browser JSON contract and sets the session cookie', async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, redirectTo: '/' });
    expect(attempt).toHaveBeenCalledWith({ password: 'synthetic password', next: '/inventory' }, expect.stringMatching(/^[a-f0-9]{64}$/));
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('dashboard_session=synthetic-session-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=60');
    expect(cookie).not.toContain('Secure');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps secure cookies for proxied HTTPS access', async () => {
    const response = await send(undefined, { 'X-Forwarded-Proto': 'https' });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Secure');
  });

  it('does not let direct clients choose a bucket by rotating forwarded IPs', async () => {
    await send(undefined, { 'X-Forwarded-For': '198.51.100.10' });
    await send(undefined, { 'X-Forwarded-For': '198.51.100.11' });
    expect(attempt.mock.calls[0][1]).toBe(attempt.mock.calls[1][1]);
  });

  it('isolates clients behind an explicitly configured trusted proxy', async () => {
    vi.stubEnv('DASHBOARD_TRUSTED_PROXY_IPS', '127.0.0.1');
    await send(undefined, { 'X-Forwarded-For': '198.51.100.10' });
    await send(undefined, { 'X-Forwarded-For': '198.51.100.11' });
    expect(attempt.mock.calls[0][1]).not.toBe(attempt.mock.calls[1][1]);
  });

  it('fails closed for invalid proxy configuration', async () => {
    vi.stubEnv('DASHBOARD_TRUSTED_PROXY_IPS', '*');
    expect((await send()).status).toBe(503);
    expect(attempt).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests before attempting login', async () => {
    expect((await send(undefined, { Origin: 'https://other.example' })).status).toBe(403);
    expect(attempt).not.toHaveBeenCalled();
  });

  it('rejects unsupported media types before attempting login', async () => {
    expect((await send(undefined, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect(attempt).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON in the Next parser before attempting login', async () => {
    expect((await send('{broken')).status).toBe(400);
    expect(attempt).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies in the Next parser before attempting login', async () => {
    expect((await send(JSON.stringify({ password: 'x'.repeat(8192) }))).status).toBe(413);
    expect(attempt).not.toHaveBeenCalled();
  });

  it('rejects non-POST methods', async () => {
    const response = await fetch(`${base}/api/auth/login`);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(attempt).not.toHaveBeenCalled();
  });

  it('preserves the Retry-After response without setting a session cookie', async () => {
    attempt.mockResolvedValue({ status: 'rate_limited', retryAfterSeconds: 42 });
    const response = await send();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it.each([
    [{ status: 'invalid_credentials' }, 401],
    [{ status: 'bad_request', reason: 'Invalid input.' }, 400],
    [{ status: 'misconfigured', reason: 'Unavailable.' }, 503],
  ] as const)('preserves denial response %#', async (outcome, status) => {
    attempt.mockResolvedValue(outcome);
    const response = await send();
    expect(response.status).toBe(status);
    expect(response.headers.has('set-cookie')).toBe(false);
  });
});
