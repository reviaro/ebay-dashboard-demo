/**
 * Secret scrubbing for every eBay error, log, and API response path.
 *
 * Plan §7.8: Authorization headers, client secrets, authorization codes, and
 * access/refresh tokens must never reach a log line, a UI surface, or a test
 * snapshot. Redaction is applied at the boundary, so callers cannot forget it.
 */

export const REDACTED = '[REDACTED]';

/** Object keys whose values are always secret, matched case-insensitively. */
const SENSITIVE_KEY = /(?:^|_|-)(?:code)$|secret|token|password|passwd|authorization|auth[_-]?tag|credential|api[_-]?key|private[_-]?key/i;

const STRING_PATTERNS: Array<[RegExp, string]> = [
  // eBay OAuth tokens are self-describing: v^1.1#i^1#f^0#...
  [/v\^\d[\d.]*#[^\s'"<>]*/g, REDACTED],
  // eBay application cert IDs (client secrets): PRD-<hex>-<hex>-<hex>-<hex>,
  // SBX-... in sandbox. These leak into free-text auth errors far more often
  // than into a field actually named client_secret.
  [/\b(?:PRD|SBX)-[0-9a-f]{6,}(?:-[0-9a-f]{4}){3}\b/gi, REDACTED],
  // Authorization header values.
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`],
  [/\bBasic\s+[A-Za-z0-9+/]+=*/gi, `Basic ${REDACTED}`],
  // Secrets carried as query/form parameters. Ordered longest-first so that
  // `refresh_token=` is never partially matched by `token=`.
  [
    /\b(access_token|refresh_token|client_secret|authorization|code|token)=[^&\s'"]*/gi,
    `$1=${REDACTED}`,
  ],
];

/** Scrubs secrets that appear inside a free-text string. */
export function redactString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of STRING_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Deep-scrubs an arbitrary value into something safe to log or serialize.
 *
 * Sensitive keys are replaced wholesale; every surviving string is still run
 * through the pattern scrubber, because secrets leak into innocuous fields like
 * `message` far more often than into fields named `token`.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.stack ? { stack: redactString(value.stack) } : {}),
    };
  }

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const obj = value as object;
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);

    if (Array.isArray(value)) {
      return value.map((entry) => redact(entry, seen));
    }

    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(entry, seen);
    }
    return out;
  }

  return String(value);
}
