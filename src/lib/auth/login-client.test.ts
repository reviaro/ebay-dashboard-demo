import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { loginClientKey, normalizeAddress } from './login-client';

function request(address: string, headers: IncomingMessage['headers'] = {}) {
  return { socket: { remoteAddress: address }, headers } as IncomingMessage;
}

describe('login client identity', () => {
  it('uses the real socket address and ignores all spoofed forwarding headers by default', () => {
    const expected = loginClientKey(request('192.0.2.10'), '');
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
    expect(loginClientKey(request('192.0.2.10', {
      'x-forwarded-for': '198.51.100.9',
      'x-real-ip': '198.51.100.8',
      'x-client-ip': '198.51.100.7',
      cookie: 'client=anything',
    }), '')).toBe(expected);
    expect(loginClientKey(request('192.0.2.11'), '')).not.toBe(expected);
  });

  it('canonicalizes mapped IPv4 and alternative IPv6 spellings into the same bucket', () => {
    expect(loginClientKey(request('::ffff:192.0.2.10'), '')).toBe(loginClientKey(request('192.0.2.10'), ''));
    expect(normalizeAddress('::FFFF:c000:020a')).toBe('192.0.2.10');
    expect(loginClientKey(request('2001:db8:0:0:0:0:0:1'), '')).toBe(loginClientKey(request('2001:db8::1'), ''));
  });

  it('reads a forwarded client only from an explicitly trusted socket peer', () => {
    const forwarded = { 'x-forwarded-for': '198.51.100.10' };
    expect(loginClientKey(request('192.0.2.1', forwarded), '192.0.2.1')).toBe(loginClientKey(request('198.51.100.10'), ''));
    expect(loginClientKey(request('192.0.2.2', forwarded), '192.0.2.1')).toBe(loginClientKey(request('192.0.2.2'), ''));
  });

  it('walks trusted proxy hops from the right and ignores attacker-supplied left prefixes', () => {
    const actual = loginClientKey(request('192.0.2.1', {
      'x-forwarded-for': 'fake, 198.51.100.10, 192.0.2.2',
    }), '192.0.2.1, 192.0.2.2');
    expect(actual).toBe(loginClientKey(request('198.51.100.10'), ''));
  });

  it.each(['*', '192.0.2.0/24', 'proxy.example', '192.0.2.1,', Array(17).fill('192.0.2.1').join(',')])(
    'fails closed for invalid proxy configuration %s', (trusted) => {
      expect(() => loginClientKey(request('192.0.2.1'), trusted)).toThrow('configuration');
    }
  );

  it.each(['', 'unknown', '198.51.100.10:80', '192.0.2.1', Array(17).fill('198.51.100.10').join(',')])(
    'fails closed for invalid or missing trusted-proxy address chain %s', (forwarded) => {
      expect(() => loginClientKey(request('192.0.2.1', { 'x-forwarded-for': forwarded }), '192.0.2.1')).toThrow();
    }
  );

  it('fails closed when the real socket identity is missing', () => {
    expect(() => loginClientKey(request('', { 'x-forwarded-for': '198.51.100.10' }), '')).toThrow('unavailable');
  });
});
