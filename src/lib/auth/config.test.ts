import { describe, expect, it } from 'vitest';
import { hashPassword } from './password';
import { AuthConfigError, loadAuthConfig } from './config';

const SECRET = Buffer.alloc(32, 7).toString('base64');
const HASH = hashPassword('correct horse battery staple');

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    DASHBOARD_SESSION_SECRET: SECRET,
    DASHBOARD_PASSWORD_HASH: HASH,
    ...overrides,
  };
}

describe('loadAuthConfig', () => {
  it('returns a usable config when both secrets are present', () => {
    const config = loadAuthConfig(env());

    expect(config.sessionSecret).toHaveLength(32);
    expect(config.passwordHash).toBe(HASH);
    expect(config.sessionTtlSeconds).toBe(30 * 24 * 3600);
  });

  it('fails closed when the session secret is missing', () => {
    expect(() =>
      loadAuthConfig(env({ DASHBOARD_SESSION_SECRET: undefined }))
    ).toThrow(AuthConfigError);
  });

  it('allows DB-backed user authentication without a bootstrap password', () => {
    expect(loadAuthConfig(env({ DASHBOARD_PASSWORD_HASH: undefined })).passwordHash).toBe('');
  });

  it('treats a blank value as missing', () => {
    expect(() =>
      loadAuthConfig(env({ DASHBOARD_SESSION_SECRET: '   ' }))
    ).toThrow(/DASHBOARD_SESSION_SECRET/);
  });

  it('names every missing variable in one message', () => {
    expect(() =>
      loadAuthConfig({
        DASHBOARD_SESSION_SECRET: undefined,
        DASHBOARD_PASSWORD_HASH: undefined,
      })
    ).toThrow(/DASHBOARD_SESSION_SECRET/);
  });

  it('tells the operator how to generate a missing secret', () => {
    expect(() =>
      loadAuthConfig(env({ DASHBOARD_SESSION_SECRET: undefined }))
    ).toThrow(/openssl rand -base64 32/);
  });

  it('rejects a session secret shorter than 32 bytes', () => {
    expect(() =>
      loadAuthConfig(
        env({ DASHBOARD_SESSION_SECRET: Buffer.alloc(16, 1).toString('base64') })
      )
    ).toThrow(/32 bytes/);
  });

  it('rejects a session secret that is not base64', () => {
    expect(() =>
      loadAuthConfig(env({ DASHBOARD_SESSION_SECRET: 'not base64 at all!' }))
    ).toThrow(/base64/i);
  });

  it('rejects a malformed password hash', () => {
    expect(() =>
      loadAuthConfig(env({ DASHBOARD_PASSWORD_HASH: 'plaintext-password' }))
    ).toThrow(/DASHBOARD_PASSWORD_HASH/);
  });

  it('honours a custom session TTL', () => {
    const config = loadAuthConfig(env({ DASHBOARD_SESSION_TTL_HOURS: '12' }));
    expect(config.sessionTtlSeconds).toBe(12 * 3600);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-5'],
    ['non-numeric', 'forever'],
  ])('rejects a %s session TTL', (_label, value) => {
    expect(() =>
      loadAuthConfig(env({ DASHBOARD_SESSION_TTL_HOURS: value }))
    ).toThrow(/DASHBOARD_SESSION_TTL_HOURS/);
  });
});
