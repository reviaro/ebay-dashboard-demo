import { demoRouteDenied, DEMO_READ_ONLY } from '@/lib/demo/guard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { NextResponse } from 'next/server';
import { attemptLogin } from '@/lib/auth/login-service';
import { loginClientKey, LoginClientError } from '@/lib/auth/login-client';
import { sessionCookieOptions } from '@/lib/auth/cookie';
import { RequestOriginError, verifySameOrigin } from '@/lib/http/request-guard';

// A Pages API handler retains the real Node socket address, which App Router
// Requests do not expose. Keep this URL out of src/app to avoid duplicate routes.
export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default async function login(request: NextApiRequest, response: NextApiResponse) {
  if (demoRouteDenied('/api/auth/login', request.method ?? '')) {
    response.setHeader('Cache-Control', 'no-store');
    response.status(403).json({ code: 'demo_read_only', error: DEMO_READ_ONLY });
    return;
  }
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (value) headers.set(name, value.join(', '));
  }
  try {
    verifySameOrigin(headers);
  } catch (error) {
    if (!(error instanceof RequestOriginError)) throw error;
    response.status(403).json({ error: error.message });
    return;
  }
  if (headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    response.status(415).json({ error: 'Expected application/json.', code: 'bad_request' });
    return;
  }

  let clientKey: string;
  try {
    clientKey = loginClientKey(request);
  } catch (error) {
    if (!(error instanceof LoginClientError)) throw error;
    response.status(503).json({ error: error.message, code: 'auth_not_configured' });
    return;
  }
  const outcome = await attemptLogin(request.body, clientKey);

  switch (outcome.status) {
    case 'ok': {
      // Keep the established Secure-cookie behavior for HTTPS proxies and
      // direct HTTP access; the browser receives the same cookie policy.
      const secure = headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase() === 'https'
        || Boolean((request.socket as { encrypted?: boolean }).encrypted);
      const cookie = new NextResponse();
      cookie.cookies.set({
        ...sessionCookieOptions({ secure, ttlSeconds: outcome.ttlSeconds }),
        value: outcome.token,
      });
      response.setHeader('Set-Cookie', cookie.headers.get('set-cookie')!);
      response.status(200).json({ ok: true, redirectTo: outcome.redirectTo });
      return;
    }
    case 'invalid_credentials':
      response.status(401).json({ error: 'Incorrect username or password.', code: 'invalid_credentials' });
      return;
    case 'rate_limited':
      response.setHeader('Retry-After', String(outcome.retryAfterSeconds));
      response.status(429).json({
        error: `Too many attempts. Try again in ${outcome.retryAfterSeconds} second(s).`,
        code: 'rate_limited',
      });
      return;
    case 'misconfigured':
      response.status(503).json({ error: outcome.reason, code: 'auth_not_configured' });
      return;
    case 'bad_request':
      response.status(400).json({ error: outcome.reason, code: 'bad_request' });
  }
}
