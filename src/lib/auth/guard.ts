/**
 * The single place a request is judged authenticated or not.
 *
 * Deliberately framework-free and Edge-safe so the *same* code decides for
 * `src/proxy.ts` and for individual route handlers. The proxy is a
 * convenience gate, not the security boundary -- sensitive routes call this
 * themselves so that a matcher mistake or a proxy bypass cannot expose
 * them.
 */

import { loadAuthConfig, SESSION_COOKIE_NAME, type AuthConfig } from './config';
import { SessionError, verifySession, type SessionPayload } from './session';

export type AuthResult =
  | { status: 'ok'; session: SessionPayload }
  | { status: 'unauthenticated'; reason: string }
  | { status: 'misconfigured'; reason: string };

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    // Exact name match: `not_dashboard_session=` must not satisfy the check.
    if (part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;

    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }

  return null;
}

/**
 * `loadConfig` is injectable so the misconfigured branch is testable without
 * mutating `process.env`.
 */
export async function authenticateRequest(
  request: Request,
  loadConfig: () => AuthConfig = loadAuthConfig
): Promise<AuthResult> {
  let config: AuthConfig;
  try {
    config = loadConfig();
  } catch (error) {
    // Checked BEFORE the cookie, so a broken config can never be mistaken for
    // a valid session.
    return {
      status: 'misconfigured',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const token = readSessionCookie(request);
  if (!token) {
    return { status: 'unauthenticated', reason: 'No session cookie.' };
  }

  try {
    return {
      status: 'ok',
      session: await verifySession(config.sessionSecret, token),
    };
  } catch (error) {
    if (error instanceof SessionError) {
      return { status: 'unauthenticated', reason: error.message };
    }
    throw error;
  }
}
