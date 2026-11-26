import { describe, expect, it } from 'vitest';
import { base64UrlEncode, utf8Encode } from './encoding';
import {
  buildSessionPayload,
  SessionError,
  signSession,
  verifySession,
} from './session';

const SECRET = utf8Encode('a-32-byte-test-secret-value-0123');
const OTHER_SECRET = utf8Encode('a-different-32-byte-secret-01234');

describe('buildSessionPayload', () => {
  it('sets expiry to the issue time plus the TTL', () => {
    const payload = buildSessionPayload('operator', 3600, 1_000_000);
    expect(payload).toEqual({ sub: 'operator', iat: 1_000_000, exp: 1_003_600 });
  });
});

describe('signSession / verifySession', () => {
  it('round-trips a payload', async () => {
    const payload = buildSessionPayload('operator', 3600, 1_000_000);
    const token = await signSession(SECRET, payload);

    await expect(verifySession(SECRET, token, 1_000_001)).resolves.toEqual(
      payload
    );
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession(
      OTHER_SECRET,
      buildSessionPayload('operator', 3600, 1_000_000)
    );

    await expect(verifySession(SECRET, token, 1_000_001)).rejects.toThrow(
      SessionError
    );
  });

  it('rejects a payload edited after signing', async () => {
    const token = await signSession(
      SECRET,
      buildSessionPayload('operator', 3600, 1_000_000)
    );
    const [, signature] = token.split('.');
    const forged = base64UrlEncode(
      utf8Encode(JSON.stringify({ sub: 'attacker', iat: 1_000_000, exp: 9e9 }))
    );

    await expect(
      verifySession(SECRET, `${forged}.${signature}`, 1_000_001)
    ).rejects.toThrow(SessionError);
  });

  it('rejects a token that has expired', async () => {
    const token = await signSession(
      SECRET,
      buildSessionPayload('operator', 3600, 1_000_000)
    );

    await expect(verifySession(SECRET, token, 1_003_601)).rejects.toThrow(
      /expired/i
    );
  });

  it('accepts a token in its final second of validity', async () => {
    const token = await signSession(
      SECRET,
      buildSessionPayload('operator', 3600, 1_000_000)
    );

    await expect(verifySession(SECRET, token, 1_003_600)).resolves.toBeTruthy();
  });

  it.each([
    ['no separator', 'abcdef'],
    ['too many segments', 'a.b.c'],
    ['empty string', ''],
    ['non-base64url payload', 'not$valid.aaaa'],
  ])('rejects a malformed token (%s)', async (_label, token) => {
    await expect(verifySession(SECRET, token, 1_000_001)).rejects.toThrow(
      SessionError
    );
  });

  it('rejects a correctly signed token whose payload is not a session', async () => {
    // Signed with the real secret, so only the shape check can catch this.
    const payload = base64UrlEncode(utf8Encode(JSON.stringify({ hi: true })));
    const key = await crypto.subtle.importKey(
      'raw',
      SECRET,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, utf8Encode(payload))
    );

    await expect(
      verifySession(SECRET, `${payload}.${base64UrlEncode(signature)}`, 1)
    ).rejects.toThrow(/malformed/i);
  });
});
