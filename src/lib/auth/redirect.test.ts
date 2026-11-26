import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './redirect';

describe('safeRedirectPath', () => {
  it('keeps an ordinary in-app path', () => {
    expect(safeRedirectPath('/traffic')).toBe('/traffic');
  });

  it('keeps a path with a query string', () => {
    expect(safeRedirectPath('/traffic?range=30')).toBe('/traffic?range=30');
  });

  it('falls back to the dashboard root when absent', () => {
    expect(safeRedirectPath(null)).toBe('/');
    expect(safeRedirectPath(undefined)).toBe('/');
    expect(safeRedirectPath('')).toBe('/');
  });

  it.each([
    ['an absolute http URL', 'http://evil.test/steal'],
    ['an absolute https URL', 'https://evil.test/steal'],
    ['a protocol-relative URL', '//evil.test/steal'],
    ['a backslash-obscured protocol-relative URL', '/\\evil.test'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>'],
    ['a bare hostname', 'evil.test'],
  ])('refuses %s', (_label, value) => {
    expect(safeRedirectPath(value)).toBe('/');
  });

  it('refuses a value that escapes via encoded characters', () => {
    expect(safeRedirectPath('/%09/evil.test')).toBe('/');
  });

  it('refuses a newline-smuggled value', () => {
    expect(safeRedirectPath('/traffic\nSet-Cookie: x=1')).toBe('/');
  });

  it('never returns the login page itself, to avoid a redirect loop', () => {
    expect(safeRedirectPath('/login')).toBe('/');
    expect(safeRedirectPath('/login?next=/traffic')).toBe('/');
  });
});
