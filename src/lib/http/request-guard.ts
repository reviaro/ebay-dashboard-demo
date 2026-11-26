/**
 * Origin verification for state-changing endpoints.
 *
 * Cross-site request forgery defence: without it, any page the operator visits
 * could POST to `https://dashboard.example/api/ebay/disconnect` from their browser and
 * have it succeed, because the browser attaches the session cookie
 * automatically.
 *
 * This complements authentication rather than replacing it. Auth answers "who
 * is this?"; this answers "did they mean to send it?". The session cookie is
 * `SameSite=Lax`, which already blocks cross-site POSTs in current browsers --
 * this is the belt to that suspenders, and it also covers the window before a
 * session exists at all (the login endpoint itself).
 *
 * Plan §7.10. Lives outside `lib/ebay` because the auth routes rely on it too.
 */

import { redactString } from '../ebay/redact';

export class RequestOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestOriginError';
  }
}

/**
 * Throws unless the request demonstrably came from this same origin.
 *
 * Fails closed: a request carrying neither `Origin` nor `Sec-Fetch-Site` is
 * rejected rather than assumed safe.
 */
export function verifySameOrigin(headers: Headers): void {
  // Behind a proxy the Host header is the internal address; the forwarded host
  // is what the browser actually saw and what Origin will match.
  const host =
    headers.get('x-forwarded-host')?.trim() || headers.get('host')?.trim();

  if (!host) {
    throw new RequestOriginError('Refusing request: no Host header.');
  }

  const origin = headers.get('origin');
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new RequestOriginError(
        `Refusing request: unparseable Origin ${redactString(origin)}.`
      );
    }

    // Exact host comparison, including port: `localhost:3000` and
    // `localhost:3939` are different origins, and `localhost:3939.evil.test`
    // must not pass a prefix check.
    if (originHost !== host) {
      throw new RequestOriginError(
        `Refusing cross-origin request from ${redactString(originHost)}.`
      );
    }
    return;
  }

  // Same-origin fetches and form posts may omit Origin; browsers still send
  // Sec-Fetch-Site, which cannot be forged by page script.
  // A sibling subdomain is same-site but is not the same trusted application.
  const site = headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') {
    return;
  }

  throw new RequestOriginError(
    'Refusing request: no Origin header and not a same-origin fetch.'
  );
}
