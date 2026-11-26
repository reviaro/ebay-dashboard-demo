import { describe, it, expect } from 'vitest';
import {
  EbayApiError,
  EbayAuthError,
  EbayRateLimitError,
  parseEbayError,
  classifyRetry,
  backoffDelayMs,
} from './errors';

// Shape of a real eBay error envelope.
const envelope = (errorId: number, message: string, longMessage?: string) => ({
  errors: [
    {
      errorId,
      domain: 'API_FULFILLMENT',
      category: 'REQUEST',
      message,
      ...(longMessage ? { longMessage } : {}),
    },
  ],
});

describe('parseEbayError', () => {
  it('extracts the eBay errorId and message from the envelope', () => {
    const err = parseEbayError(400, envelope(2003, 'Invalid date range'));
    expect(err).toBeInstanceOf(EbayApiError);
    expect(err.status).toBe(400);
    expect(err.errorId).toBe(2003);
    expect(err.message).toContain('Invalid date range');
  });

  it('returns an auth error for 401 so the caller can refresh', () => {
    const err = parseEbayError(401, envelope(1001, 'Invalid access token'));
    expect(err).toBeInstanceOf(EbayAuthError);
    expect((err as EbayAuthError).requiresReauthorization).toBe(false);
  });

  it('flags invalid_grant as needing full reauthorization, not a refresh', () => {
    const err = parseEbayError(400, {
      error: 'invalid_grant',
      error_description: 'the provided authorization grant is invalid',
    });
    expect(err).toBeInstanceOf(EbayAuthError);
    expect((err as EbayAuthError).requiresReauthorization).toBe(true);
  });

  it('returns a rate-limit error for 429 carrying Retry-After seconds', () => {
    const err = parseEbayError(429, envelope(2001, 'Too many requests'), {
      'retry-after': '30',
    });
    expect(err).toBeInstanceOf(EbayRateLimitError);
    expect((err as EbayRateLimitError).retryAfterMs).toBe(30_000);
  });

  it('tolerates a 429 with no Retry-After header', () => {
    const err = parseEbayError(429, envelope(2001, 'Too many requests'));
    expect(err).toBeInstanceOf(EbayRateLimitError);
    expect((err as EbayRateLimitError).retryAfterMs).toBeUndefined();
  });

  it('survives a malformed body instead of throwing while handling an error', () => {
    const err = parseEbayError(500, '<html>gateway timeout</html>');
    expect(err).toBeInstanceOf(EbayApiError);
    expect(err.status).toBe(500);
  });

  it('survives a null body', () => {
    expect(parseEbayError(503, null).status).toBe(503);
  });

  it('redacts a token that leaked into the eBay error message', () => {
    const err = parseEbayError(
      401,
      envelope(1001, 'Invalid access token v^1.1#i^1#f^0#t^Ul4xMF8x')
    );
    expect(err.message).not.toContain('Ul4xMF8x');
    expect(err.message).toContain('[REDACTED]');
  });

  it('redacts secrets in the sanitized detail payload', () => {
    const err = parseEbayError(400, {
      error: 'invalid_client',
      error_description: 'bad secret PRD-a1b2c3d4e5f6-1a2b-3c4d-5e6f',
    });
    expect(JSON.stringify(err.details)).not.toContain('a1b2c3d4e5f6');
  });
});

