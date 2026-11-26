/**
 * Post-login redirect validation.
 *
 * The login page carries the originally requested path in `?next=`. Echoing an
 * attacker-supplied value straight into a redirect would turn the login page
 * into an open redirect, so only same-origin *paths* are accepted -- never
 * anything that could resolve to another host or scheme.
 */

export const LOGIN_PATH = '/login';
export const DEFAULT_REDIRECT = '/';

export function safeRedirectPath(
  requested: string | null | undefined
): string {
  if (!requested) return DEFAULT_REDIRECT;

  // Must be a rooted path. Rejects "evil.test", "javascript:", "data:".
  if (!requested.startsWith('/')) return DEFAULT_REDIRECT;

  // "//host" and "/\host" are protocol-relative; browsers treat both as
  // cross-origin despite the leading slash.
  if (requested.startsWith('//') || requested.startsWith('/\\')) {
    return DEFAULT_REDIRECT;
  }

  // Control characters (including the tab/newline browsers strip before
  // parsing, and anything that could smuggle a header) disqualify the value.
  if (/[\u0000-\u001f\u007f]/.test(requested)) return DEFAULT_REDIRECT;

  let decoded: string;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return DEFAULT_REDIRECT;
  }
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return DEFAULT_REDIRECT;
  if (decoded.startsWith('//') || decoded.startsWith('/\\')) {
    return DEFAULT_REDIRECT;
  }

  // Bouncing back to /login would loop the operator straight back here.
  const path = requested.split('?')[0];
  if (path === LOGIN_PATH) return DEFAULT_REDIRECT;

  return requested;
}
