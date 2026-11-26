import { describe, expect, it } from 'vitest';
import { parseScryptHash } from './password-hash';
import { hashPassword, verifyPassword } from './password';

const PASSWORD = 'correct horse battery staple';

describe('hashPassword', () => {
  it('produces a hash that verifies against the same password', () => {
    expect(verifyPassword(PASSWORD, hashPassword(PASSWORD))).toBe(true);
  });

  it('salts randomly, so the same password hashes differently each time', () => {
    expect(hashPassword(PASSWORD)).not.toBe(hashPassword(PASSWORD));
  });

  it('emits a hash the format parser accepts', () => {
    expect(() => parseScryptHash(hashPassword(PASSWORD))).not.toThrow();
  });

  it.each([
    ['an empty password', ''],
    ['a whitespace-only password', '    '],
    ['a password below the minimum length', 'short12'],
  ])('refuses to hash %s', (_label, weak) => {
    expect(() => hashPassword(weak)).toThrow(/8 characters/i);
  });
});

describe('password size bound', () => {
  it.each(['x'.repeat(1025), '🐈'.repeat(257)])('rejects oversized credentials before hashing', (password) => {
    expect(() => hashPassword(password)).toThrow('1024 UTF-8 bytes');
  });

  it('accepts the largest supported credential', () => {
    const password = '🐈'.repeat(256);
    expect(verifyPassword(password, hashPassword(password))).toBe(true);
  });
});

describe('verifyPassword', () => {
  it('rejects a wrong password', () => {
    expect(verifyPassword('wrong password entirely', hashPassword(PASSWORD))).toBe(
      false
    );
  });

  it('rejects a password differing by one character', () => {
    expect(verifyPassword(`${PASSWORD}!`, hashPassword(PASSWORD))).toBe(false);
  });

  it('rejects an empty candidate without throwing', () => {
    expect(verifyPassword('', hashPassword(PASSWORD))).toBe(false);
  });

  it('honours the cost parameters stored in the hash', () => {
    // 32768 differs from the default, so a verifier that ignored the stored
    // parameters and re-derived with its own defaults would return false.
    const stored = hashPassword(PASSWORD, { cost: 32768 });
    expect(parseScryptHash(stored).cost).toBe(32768);
    expect(verifyPassword(PASSWORD, stored)).toBe(true);
  });

  it('returns false rather than throwing when the stored hash is truncated', () => {
    const parsed = parseScryptHash(hashPassword(PASSWORD));
    const truncated = [
      'scrypt',
      parsed.cost,
      parsed.blockSize,
      parsed.parallelization,
      parsed.salt,
      // A valid-base64 but wrong-length derived key.
      'YWJj',
    ].join(':');

    expect(verifyPassword(PASSWORD, truncated)).toBe(false);
  });

  it('throws when the stored hash is malformed', () => {
    expect(() => verifyPassword(PASSWORD, 'garbage')).toThrow(
      /DASHBOARD_PASSWORD_HASH/
    );
  });
});