describe('classifyRetry', () => {
  it('retries a rate-limit error and honors its Retry-After', () => {
    const decision = classifyRetry(
      new EbayRateLimitError('slow down', 429, undefined, 30_000)
    );
    expect(decision.retryable).toBe(true);
    expect(decision.retryAfterMs).toBe(30_000);
  });

  it('retries transient 5xx responses', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyRetry(new EbayApiError('boom', status)).retryable).toBe(true);
    }
  });

  it('does not retry validation or permission failures', () => {
    for (const status of [400, 403, 404, 409, 422]) {
      expect(classifyRetry(new EbayApiError('nope', status)).retryable).toBe(false);
    }
  });

  it('retries a 401 once, because a token refresh may fix it', () => {
    const decision = classifyRetry(new EbayAuthError('expired', 401, undefined, false));
    expect(decision.retryable).toBe(true);
  });

  it('does not retry when the grant is dead and a human must reauthorize', () => {
    const decision = classifyRetry(new EbayAuthError('revoked', 400, undefined, true));
    expect(decision.retryable).toBe(false);
  });

  it('retries network faults that never reached eBay', () => {
    const netErr = Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
    expect(classifyRetry(netErr).retryable).toBe(true);
  });

  it('does not retry an unrecognized programming error', () => {
    expect(classifyRetry(new TypeError('x is not a function')).retryable).toBe(false);
  });
});

describe('backoffDelayMs', () => {
  it('grows exponentially across attempts', () => {
    const base = backoffDelayMs(0, { jitter: false });
    expect(backoffDelayMs(1, { jitter: false })).toBe(base * 2);
    expect(backoffDelayMs(2, { jitter: false })).toBe(base * 4);
  });

  it('caps the delay so a long backoff cannot stall a run indefinitely', () => {
    expect(backoffDelayMs(50, { jitter: false })).toBeLessThanOrEqual(60_000);
  });

  it('prefers an explicit Retry-After over computed backoff', () => {
    expect(backoffDelayMs(0, { jitter: false, retryAfterMs: 30_000 })).toBe(30_000);
  });

  it('still caps an absurd Retry-After value', () => {
    expect(backoffDelayMs(0, { jitter: false, retryAfterMs: 999_999_999 })).toBe(60_000);
  });

  it('applies jitter within the computed window by default', () => {
    const delays = new Set(
      Array.from({ length: 40 }, () => backoffDelayMs(3))
    );
    // Jitter must actually vary, or every client retries in lockstep.
    expect(delays.size).toBeGreaterThan(1);
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(60_000);
    }
  });
});

describe('403 handling', () => {
  it('does not treat a 403 as a refreshable auth error', () => {
    // 403 means the token lacks the scope, not that it aged out. A refresh
    // returns the same scopes, so retrying can only waste rate-limit budget.
    const err = parseEbayError(403, envelope(1100, 'Insufficient permissions'));
    expect(classifyRetry(err).retryable).toBe(false);
  });

  it('marks a 403 as needing reauthorization, since scopes must change', () => {
    const err = parseEbayError(403, envelope(1100, 'Insufficient permissions'));
    expect(err).toBeInstanceOf(EbayAuthError);
    expect((err as EbayAuthError).requiresReauthorization).toBe(true);
  });

  it('still treats a 401 as refreshable', () => {
    const err = parseEbayError(401, envelope(1001, 'Invalid access token'));
    expect(classifyRetry(err).retryable).toBe(true);
  });
});

describe('classifyRetry with wrapped network errors', () => {
  it('retries a fetch failure whose code is on the cause', () => {
    // Node's fetch throws `TypeError: fetch failed` and puts the real errno on
    // `.cause`. Checking only the top-level error means every transient DNS or
    // socket blip is treated as permanent and the sync gives up.
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.ebay.com'), {
        code: 'ENOTFOUND',
      }),
    });

    expect(classifyRetry(error).retryable).toBe(true);
  });

  it('retries a code nested two levels down', () => {
    const inner = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    });
    const error = new TypeError('fetch failed', {
      cause: new Error('wrapped', { cause: inner }),
    });

    expect(classifyRetry(error).retryable).toBe(true);
  });

  it('still refuses a wrapped error with no retryable code', () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('bad port'), { code: 'ERR_BAD_PORT' }),
    });

    expect(classifyRetry(error).retryable).toBe(false);
  });

  it('does not loop forever on a self-referencing cause chain', () => {
    const error = new Error('a') as Error & { cause?: unknown };
    error.cause = error;

    expect(classifyRetry(error).retryable).toBe(false);
  });
});
