/**
 * Parsing and formatting for the stored password hash.
 *
 * Split from `password.ts` so that validation is available to Edge-runtime
 * code (`config.ts`, and through it `proxy.ts`) without dragging in
 * `node:crypto`. This module knows the *shape* of a hash; `password.ts` knows
 * how to compute one.
 *
 * Encoding: `scrypt:<cost>:<blockSize>:<parallelization>:<saltB64>:<hashB64>`
 *
 * The separator is `:`, NOT the `$` of the conventional PHC/crypt format.
 * This value lives in `.env.local`, and dotenv expands `$NAME` inside values in
 * every quoting style -- bare, single-quoted and double-quoted alike. Verified
 * against `@next/env`: `scrypt$16384$8$1$AAAA$BBBB` loads back as
 * `scrypt6384`, i.e. silently corrupted into an unparseable hash. `:` cannot
 * occur in base64 or in a decimal number, so it separates unambiguously and
 * survives the round trip.
 */

import { base64Decode } from './encoding';

export interface ScryptHash {
  /** scrypt N. Must be a power of two. */
  cost: number;
  /** scrypt r. */
  blockSize: number;
  /** scrypt p. */
  parallelization: number;
  /** base64, at least 16 bytes decoded. */
  salt: string;
  /** base64 derived key. */
  hash: string;
}

/**
 * Node's default is 16384; going below it would let a weak hash be smuggled in
 * through `.env.local` while still looking well-formed.
 */
const MINIMUM_COST = 16384;
const MINIMUM_SALT_BYTES = 16;

function fail(detail: string): never {
  throw new Error(
    `DASHBOARD_PASSWORD_HASH is invalid: ${detail}. Generate one with: npm run auth:hash`
  );
}

function parsePositiveInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    fail(`${label} must be a positive integer, got "${value}"`);
  }
  const parsed = Number(value);
  if (parsed <= 0) fail(`${label} must be greater than zero`);
  return parsed;
}

function requireBase64(value: string, label: string): Uint8Array {
  try {
    return base64Decode(value);
  } catch {
    fail(`${label} is not valid base64`);
  }
}

export function parseScryptHash(encoded: string): ScryptHash {
  const fields = encoded.split(':');
  if (fields.length !== 6) {
    fail(`expected 6 ":"-separated fields, got ${encoded ? fields.length : 0}`);
  }

  const [algorithm, cost, blockSize, parallelization, salt, hash] = fields;

  if (algorithm !== 'scrypt') {
    fail(`unsupported algorithm "${algorithm}" (expected "scrypt")`);
  }

  const parsedCost = parsePositiveInteger(cost, 'cost');
  if ((parsedCost & (parsedCost - 1)) !== 0) {
    fail(`cost must be a power of two, got ${parsedCost}`);
  }
  if (parsedCost < MINIMUM_COST) {
    fail(`cost must be at least ${MINIMUM_COST}, got ${parsedCost}`);
  }

  const saltBytes = requireBase64(salt, 'salt');
  if (saltBytes.length < MINIMUM_SALT_BYTES) {
    fail(`salt must decode to at least ${MINIMUM_SALT_BYTES} bytes`);
  }

  requireBase64(hash, 'hash');

  return {
    cost: parsedCost,
    blockSize: parsePositiveInteger(blockSize, 'blockSize'),
    parallelization: parsePositiveInteger(parallelization, 'parallelization'),
    salt,
    hash,
  };
}

export function formatScryptHash(parsed: ScryptHash): string {
  return [
    'scrypt',
    parsed.cost,
    parsed.blockSize,
    parsed.parallelization,
    parsed.salt,
    parsed.hash,
  ].join(':');
}
