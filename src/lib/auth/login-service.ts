/**
 * Password check, throttling, and session minting.
 *
 * Kept out of the route handler so every branch -- lockout, misconfiguration,
 * malformed body -- is testable without HTTP plumbing.
 *
 * Node-only: `verifyPassword` uses scrypt.
 */

import { isValidUsername, normalizeUsername } from './username';
import { loadAuthConfig, type AuthConfig } from './config';
import { MAXIMUM_PASSWORD_BYTES, verifyPassword, hashPassword } from './password';
import { randomBytes } from 'node:crypto';
import { safeRedirectPath } from './redirect';
import { adminDb } from '../prisma';
import { createUserSession } from './user-session';
import {
  loginRateLimiter, loginWorkLimiter,
  type LoginRateLimiter, type LoginWorkLimiter,
} from './rate-limit';

export type LoginOutcome =
  | { status: 'ok'; token: string; ttlSeconds: number; redirectTo: string }
  | { status: 'invalid_credentials' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'bad_request'; reason: string }
  | { status: 'misconfigured'; reason: string };

export interface LoginDeps {
  loadConfig: () => AuthConfig;
  limiter: LoginRateLimiter;
  workLimiter: LoginWorkLimiter;
  findUser: (username: string) => Promise<{ id: string; passwordHash: string | null; disabledAt: Date | null } | null>;
  createSession: (userId: string, config: AuthConfig) => Promise<string>;
}

let decoyHash: string | undefined;

export async function attemptLogin(
  body: unknown,
  clientKey: string,
  deps: LoginDeps = {
    loadConfig: loadAuthConfig, limiter: loginRateLimiter, workLimiter: loginWorkLimiter,
    findUser: (username) => adminDb.user.findUnique({ where: { username } }),
    createSession: createUserSession,
  }
): Promise<LoginOutcome> {
  const password = (body as { password?: unknown } | null)?.password;
  const next = (body as { next?: unknown } | null)?.next;
  const rawUsername = (body as { username?: unknown } | null)?.username;
  const username = normalizeUsername(rawUsername);
  if (!isValidUsername(username)) {
    return { status: 'bad_request', reason: 'Enter your username.' };
  }

  // Shape errors are checked first and never counted against the lockout, so a
  // buggy client cannot lock the operator out of their own dashboard.
  if (typeof password !== 'string' || password.length === 0 || Buffer.byteLength(password, 'utf8') > MAXIMUM_PASSWORD_BYTES) {
    return { status: 'bad_request', reason: `A password of at most ${MAXIMUM_PASSWORD_BYTES} bytes is required.` };
  }

  if (!clientKey) {
    return { status: 'misconfigured', reason: 'Login client identity is unavailable.' };
  }

  let config: AuthConfig;
  try {
    config = deps.loadConfig();
  } catch (error) {
    return {
      status: 'misconfigured',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  // Checked before the password so a locked-out caller costs no scrypt work --
  // otherwise the throttle would double as a CPU amplification vector.
  const decision = deps.limiter.check(clientKey);
  if (!decision.allowed) {
    return {
      status: 'rate_limited',
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  }

  const work = deps.workLimiter.take();
  if (!work.allowed) return { status: 'rate_limited', retryAfterSeconds: work.retryAfterSeconds };

  const user = await deps.findUser(username);
  // Use the bootstrap hash for a comparable amount of work for unknown users.
  const hash = user?.passwordHash || config.passwordHash || (decoyHash ??= hashPassword(randomBytes(32).toString('hex')));
  const matches = verifyPassword(password, hash);
  if (!user || user.disabledAt || !user.passwordHash || !matches) {
    deps.limiter.recordFailure(clientKey);
    return { status: 'invalid_credentials' };
  }

  deps.limiter.recordSuccess(clientKey);

  return {
    status: 'ok',
    token: await deps.createSession(user.id, config),
    ttlSeconds: config.sessionTtlSeconds,
    redirectTo: safeRedirectPath(typeof next === 'string' ? next : null),
  };
}
