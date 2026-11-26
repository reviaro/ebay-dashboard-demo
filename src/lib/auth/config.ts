/**
 * Dashboard authentication configuration.
 *
 * Fails CLOSED. If `DASHBOARD_SESSION_SECRET` or `DASHBOARD_PASSWORD_HASH` is
 * missing or malformed this throws, and every caller -- the proxy included --
 * turns that into a denial. Auth is never silently disabled: a misconfigured
 * dashboard is an unreachable dashboard, not an open one.
 *
 * Edge-safe: no `node:crypto`, no `Buffer`. `src/proxy.ts` imports this.
 */

import { base64Decode, type Bytes } from './encoding';
import { parseScryptHash } from './password-hash';

export interface AuthConfig {
  /** HMAC key for session tokens. At least 32 bytes. */
  sessionSecret: Bytes;
  /** Encoded scrypt hash, already validated for shape. */
  passwordHash: string;
  sessionTtlSeconds: number;
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

export const SESSION_COOKIE_NAME = process.env.DASHBOARD_COOKIE_NAME || (process.env.EBAY_ENVIRONMENT === 'sandbox' ? 'dashboard_dev_session' : 'dashboard_session');

const MINIMUM_SECRET_BYTES = 32;
const DEFAULT_TTL_HOURS = 30 * 24;

type AuthEnv = Record<string, string | undefined>;

/**
 * Next.js inlines `process.env.X` into the Edge bundle only for *statically
 * written* references -- a dynamic `env[name]` lookup is NOT replaced and reads
 * back `undefined` in the proxy. Every variable is therefore spelled out here
 * rather than looked up by name.
 */
function processEnv(): AuthEnv {
  return {
    DASHBOARD_SESSION_SECRET: process.env.DASHBOARD_SESSION_SECRET,
    DASHBOARD_PASSWORD_HASH: process.env.DASHBOARD_PASSWORD_HASH,
    DASHBOARD_SESSION_TTL_HOURS: process.env.DASHBOARD_SESSION_TTL_HOURS,
  };
}

function parseTtlSeconds(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_TTL_HOURS * 3600;

  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new AuthConfigError(
      `DASHBOARD_SESSION_TTL_HOURS must be a positive whole number of hours, got "${value}".`
    );
  }

  return Number(value) * 3600;
}

export function loadAuthConfig(env: AuthEnv = processEnv()): AuthConfig {
  const missing = (
    ['DASHBOARD_SESSION_SECRET'] as const
  ).filter((key) => !env[key]?.trim());

  if (missing.length > 0) {
    throw new AuthConfigError(
      `Dashboard authentication is not configured: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} not set. ` +
        'Generate a session secret with: openssl rand -base64 32 ' +
        'and a password hash with: npm run auth:hash. ' +
        'Access is denied until both are present.'
    );
  }

  const rawSecret = env.DASHBOARD_SESSION_SECRET!.trim();
  let sessionSecret: Bytes;
  try {
    sessionSecret = base64Decode(rawSecret);
  } catch {
    throw new AuthConfigError(
      'DASHBOARD_SESSION_SECRET is not valid base64. Generate one with: openssl rand -base64 32'
    );
  }

  if (sessionSecret.length < MINIMUM_SECRET_BYTES) {
    throw new AuthConfigError(
      `DASHBOARD_SESSION_SECRET must decode to at least ${MINIMUM_SECRET_BYTES} bytes, got ${sessionSecret.length}. Generate one with: openssl rand -base64 32`
    );
  }

  const passwordHash = env.DASHBOARD_PASSWORD_HASH?.trim() ?? '';
  // Throws AuthConfigError-shaped guidance via password-hash's own message.
  if (passwordHash) parseScryptHash(passwordHash);

  return {
    sessionSecret,
    passwordHash,
    sessionTtlSeconds: parseTtlSeconds(env.DASHBOARD_SESSION_TTL_HOURS),
  };
}
