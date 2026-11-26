import { describe, expect, it } from 'vitest';
import { hashPassword } from './password';
import { AuthConfigError, loadAuthConfig, SESSION_COOKIE_NAME } from './config';
import { buildSessionPayload, signSession } from './session';
import { authenticateRequest, readSessionCookie } from './guard';

const CONFIG = loadAuthConfig({
  DASHBOARD_SESSION_SECRET: Buffer.alloc(32, 7).toString('base64'),
  DASHBOARD_PASSWORD_HASH: hashPassword('correct horse battery staple'),
});

function requestWithCookie(cookie?: string) {
  return new Request('http://192.0.2.10:3939/settings', {
    headers: cookie ? { cookie } : {},
  });
}

describe('readSessionCookie', () => {
  it('reads the session cookie value', () => {
    expect(
      readSessionCookie(requestWithCookie(`${SESSION_COOKIE_NAME}=abc.def`))
    ).toBe('abc.def');
  });

  it('finds it among other cookies', () => {
    expect(
      readSessionCookie(
        requestWithCookie(`theme=dark; ${SESSION_COOKIE_NAME}=abc.def; tz=UTC`)
      )
    ).toBe('abc.def');
  });

  it('returns null when there is no cookie header at all', () => {
    expect(readSessionCookie(requestWithCookie())).toBeNull();
  });

  it('returns null when the session cookie is absent', () => {
    expect(readSessionCookie(requestWithCookie('theme=dark'))).toBeNull();
  });

  it('does not match a cookie whose name merely ends with the session name', () => {
    expect(
      readSessionCookie(requestWithCookie(`not_${SESSION_COOKIE_NAME}=abc.def`))
    ).toBeNull();
  });

  it('returns null for a present but empty cookie', () => {
    expect(readSessionCookie(requestWithCookie(`${SESSION_COOKIE_NAME}=`))).toBeNull();
  });
});

describe('authenticateRequest', () => {
  it('accepts a valid session', async () => {
    const token = await signSession(
      CONFIG.sessionSecret,
      buildSessionPayload('operator', 3600)
    );

    const result = await authenticateRequest(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      () => CONFIG
    );

    expect(result.status).toBe('ok');
  });

  it('rejects a request with no session cookie', async () => {
    const result = await authenticateRequest(requestWithCookie(), () => CONFIG);
    expect(result.status).toBe('unauthenticated');
  });

  it('rejects an expired session', async () => {
    const token = await signSession(
      CONFIG.sessionSecret,
      buildSessionPayload('operator', 3600, 1000)
    );

    const result = await authenticateRequest(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      () => CONFIG
    );

    expect(result.status).toBe('unauthenticated');
  });

  it('rejects a session signed with a different secret', async () => {
    const token = await signSession(
      new Uint8Array(32).fill(9),
      buildSessionPayload('operator', 3600)
    );

    const result = await authenticateRequest(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      () => CONFIG
    );

    expect(result.status).toBe('unauthenticated');
  });

  it('reports misconfiguration distinctly, and does NOT let the request through', async () => {
    const result = await authenticateRequest(requestWithCookie(), () => {
      throw new AuthConfigError('DASHBOARD_SESSION_SECRET is not set.');
    });

    expect(result.status).toBe('misconfigured');
    // The whole point of failing closed: a config fault must never read as ok.
    expect(result.status).not.toBe('ok');
  });

  it('reports misconfiguration even when a well-formed cookie is presented', async () => {
    const token = await signSession(
      CONFIG.sessionSecret,
      buildSessionPayload('operator', 3600)
    );

    const result = await authenticateRequest(
      requestWithCookie(`${SESSION_COOKIE_NAME}=${token}`),
      () => {
        throw new AuthConfigError('DASHBOARD_PASSWORD_HASH is not set.');
      }
    );

    expect(result.status).toBe('misconfigured');
  });
});
