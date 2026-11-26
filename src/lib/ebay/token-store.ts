import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

/**
 * Authenticated-encryption envelope for a secret at rest (AES-256-GCM).
 *
 * Only ciphertext, IV, tag, and key version are ever persisted. The plaintext
 * refresh token exists in memory for the duration of a single call and is never
 * written to a column, a log line, or an API response.
 */
export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64, 12 bytes (GCM standard)
  authTag: string; // base64, 16 bytes
  keyVersion: string;
}

export interface EncryptionKeyring {
  /** Version stamped on newly written records. */
  activeVersion: string;
  /** Every key we can still decrypt with, keyed by version. */
  byVersion: Map<string, Buffer>;
}

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

/**
 * Parses EBAY_TOKEN_ENCRYPTION_KEY into a keyring.
 *
 * Accepts either a bare base64 key (treated as `v1`) or a comma-separated list
 * of `version:base64key` pairs. Rotation is additive: append a new version and
 * keep the old ones so previously written records stay readable.
 */
export function parseEncryptionKeys(spec: string): EncryptionKeyring {
  const trimmed = spec?.trim() ?? '';
  if (!trimmed) {
    throw new Error(
      'EBAY_TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32'
    );
  }

  const byVersion = new Map<string, Buffer>();
  let activeVersion = '';

  for (const entry of trimmed.split(',')) {
    const part = entry.trim();
    if (!part) continue;

    const separator = part.indexOf(':');
    const version = separator === -1 ? 'v1' : part.slice(0, separator).trim();
    const encoded = separator === -1 ? part : part.slice(separator + 1).trim();

    const key = Buffer.from(encoded, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `EBAY_TOKEN_ENCRYPTION_KEY version "${version}" must decode to 32 bytes, got ${key.length}. Generate one with: openssl rand -base64 32`
      );
    }

    byVersion.set(version, key);
    activeVersion = version;
  }

  if (!activeVersion) {
    throw new Error(
      'EBAY_TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32'
    );
  }

  return { activeVersion, byVersion };
}

export function encryptToken(
  plaintext: string,
  keys: EncryptionKeyring
): EncryptedSecret {
  const key = keys.byVersion.get(keys.activeVersion);
  if (!key) {
    throw new Error(`Unknown key version "${keys.activeVersion}"`);
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: keys.activeVersion,
  };
}

export function decryptToken(
  secret: EncryptedSecret,
  keys: EncryptionKeyring
): string {
  const key = keys.byVersion.get(secret.keyVersion);
  if (!key) {
    throw new Error(
      `Cannot decrypt: unknown key version "${secret.keyVersion}". Was EBAY_TOKEN_ENCRYPTION_KEY rotated without keeping the previous key?`
    );
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(secret.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));

  // GCM verification failure throws here; never returns partial plaintext.
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Constant-time comparison for OAuth state and similar short secrets. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
