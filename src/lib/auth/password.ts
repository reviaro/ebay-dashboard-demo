/**
 * Operator password hashing (scrypt).
 *
 * Node-only: this is imported by the login route and the hashing CLI, never by
 * the proxy. Keeping `node:crypto` out of the Edge bundle is why the format
 * parser lives separately in `password-hash.ts`.
 *
 * The plaintext password is never stored anywhere -- only the derived key, in
 * `.env.local` as `DASHBOARD_PASSWORD_HASH`.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import {
  formatScryptHash,
  parseScryptHash,
  type ScryptHash,
} from './password-hash';

export interface HashOptions {
  cost?: number;
  blockSize?: number;
  parallelization?: number;
}

const DEFAULTS = { cost: 16384, blockSize: 8, parallelization: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
export const MINIMUM_PASSWORD_LENGTH = 8;
export const MAXIMUM_PASSWORD_BYTES = 1024;

/**
 * scrypt's default maxmem (32MB) is too small once N rises; size it from the
 * actual parameters so a stronger cost does not fail with ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
 */
function maxmemFor(params: Pick<ScryptHash, 'cost' | 'blockSize'>): number {
  return Math.max(32 * 1024 * 1024, 256 * params.cost * params.blockSize * 2);
}

function derive(
  password: string,
  salt: Uint8Array,
  params: Pick<ScryptHash, 'cost' | 'blockSize' | 'parallelization'>,
  keyBytes: number
): Buffer {
  return scryptSync(password, salt, keyBytes, {
    N: params.cost,
    r: params.blockSize,
    p: params.parallelization,
    maxmem: maxmemFor(params),
  });
}

export function hashPassword(password: string, options: HashOptions = {}): string {
  if (password.trim().length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`
    );
  }

  if (Buffer.byteLength(password, 'utf8') > MAXIMUM_PASSWORD_BYTES) {
    throw new Error(`Password must be at most ${MAXIMUM_PASSWORD_BYTES} UTF-8 bytes.`);
  }

  const params = { ...DEFAULTS, ...options };
  const salt = randomBytes(SALT_BYTES);
  const derived = derive(password, salt, params, KEY_BYTES);

  return formatScryptHash({
    ...params,
    salt: salt.toString('base64'),
    hash: derived.toString('base64'),
  });
}

/**
 * Constant-time password check.
 *
 * Throws only when the *stored* hash is unusable -- that is a configuration
 * fault worth surfacing. A wrong password is an ordinary `false`.
 */
export function verifyPassword(password: string, encoded: string): boolean {
  const stored = parseScryptHash(encoded);
  const expected = Buffer.from(stored.hash, 'base64');

  // Derive to the stored length so a tampered/truncated hash compares false
  // instead of throwing on a length mismatch.
  const actual = derive(
    password,
    Buffer.from(stored.salt, 'base64'),
    stored,
    expected.length
  );

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
