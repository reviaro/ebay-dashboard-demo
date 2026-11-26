import { describe, it, expect } from 'vitest';
import {
  encryptToken,
  decryptToken,
  parseEncryptionKeys,
  type EncryptedSecret,
} from './token-store';

// Two distinct 32-byte keys, base64-encoded, for key-version tests.
const KEY_V1 = Buffer.alloc(32, 1).toString('base64');
const KEY_V2 = Buffer.alloc(32, 2).toString('base64');
const KEYS = parseEncryptionKeys(`v1:${KEY_V1},v2:${KEY_V2}`);

describe('parseEncryptionKeys', () => {
  it('parses a single unversioned key as v1', () => {
    const keys = parseEncryptionKeys(KEY_V1);
    expect(keys.activeVersion).toBe('v1');
    expect(keys.byVersion.get('v1')).toHaveLength(32);
  });

  it('treats the last listed version as active so rotation is additive', () => {
    expect(KEYS.activeVersion).toBe('v2');
    expect([...KEYS.byVersion.keys()]).toEqual(['v1', 'v2']);
  });

  it('rejects a key that is not 32 bytes', () => {
    const short = Buffer.alloc(16, 9).toString('base64');
    expect(() => parseEncryptionKeys(short)).toThrow(/32 bytes/);
  });

  it('rejects an empty key spec', () => {
    expect(() => parseEncryptionKeys('')).toThrow(/EBAY_TOKEN_ENCRYPTION_KEY/);
  });
});

describe('encryptToken / decryptToken', () => {
  it('round-trips a refresh token', () => {
    const secret = encryptToken('v^1.1#i^1#f^0#r^1#refresh-token-value', KEYS);
    expect(decryptToken(secret, KEYS)).toBe('v^1.1#i^1#f^0#r^1#refresh-token-value');
  });

  it('never stores the plaintext in any field of the record', () => {
    const plaintext = 'super-secret-refresh-token';
    const secret = encryptToken(plaintext, KEYS);
    const serialized = JSON.stringify(secret);
    expect(serialized).not.toContain(plaintext);
    expect(serialized).not.toContain('super-secret');
  });

  it('produces a different ciphertext each time for the same plaintext', () => {
    const a = encryptToken('same-token', KEYS);
    const b = encryptToken('same-token', KEYS);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('stamps the active key version on the record', () => {
    expect(encryptToken('t', KEYS).keyVersion).toBe('v2');
  });

  it('decrypts a record written under an older key version', () => {
    const onlyV1 = parseEncryptionKeys(`v1:${KEY_V1}`);
    const legacy = encryptToken('old-token', onlyV1);
    expect(legacy.keyVersion).toBe('v1');
    // The rotated keyring still holds v1, so old records stay readable.
    expect(decryptToken(legacy, KEYS)).toBe('old-token');
  });

  it('fails loudly when the key version is unknown', () => {
    const secret: EncryptedSecret = { ...encryptToken('t', KEYS), keyVersion: 'v9' };
    expect(() => decryptToken(secret, KEYS)).toThrow(/unknown key version/i);
  });

  it('fails when decrypting with the wrong key', () => {
    const otherKeys = parseEncryptionKeys(`v2:${Buffer.alloc(32, 7).toString('base64')}`);
    const secret = encryptToken('token', KEYS);
    expect(() => decryptToken(secret, otherKeys)).toThrow();
  });

  it('rejects a tampered ciphertext instead of returning garbage', () => {
    const secret = encryptToken('token', KEYS);
    const raw = Buffer.from(secret.ciphertext, 'base64');
    raw[0] ^= 0xff;
    const tampered = { ...secret, ciphertext: raw.toString('base64') };
    expect(() => decryptToken(tampered, KEYS)).toThrow();
  });

  it('rejects a tampered auth tag instead of returning garbage', () => {
    const secret = encryptToken('token', KEYS);
    const raw = Buffer.from(secret.authTag, 'base64');
    raw[0] ^= 0xff;
    const tampered = { ...secret, authTag: raw.toString('base64') };
    expect(() => decryptToken(tampered, KEYS)).toThrow();
  });
});
