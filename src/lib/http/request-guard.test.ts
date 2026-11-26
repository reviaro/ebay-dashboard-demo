import { describe, it, expect } from 'vitest';
import { verifySameOrigin, RequestOriginError } from './request-guard';

const h = (entries: Record<string, string>) => new Headers(entries);

describe('verifySameOrigin', () => {
  it('accepts an Origin whose host matches Host', () => {
    expect(() =>
      verifySameOrigin(h({ origin: 'http://localhost:3939', host: 'localhost:3939' }))
    ).not.toThrow();
  });

  it('rejects an Origin from a different host', () => {
    expect(() =>
      verifySameOrigin(h({ origin: 'https://evil.example', host: 'localhost:3939' }))
    ).toThrow(RequestOriginError);
  });

  it('rejects an Origin that only prefixes the real host', () => {
    expect(() =>
      verifySameOrigin(h({ origin: 'http://localhost:3939.evil.example', host: 'localhost:3939' }))
    ).toThrow(RequestOriginError);
  });

  it('rejects a port mismatch, since another local app is a different origin', () => {
    expect(() =>
      verifySameOrigin(h({ origin: 'http://localhost:3000', host: 'localhost:3939' }))
    ).toThrow(RequestOriginError);
  });

  it('accepts a same-origin request that omits Origin but says so via Sec-Fetch-Site', () => {
    expect(() =>
      verifySameOrigin(h({ host: 'localhost:3939', 'sec-fetch-site': 'same-origin' }))
    ).not.toThrow();
  });

  it('rejects a same-site request without proof of the exact origin', () => {
    expect(() =>
      verifySameOrigin(h({ host: 'dashboard.example', 'sec-fetch-site': 'same-site' }))
    ).toThrow(RequestOriginError);
  });

  it('accepts a direct navigation (Sec-Fetch-Site: none)', () => {
    expect(() =>
      verifySameOrigin(h({ host: 'localhost:3939', 'sec-fetch-site': 'none' }))
    ).not.toThrow();
  });

  it('rejects a cross-site request even when Origin is absent', () => {
    expect(() =>
      verifySameOrigin(h({ host: 'localhost:3939', 'sec-fetch-site': 'cross-site' }))
    ).toThrow(RequestOriginError);
  });

  it('rejects when neither Origin nor Sec-Fetch-Site is present', () => {
    // An old client or a scripted request: fail closed rather than assume safe.
    expect(() => verifySameOrigin(h({ host: 'localhost:3939' }))).toThrow(
      RequestOriginError
    );
  });

  it('rejects when Host is missing entirely', () => {
    expect(() => verifySameOrigin(h({ origin: 'http://localhost:3939' }))).toThrow(
      RequestOriginError
    );
  });

  it('prefers X-Forwarded-Host when behind a proxy', () => {
    expect(() =>
      verifySameOrigin(
        h({
          origin: 'https://dash.example.com',
          host: 'localhost:3939',
          'x-forwarded-host': 'dash.example.com',
        })
      )
    ).not.toThrow();
  });

  it('never puts a secret in the rejection message', () => {
    try {
      verifySameOrigin(h({ origin: 'https://evil.example?token=abc123', host: 'x' }));
    } catch (e) {
      expect((e as Error).message).not.toContain('abc123');
    }
  });
});
