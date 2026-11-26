/**
 * Typed eBay errors and retry classification.
 *
 * Every message and detail payload passes through `redact` on the way in, so an
 * error cannot carry a token into a log line, a UI surface, or a test snapshot
 * (plan §7.8). Callers therefore never need to remember to sanitize.
 */

import { redact, redactString } from './redact';

/** eBay's error envelope: { errors: [{ errorId, message, longMessage, ... }] }. */
interface EbayErrorEnvelope {
  errors?: Array<{
    errorId?: number;
    domain?: string;
    category?: string;
    message?: string;
    longMessage?: string;
  }>;
  /** OAuth endpoints use the RFC 6749 shape instead. */
  error?: string;
  error_description?: string;
}

export class EbayApiError extends Error {
  readonly status: number;
  readonly errorId?: number;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    errorId?: number,
    details?: unknown
  ) {
    super(redactString(message));
    this.name = 'EbayApiError';
    this.status = status;
    this.errorId = errorId;
    this.details = details === undefined ? undefined : redact(details);
  }
}

export class EbayAuthError extends EbayApiError {
  /**
   * True when the refresh token itself is dead (revoked, expired, invalid
   * grant) and only a human re-consenting can fix it. False for an ordinary
   * expired access token, which a refresh resolves.
   */
  readonly requiresReauthorization: boolean;

  constructor(
    message: string,
    status: number,
    errorId: number | undefined,
    requiresReauthorization: boolean,
    details?: unknown
  ) {
    super(message, status, errorId, details);
    this.name = 'EbayAuthError';
    this.requiresReauthorization = requiresReauthorization;
  }
}

export class EbayRateLimitError extends EbayApiError {
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    status: number,
    errorId: number | undefined,
    retryAfterMs?: number,
    details?: unknown
  ) {
    super(message, status, errorId, details);
    this.name = 'EbayRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** OAuth `error` codes that mean the grant is gone for good. */
const DEAD_GRANT_CODES = new Set([
  'invalid_grant',
  'unauthorized_client',
  'access_denied',
  'consent_required',
]);

function parseRetryAfter(headers?: Record<string, string>): number | undefined {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  // Retry-After may also be an HTTP date.
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/**
 * Converts an eBay HTTP failure into a typed error.
 *
 * Tolerates a malformed, HTML, or null body: an error while handling an error
 * would mask the original failure.
 */
export function parseEbayError(
  status: number,
  body: unknown,
  headers?: Record<string, string>
): EbayApiError {
  const envelope: EbayErrorEnvelope =
    body && typeof body === 'object' ? (body as EbayErrorEnvelope) : {};

  const first = envelope.errors?.[0];
  const errorId = first?.errorId;
  const message =
    first?.longMessage ||
    first?.message ||
    envelope.error_description ||
    envelope.error ||
    (typeof body === 'string' && body.trim()
      ? body.trim().slice(0, 200)
      : `eBay request failed with status ${status}`);

  if (status === 429) {
    return new EbayRateLimitError(
      message,
      status,
      errorId,
      parseRetryAfter(headers),
      body
    );
  }

  const oauthCode = envelope.error;
  const deadGrant = oauthCode ? DEAD_GRANT_CODES.has(oauthCode) : false;

  if (status === 401 || status === 403 || deadGrant) {
    // A 401 usually just means the access token aged out, which one refresh
    // fixes. A 403 means the token lacks the required scope -- a refresh
    // returns the same scopes, so only re-consenting with wider scopes helps.
    // A dead grant code means the refresh token itself is gone.
    const needsReauth = deadGrant || status === 403;
    return new EbayAuthError(message, status, errorId, needsReauth, body);
  }

  return new EbayApiError(message, status, errorId, body);
}

export interface RetryDecision {
  retryable: boolean;
  retryAfterMs?: number;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Decides whether an error is worth another attempt.
 *
 * Deliberately conservative: validation and permission failures are never
 * retried, because repeating them just burns rate-limit budget.
 */
export function classifyRetry(error: unknown): RetryDecision {
  if (error instanceof EbayRateLimitError) {
    return { retryable: true, retryAfterMs: error.retryAfterMs };
  }

  if (error instanceof EbayAuthError) {
    // Worth exactly one refresh-and-retry unless the grant itself is dead.
    return { retryable: !error.requiresReauthorization };
  }

  if (error instanceof EbayApiError) {
    return { retryable: RETRYABLE_STATUS.has(error.status) };
  }

  if (hasRetryableNetworkCode(error)) {
    return { retryable: true };
  }

  return { retryable: false };
}

/**
 * Walks the `cause` chain looking for a transient network errno.
 *
 * Node's `fetch` rejects with `TypeError: fetch failed` and hangs the real
 * errno off `.cause` (sometimes nested another level). Inspecting only the
 * top-level error therefore classifies every DNS hiccup and dropped socket as
 * permanent, and the sync abandons a run it should simply retry.
 *
 * The depth cap and `seen` set guard against a self-referencing chain, which
 * would otherwise hang the worker.
 */
function hasRetryableNetworkCode(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current && !seen.has(current); depth++) {
    seen.add(current);

    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code)) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 60_000;

export interface BackoffOptions {
  /** Server-supplied delay, which always wins over the computed value. */
  retryAfterMs?: number;
  /** Disable randomization for deterministic tests. */
  jitter?: boolean;
}

/**
 * Exponential backoff with full jitter, capped so one slow domain cannot stall
 * a scheduler tick indefinitely. Full jitter (rather than fixed backoff) keeps
 * concurrent domain workers from retrying in lockstep after a shared outage.
 */
export function backoffDelayMs(
  attempt: number,
  options: BackoffOptions = {}
): number {
  const { retryAfterMs, jitter = true } = options;

  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, MAX_DELAY_MS);
  }

  const exponential = Math.min(
    BASE_DELAY_MS * 2 ** Math.max(0, attempt),
    MAX_DELAY_MS
  );

  return jitter ? Math.floor(Math.random() * exponential) : exponential;
}
