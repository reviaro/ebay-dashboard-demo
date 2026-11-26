import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from './config';
import { isSecureRequest, sessionCookieOptions, clearedCookieOptions } from './cookie';

function request(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe('isSecureRequest', () => {
  it('trusts an https X-Forwarded-Proto from the reverse proxy', () => {
    expect(
      isSecureRequest(request('http://127.0.0.1:3939/x', { 'x-forwarded-proto': 'https' }))
    ).toBe(true);
  });

  it('treats a plain http X-Forwarded-Proto as insecure', () => {
    expect(
      isSecureRequest(request('http://127.0.0.1:3939/x', { 'x-forwarded-proto': 'http' }))
    ).toBe(false);
  });

  it('uses the first hop when the proxy chain appends values', () => {
    expect(
      isSecureRequest(
        request('http://127.0.0.1:3939/x', { 'x-forwarded-proto': 'https, http' })
      )
    ).toBe(true);
  });

  it('falls back to the request URL when no proxy header is present', () => {
    expect(isSecureRequest(request('https://ebayboard.example/x'))).toBe(true);
    expect(isSecureRequest(request('http://192.0.2.10:3939/x'))).toBe(false);
  });

  it('ignores casing and padding in the header', () => {
    expect(
      isSecureRequest(request('http://x.test/y', { 'x-forwarded-proto': ' HTTPS ' }))
    ).toBe(true);
  });
});

describe('sessionCookieOptions', () => {
  it('marks the cookie Secure when the request arrived over https', () => {
    expect(sessionCookieOptions({ secure: true, ttlSeconds: 60 }).secure).toBe(true);
  });

  it('omits Secure over plain http so direct LAN access still works', () => {
    // A Secure cookie is never sent back over http, which would present as a
    // silent login loop on http://192.0.2.10:3939.
    expect(sessionCookieOptions({ secure: false, ttlSeconds: 60 }).secure).toBe(false);
  });

  it('is httpOnly, lax, and site-wide', () => {
    const options = sessionCookieOptions({ secure: true, ttlSeconds: 60 });
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.name).toBe(SESSION_COOKIE_NAME);
  });

  it('carries the session lifetime as maxAge', () => {
    expect(sessionCookieOptions({ secure: true, ttlSeconds: 3600 }).maxAge).toBe(3600);
  });
});

describe('clearedCookieOptions', () => {
  it('expires the cookie immediately', () => {
    expect(clearedCookieOptions({ secure: false }).maxAge).toBe(0);
  });

  it('keeps the name and path so the browser matches the original cookie', () => {
    const options = clearedCookieOptions({ secure: false });
    expect(options.name).toBe(SESSION_COOKIE_NAME);
    expect(options.path).toBe('/');
  });
});
