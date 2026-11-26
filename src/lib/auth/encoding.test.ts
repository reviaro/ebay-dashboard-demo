import { describe, expect, it } from 'vitest';
import {
  base64Decode,
  base64UrlDecode,
  base64UrlEncode,
  utf8Decode,
  utf8Encode,
} from './encoding';

describe('base64UrlEncode', () => {
  it('emits no padding, plus, or slash characters', () => {
    // 0xFB 0xFF encodes to "+/8=" in standard base64.
    const encoded = base64UrlEncode(new Uint8Array([0xfb, 0xff]));
    expect(encoded).toBe('-_8');
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });

  it('round-trips an empty array', () => {
    expect(base64UrlDecode(base64UrlEncode(new Uint8Array(0)))).toEqual(
      new Uint8Array(0)
    );
  });
});

describe('base64UrlDecode', () => {
  it('rejects characters outside the base64url alphabet', () => {
    expect(() => base64UrlDecode('abc$def')).toThrow(/base64url/i);
  });

  it('rejects standard base64 padding', () => {
    expect(() => base64UrlDecode('-_8=')).toThrow(/base64url/i);
  });
});

describe('base64Decode', () => {
  it('decodes a padded standard base64 string', () => {
    expect(base64Decode('+/8=')).toEqual(new Uint8Array([0xfb, 0xff]));
  });

  it('rejects a string that is not valid base64', () => {
    expect(() => base64Decode('not valid!!')).toThrow(/base64/i);
  });
});

describe('utf8', () => {
  it('round-trips multi-byte text', () => {
    const text = 'Volvo — Pick-A-Part ✓';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });
});
