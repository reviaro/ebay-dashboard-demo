import { describe, expect, it } from 'vitest';
import { hasEnvValue, upsertEnvValue } from './env-file';

const EXISTING = `# eBay API sync (read-only)
EBAY_CLIENT_ID=abc-123
EBAY_CLIENT_SECRET="test-only"
EBAY_TOKEN_ENCRYPTION_KEY="v1:AAAA"
`;

describe('upsertEnvValue', () => {
  it('appends a new key', () => {
    expect(upsertEnvValue('A=1\n', 'B', '2')).toBe('A=1\nB="2"\n');
  });

  it('adds a newline first when the file does not end with one', () => {
    expect(upsertEnvValue('A=1', 'B', '2')).toBe('A=1\nB="2"\n');
  });

  it('writes into an empty file', () => {
    expect(upsertEnvValue('', 'B', '2')).toBe('B="2"\n');
  });

  it('replaces an existing key in place', () => {
    expect(upsertEnvValue('A=1\nB="old"\nC=3\n', 'B', 'new')).toBe(
      'A=1\nB="new"\nC=3\n'
    );
  });

  it('preserves every other line untouched', () => {
    const updated = upsertEnvValue(EXISTING, 'DASHBOARD_PASSWORD_HASH', 'scrypt$x');

    expect(updated).toContain('EBAY_CLIENT_SECRET="test-only"');
    expect(updated).toContain('EBAY_TOKEN_ENCRYPTION_KEY="v1:AAAA"');
    expect(updated).toContain('EBAY_CLIENT_ID=abc-123');
    expect(updated).toContain('# eBay API sync (read-only)');
  });

  it('does not touch a key that merely shares a prefix', () => {
    const updated = upsertEnvValue('AB=keep\n', 'A', 'new');
    expect(updated).toContain('AB=keep');
    expect(updated).toContain('A="new"');
  });

  it('does not treat a commented-out key as the real one', () => {
    const updated = upsertEnvValue('#B=commented\n', 'B', 'real');
    expect(updated).toContain('#B=commented');
    expect(updated).toContain('B="real"');
  });

  it('handles a value containing base64 padding and separators', () => {
    const value = 'scrypt$16384$8$1$c2FsdA==$aGFzaA==';
    const updated = upsertEnvValue('A=1\n', 'H', value);
    expect(updated).toContain(`H="${value}"`);
  });
});

describe('hasEnvValue', () => {
  it('is true for a set value', () => {
    expect(hasEnvValue('A="x"\n', 'A')).toBe(true);
  });

  it('is true for an unquoted value', () => {
    expect(hasEnvValue('A=x\n', 'A')).toBe(true);
  });

  it('is false for an empty value', () => {
    expect(hasEnvValue('A=\n', 'A')).toBe(false);
  });

  it('is false for an empty quoted value', () => {
    expect(hasEnvValue('A=""\n', 'A')).toBe(false);
  });

  it('is false for a whitespace-only value', () => {
    expect(hasEnvValue('A="   "\n', 'A')).toBe(false);
  });

  it('is false for an absent key', () => {
    expect(hasEnvValue('B=1\n', 'A')).toBe(false);
  });

  it('is false when the key appears only in a comment', () => {
    expect(hasEnvValue('#A=1\n', 'A')).toBe(false);
  });
});
