import { describe, it, expect } from 'vitest';
import { redact, redactString } from './redact';

describe('redactString', () => {
  it('masks an eBay OAuth token appearing in free text', () => {
    const out = redactString(
      'request failed with token v^1.1#i^1#f^0#p^3#r^1#I^3#t^Ul4xMF8x'
    );
    expect(out).not.toContain('Ul4xMF8x');
    expect(out).toContain('[REDACTED]');
  });

  it('masks a Bearer token in a header dump', () => {
    const out = redactString('Authorization: Bearer abc123DEF456ghi789JKL');
    expect(out).not.toContain('abc123DEF456ghi789JKL');
    expect(out).toContain('[REDACTED]');
  });

  it('masks Basic credentials in a header dump', () => {
    const out = redactString('Authorization: Basic dXNlcjpwYXNzd29yZA==');
    expect(out).not.toContain('dXNlcjpwYXNzd29yZA==');
  });

  it('masks secrets carried in a query string', () => {
    const out = redactString(
      'https://auth.ebay.com/cb?code=v%5E1.1%23secretcode&state=abc'
    );
    expect(out).not.toContain('secretcode');
    expect(out).toContain('state=abc');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Synced 42 orders for marketplace EBAY_US in 1.2s';
    expect(redactString(text)).toBe(text);
  });
});

describe('redact', () => {
  it('masks values of sensitive keys regardless of casing', () => {
    const out = redact({
      client_secret: 'PRD-abc-123',
      accessToken: 'tok-live-xyz',
      Refresh_Token: 'rt-live-999',
      CODE: 'auth-code-here',
    }) as Record<string, unknown>;

    expect(out.client_secret).toBe('[REDACTED]');
    expect(out.accessToken).toBe('[REDACTED]');
    expect(out.Refresh_Token).toBe('[REDACTED]');
    expect(out.CODE).toBe('[REDACTED]');
  });

  it('preserves non-sensitive fields so errors stay debuggable', () => {
    const out = redact({
      status: 401,
      errorId: 1001,
      message: 'Invalid access token',
      access_token: 'tok-live-xyz',
    }) as Record<string, unknown>;

    expect(out.status).toBe(401);
    expect(out.errorId).toBe(1001);
    expect(out.message).toBe('Invalid access token');
    expect(out.access_token).toBe('[REDACTED]');
  });

  it('masks nested and arrayed secrets', () => {
    const out = redact({
      request: {
        headers: { authorization: 'Bearer tok-live-xyz' },
        retries: [{ refresh_token: 'rt-1' }, { refresh_token: 'rt-2' }],
      },
    });

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('tok-live-xyz');
    expect(serialized).not.toContain('rt-1');
    expect(serialized).not.toContain('rt-2');
  });

  it('scrubs token patterns hiding inside non-sensitive string fields', () => {
    const out = redact({
      message: 'failed for Bearer abc123DEF456ghi789JKL',
    }) as Record<string, string>;
    expect(out.message).not.toContain('abc123DEF456ghi789JKL');
  });

  it('survives circular references without throwing', () => {
    const node: Record<string, unknown> = { name: 'run', secret_key: 's3cret' };
    node.self = node;
    const out = redact(node) as Record<string, unknown>;
    expect(out.secret_key).toBe('[REDACTED]');
    expect(out.self).toBe('[Circular]');
  });

  it('redacts an Error into a plain serializable object', () => {
    const err = new Error('token refresh failed: refresh_token=rt-live-999');
    const out = redact(err) as Record<string, unknown>;
    expect(String(out.message)).not.toContain('rt-live-999');
    expect(out.name).toBe('Error');
  });
});

describe('redactString: eBay credential formats in free text', () => {
  it('masks a production cert ID (client secret) with no sensitive key name', () => {
    const out = redactString(
      'token exchange rejected for PRD-a1b2c3d4e5f6-1a2b-3c4d-5e6f'
    );
    expect(out).not.toContain('a1b2c3d4e5f6');
    expect(out).toContain('[REDACTED]');
  });

  it('masks a sandbox cert ID too', () => {
    const out = redactString('using SBX-a1b2c3d4e5f6-9f8e-7d6c-5b4a for auth');
    expect(out).not.toContain('a1b2c3d4e5f6');
  });

  it('masks a cert ID nested in an innocuous message field', () => {
    const out = redact({
      message: 'invalid_client for PRD-a1b2c3d4e5f6-1a2b-3c4d-5e6f',
    }) as Record<string, string>;
    expect(out.message).not.toContain('a1b2c3d4e5f6');
  });

  it('does not mask ordinary hyphenated identifiers', () => {
    const text = 'order 12-34567-89012 shipped via UPS-GROUND';
    expect(redactString(text)).toBe(text);
  });
});
