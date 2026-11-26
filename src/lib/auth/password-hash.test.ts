import { describe, expect, it } from 'vitest';
import { formatScryptHash, parseScryptHash } from './password-hash';

const SALT = 'c2FsdHNhbHRzYWx0c2FsdA==';
const HASH = 'aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g=';
const VALID = `scrypt:16384:8:1:${SALT}:${HASH}`;

describe('dotenv compatibility', () => {
  it('uses no character that a dotenv loader would expand', () => {
    // `$` is expanded by dotenv-expand in EVERY quoting style (verified against
    // @next/env: `scrypt$16384$8$1$A$B` loads back as `scrypt6384`), which
    // silently corrupts the hash. The separator must stay expansion-proof.
    expect(VALID).not.toContain('$');
    expect(formatScryptHash(parseScryptHash(VALID))).not.toContain('$');
  });
});

describe('parseScryptHash', () => {
  it('parses a well-formed hash', () => {
    expect(parseScryptHash(VALID)).toEqual({
      cost: 16384,
      blockSize: 8,
      parallelization: 1,
      salt: SALT,
      hash: HASH,
    });
  });

  it('round-trips through formatScryptHash', () => {
    expect(formatScryptHash(parseScryptHash(VALID))).toBe(VALID);
  });

  it.each([
    ['unknown algorithm', `bcrypt:16384:8:1:${SALT}:${HASH}`],
    ['too few fields', `scrypt:16384:8:1:${SALT}`],
    ['too many fields', `scrypt:16384:8:1:${SALT}:${HASH}:extra`],
    ['non-numeric cost', `scrypt:many:8:1:${SALT}:${HASH}`],
    ['empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(() => parseScryptHash(value)).toThrow(/DASHBOARD_PASSWORD_HASH/);
  });

  it('rejects a cost that is not a power of two', () => {
    // scrypt requires N to be a power of 2; node throws deep inside otherwise.
    expect(() => parseScryptHash(`scrypt:16000:8:1:${SALT}:${HASH}`)).toThrow(
      /power of two/i
    );
  });

  it('rejects a cost below the minimum work factor', () => {
    expect(() => parseScryptHash(`scrypt:1024:8:1:${SALT}:${HASH}`)).toThrow(
      /at least 16384/i
    );
  });

  it('rejects a salt that is not valid base64', () => {
    expect(() =>
      parseScryptHash(`scrypt:16384:8:1:not base64!:${HASH}`)
    ).toThrow(/salt/i);
  });

  it('rejects a salt shorter than 16 bytes', () => {
    const shortSalt = 'c2hvcnQ=';
    expect(() =>
      parseScryptHash(`scrypt:16384:8:1:${shortSalt}:${HASH}`)
    ).toThrow(/16 bytes/i);
  });
});
