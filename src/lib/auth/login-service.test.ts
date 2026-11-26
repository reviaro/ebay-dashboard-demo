import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from './password';
import { AuthConfigError, loadAuthConfig } from './config';
import { verifySession, signSession, buildSessionPayload } from './session';
import { LoginRateLimiter, LoginWorkLimiter } from './rate-limit';
import { attemptLogin } from './login-service';

const PASSWORD = 'correct horse battery staple';
const CONFIG = loadAuthConfig({
  DASHBOARD_SESSION_SECRET: Buffer.alloc(32, 5).toString('base64'),
  DASHBOARD_PASSWORD_HASH: hashPassword(PASSWORD),
});

let limiter: LoginRateLimiter;
let workLimiter: LoginWorkLimiter;
const CLIENT = 'test-client-a';

beforeEach(() => {
  limiter = new LoginRateLimiter({ maxAttempts: 3, lockoutSeconds: 600 });
  workLimiter = new LoginWorkLimiter();
});

function deps(overrides: Partial<Parameters<typeof attemptLogin>[2]> = {}) {
  return { loadConfig: () => CONFIG, limiter, workLimiter, findUser: async () => ({ id: 'user-1', passwordHash: CONFIG.passwordHash, disabledAt: null }), createSession: async (id: string) => signSession(CONFIG.sessionSecret, { ...buildSessionPayload(id, CONFIG.sessionTtlSeconds), sid: 'session-1' }), ...overrides };
}

function login(body: unknown, dependencies = deps()) {
  return attemptLogin({ username: 'owner', ...(body as object) }, CLIENT, dependencies);
}

describe('attemptLogin', () => {
  it('issues a verifiable session token for the correct password', async () => {
    const outcome = await login({ password: PASSWORD }, deps());

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') throw new Error('unreachable');

    await expect(
      verifySession(CONFIG.sessionSecret, outcome.token)
    ).resolves.toMatchObject({ sub: 'user-1', sid: 'session-1' });
  });

  it('reports the session lifetime so the cookie can match it', async () => {
    const outcome = await login({ password: PASSWORD }, deps());
    expect(outcome).toMatchObject({ ttlSeconds: CONFIG.sessionTtlSeconds });
  });

  it('rejects the wrong password', async () => {
    const outcome = await login({ password: 'wrong password!!' }, deps());
    expect(outcome.status).toBe('invalid_credentials');
  });

  it('locks out after repeated wrong passwords', async () => {
    for (let i = 0; i < 3; i++) {
      await login({ password: 'wrong password!!' }, deps());
    }

    const outcome = await login({ password: 'wrong password!!' }, deps());
    expect(outcome.status).toBe('rate_limited');
  });

  it('refuses even the CORRECT password while locked out', async () => {
    for (let i = 0; i < 3; i++) {
      await login({ password: 'wrong password!!' }, deps());
    }

    const outcome = await login({ password: PASSWORD }, deps());
    expect(outcome.status).toBe('rate_limited');
  });

  it('reports how long the lockout lasts', async () => {
    for (let i = 0; i < 3; i++) {
      await login({ password: 'wrong password!!' }, deps());
    }

    const outcome = await login({ password: PASSWORD }, deps());
    if (outcome.status !== 'rate_limited') throw new Error('expected lockout');
    expect(outcome.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('clears the failure count after a successful login', async () => {
    await login({ password: 'wrong password!!' }, deps());
    await login({ password: 'wrong password!!' }, deps());
    await login({ password: PASSWORD }, deps());

    // Without the reset, two more failures would trip the 3-attempt limit.
    await login({ password: 'wrong password!!' }, deps());
    const outcome = await login({ password: PASSWORD }, deps());

    expect(outcome.status).toBe('ok');
  });

  it.each([
    ['a missing password', {}],
    ['a non-string password', { password: 12345 }],
    ['an empty password', { password: '' }],
    ['an oversized password', { password: 'a'.repeat(1025) }],
    ['an oversized Unicode password', { password: '🐈'.repeat(257) }],
  ])('rejects %s as a bad request', async (_label, body) => {
    const outcome = await login(body, deps());
    expect(outcome.status).toBe('bad_request');
  });

  it('does not count a malformed request against the lockout', async () => {
    for (let i = 0; i < 5; i++) await login({}, deps());

    const outcome = await login({ password: PASSWORD }, deps());
    expect(outcome.status).toBe('ok');
  });

  it('sanitizes the post-login redirect target', async () => {
    const outcome = await login(
      { password: PASSWORD, next: 'https://evil.test/steal' },
      deps()
    );

    expect(outcome).toMatchObject({ redirectTo: '/' });
  });

  it('preserves a legitimate redirect target', async () => {
    const outcome = await login(
      { password: PASSWORD, next: '/traffic?range=30' },
      deps()
    );

    expect(outcome).toMatchObject({ redirectTo: '/traffic?range=30' });
  });

  it('reports misconfiguration rather than denying as a bad password', async () => {
    const outcome = await login(
      { password: PASSWORD },
      deps({
        loadConfig: () => {
          throw new AuthConfigError('DASHBOARD_SESSION_SECRET is not set.');
        },
      })
    );

    expect(outcome.status).toBe('misconfigured');
  });
});


describe('client isolation and work budget', () => {
  it('one client cannot lock out another or clear their failures by signing in', async () => {
    for (let index = 0; index < 3; index++) {
      await attemptLogin({ username: 'owner', password: 'incorrect' }, CLIENT, deps());
    }
    expect((await attemptLogin({ username: 'owner', password: PASSWORD }, 'test-client-b', deps())).status).toBe('ok');
    expect((await attemptLogin({ username: 'owner', password: PASSWORD }, CLIENT, deps())).status).toBe('rate_limited');
  });

  it('never falls back to a shared client bucket', async () => {
    expect((await attemptLogin({ username: 'owner', password: PASSWORD }, '', deps())).status).toBe('misconfigured');
  });

  it('rejects password verification when the work budget is exhausted', async () => {
    const exhausted = new LoginWorkLimiter(1, 5);
    exhausted.take();
    const outcome = await attemptLogin({ username: 'owner', password: PASSWORD }, CLIENT, deps({ workLimiter: exhausted }));
    expect(outcome.status).toBe('rate_limited');
    expect(limiter.size).toBe(0);
  });

  it('does not consume the shared work budget for a locked client', async () => {
    const budget = new LoginWorkLimiter(1, 5);
    for (let index = 0; index < 3; index++) limiter.recordFailure(CLIENT);
    expect((await attemptLogin({ username: 'owner', password: PASSWORD }, CLIENT, deps({ workLimiter: budget }))).status).toBe('rate_limited');
    expect((await attemptLogin({ username: 'owner', password: PASSWORD }, 'test-client-b', deps({ workLimiter: budget }))).status).toBe('ok');
  });
});
