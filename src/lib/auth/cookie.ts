/**
 * Session cookie policy.
 *
 * Deployments may expose HTTPS through a trusted reverse proxy or use direct
 * HTTP for local development. Decide Secure per request so HTTPS cookies stay
 * protected without creating a silent login loop on local HTTP origins.
 *
 * A reverse proxy should set X-Forwarded-Proto from the original connection.
 * A forged value on direct HTTP can only add Secure and prevent that browser
 * from returning the cookie; it cannot remove Secure from a trusted HTTPS hop.
 */

import { SESSION_COOKIE_NAME } from './config';

export interface CookieOptions {
  name: string;
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) {
    // Proxies append rather than replace: "https, http" means the client hop
    // was https, which is the one that matters for the browser's cookie rules.
    return forwarded.split(',')[0].trim().toLowerCase() === 'https';
  }

  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function sessionCookieOptions(options: {
  secure: boolean;
  ttlSeconds: number;
}): CookieOptions {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    // Lax keeps the cookie off cross-site POSTs while still surviving a normal
    // top-level navigation into the dashboard.
    sameSite: 'lax',
    path: '/',
    secure: options.secure,
    maxAge: options.ttlSeconds,
  };
}

export function clearedCookieOptions(options: { secure: boolean }): CookieOptions {
  return { ...sessionCookieOptions({ ...options, ttlSeconds: 0 }), maxAge: 0 };
}
