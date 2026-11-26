/**
 * Signed session tokens: `<payload>.<signature>`, both base64url.
 *
 * The payload identifies a user and a revocable database session. Every data
 * request checks that session and the current store membership. Nothing secret rides in the payload -- the
 * signature is what makes it trustworthy, not obscurity -- so it is signed,
 * never encrypted.
 *
 * Built on Web Crypto rather than `node:crypto` so `src/proxy.ts` can
 * verify a token in the Edge runtime without a second implementation.
 */

import {
  base64UrlDecode,
  base64UrlEncode,
  utf8Decode,
  utf8Encode,
  type Bytes,
} from './encoding';

export interface SessionPayload {
  /** Revocable, server-side session. Absent legacy sessions cannot access data. */
  sid?: string;
  /** The immutable dashboard user ID. */
  sub: string;
  /** Issued-at, seconds since the epoch. */
  iat: number;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function buildSessionPayload(
  subject: string,
  ttlSeconds: number,
  issuedAt: number = nowSeconds()
): SessionPayload {
  return { sub: subject, iat: issuedAt, exp: issuedAt + ttlSeconds };
}

async function importKey(
  secret: Bytes,
  usage: 'sign' | 'verify'
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

export async function signSession(
  secret: Bytes,
  payload: SessionPayload
): Promise<string> {
  const encoded = base64UrlEncode(utf8Encode(JSON.stringify(payload)));
  const key = await importKey(secret, 'sign');
  const signature = await crypto.subtle.sign('HMAC', key, utf8Encode(encoded));

  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function parsePayload(encoded: string): SessionPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(base64UrlDecode(encoded)));
  } catch {
    throw new SessionError('Session token is malformed.');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as SessionPayload).sub !== 'string' ||
    typeof (parsed as SessionPayload).iat !== 'number' ||
    typeof (parsed as SessionPayload).exp !== 'number' ||
    ((parsed as SessionPayload).sid !== undefined && typeof (parsed as SessionPayload).sid !== 'string')
  ) {
    throw new SessionError('Session token is malformed.');
  }

  return parsed as SessionPayload;
}

/**
 * Returns the payload, or throws `SessionError`.
 *
 * Signature verification happens before the payload is trusted for anything,
 * and uses `crypto.subtle.verify`, which compares in constant time.
 */
export async function verifySession(
  secret: Bytes,
  token: string,
  at: number = nowSeconds()
): Promise<SessionPayload> {
  const segments = token.split('.');
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new SessionError('Session token is malformed.');
  }

  const [encodedPayload, encodedSignature] = segments;

  let signature: Bytes;
  try {
    signature = base64UrlDecode(encodedSignature);
  } catch {
    throw new SessionError('Session token is malformed.');
  }

  const key = await importKey(secret, 'verify');
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    utf8Encode(encodedPayload)
  );

  if (!valid) {
    throw new SessionError('Session signature does not verify.');
  }

  const payload = parsePayload(encodedPayload);
  if (at > payload.exp) {
    throw new SessionError('Session has expired.');
  }

  return payload;
}
