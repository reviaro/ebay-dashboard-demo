import { describe, expect, it } from 'vitest';
import { isValidUsername, normalizeUsername } from './username';

describe('usernames', () => {
  it('normalizes case and whitespace, and rejects non-strings', () => {
    expect(normalizeUsername('  Owner ')).toBe('owner');
    expect(normalizeUsername(42)).toBe('');
  });

  it('accepts 2-64 characters starting with a letter or digit', () => {
    for (const name of ['owner', 'a1', 'jo.smith', 'part-lister_2', 'a'.repeat(64)]) expect(isValidUsername(name)).toBe(true);
    for (const name of ['', 'a', '.owner', '-owner', 'Owner', 'jo smith', 'jo@x', 'a'.repeat(65)]) expect(isValidUsername(name)).toBe(false);
  });
});
