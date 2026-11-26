/**
 * Byte/string conversions that work in every runtime this app uses.
 *
 * `src/proxy.ts` runs in the Edge runtime, where `node:crypto` and
 * `Buffer` are not dependable. Everything here is built on web primitives
 * (`atob`/`btoa`, `TextEncoder`) so the same session code runs unchanged in
 * the proxy, in route handlers, and under vitest.
 */

/**
 * `Uint8Array` pinned to a non-shared `ArrayBuffer`.
 *
 * Since TypeScript 5.7 `Uint8Array` is generic over its backing buffer, and the
 * default `ArrayBufferLike` is not assignable to `BufferSource` -- which is what
 * every Web Crypto call takes. Naming the concrete type once here keeps the
 * casts out of the call sites.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]*$/;
const BASE64_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;

export function utf8Encode(text: string): Bytes {
  // TextEncoder always allocates a fresh, non-shared buffer; only the declared
  // lib type is widened.
  return new TextEncoder().encode(text) as Bytes;
}

export function utf8Decode(bytes: Bytes): string {
  return new TextDecoder().decode(bytes);
}

function binaryToBytes(binary: string): Bytes {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBinary(bytes: Bytes): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
}

/** Base64url per RFC 4648 §5: `-`/`_` instead of `+`/`/`, and no padding. */
export function base64UrlEncode(bytes: Bytes): string {
  return btoa(bytesToBinary(bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(encoded: string): Bytes {
  // Padding is rejected rather than tolerated: a token is something we minted,
  // so anything that is not exactly the shape we emit is suspect.
  if (!BASE64URL_ALPHABET.test(encoded)) {
    throw new Error('Value is not valid base64url.');
  }

  const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard.padEnd(
    standard.length + ((4 - (standard.length % 4)) % 4),
    '='
  );

  try {
    return binaryToBytes(atob(padded));
  } catch {
    throw new Error('Value is not valid base64url.');
  }
}

/** Standard base64, for operator-supplied values like `openssl rand -base64 32`. */
export function base64Decode(encoded: string): Bytes {
  if (!BASE64_ALPHABET.test(encoded)) {
    throw new Error('Value is not valid base64.');
  }

  try {
    return binaryToBytes(atob(encoded));
  } catch {
    throw new Error('Value is not valid base64.');
  }
}
