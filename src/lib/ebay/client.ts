import { assertLiveIntegrationAllowed } from '../demo/server';
/**
 * The HTTP client for read-only eBay reporting calls.
 *
 * Two things make this file load-bearing:
 *
 *   1. `assertReadOnlyRequest` is the FIRST statement of `request()`. Until now
 *      the read-only guarantee rested on scopes alone; from here it is a
 *      property of the code path. Reporting syncs reach eBay through this
 *      function, and a write cannot get past line one -- not even to be
 *      retried, logged, or counted.
 *   2. Retry policy lives here rather than in each domain module, so orders,
 *      traffic, and finances cannot drift apart in how they treat a 429.
 *
 * The access token is fetched per request rather than held: caching belongs to
 * the token provider, and a client that memoised one would keep presenting a
 * token that had since been revoked.
 */

import type { EbayConfig } from './config';
import { assertReadOnlyRequest } from './read-only';
import {
  backoffDelayMs,
  classifyRetry,
  EbayApiError,
  parseEbayError,
} from './errors';
import { redactString } from './redact';

export interface EbayRequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /**
   * `bytes` for endpoints that return a file rather than JSON -- the Active
   * Inventory Report arrives as a ZIP, and reading it as text corrupts it.
   * Errors are still parsed as JSON, so a failure is an EbayApiError rather
   * than an error page handed back as bytes.
   */
  responseType?: 'json' | 'bytes';
}

export interface EbayClient {
  request<T = unknown>(
    method: string,
    path: string,
    options?: EbayRequestOptions
  ): Promise<T>;
  get<T = unknown>(path: string, options?: EbayRequestOptions): Promise<T>;
}

export interface EbayClientOptions {
  config: EbayConfig;
  /** Supplies a valid access token; responsible for its own caching. */
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  /** Injectable so tests do not actually wait out the backoff. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** Below this length a token is not distinctive enough to blind-replace. */
const MIN_SCRUBBABLE_TOKEN_LENGTH = 8;

function scrubToken(value: string, token: string): string {
  if (!token || token.length < MIN_SCRUBBABLE_TOKEN_LENGTH) return value;
  return value.split(token).join('[REDACTED_ACCESS_TOKEN]');
}

/** Same substitution applied through an arbitrary JSON-ish structure. */
function scrubTokenDeep(value: unknown, token: string): unknown {
  if (!token || token.length < MIN_SCRUBBABLE_TOKEN_LENGTH) return value;
  if (typeof value === 'string') return scrubToken(value, token);
  if (Array.isArray(value)) return value.map((v) => scrubTokenDeep(v, token));

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        scrubTokenDeep(v, token),
      ])
    );
  }

  return value;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 30_000;

function buildUrl(
  baseUrl: string,
  path: string,
  query: EbayRequestOptions['query']
): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, baseUrl);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

/**
 * The language eBay expects for a marketplace.
 *
 * Only the marketplaces this integration can be pointed at need an entry; the
 * default keeps an unlisted one working rather than sending nothing, which is
 * the case eBay rejects.
 */
const MARKETPLACE_LANGUAGE: Record<string, string> = {
  EBAY_US: 'en-US',
  EBAY_GB: 'en-GB',
  EBAY_CA: 'en-CA',
  EBAY_AU: 'en-AU',
  EBAY_DE: 'de-DE',
  EBAY_FR: 'fr-FR',
  EBAY_IT: 'it-IT',
  EBAY_ES: 'es-ES',
};

function marketplaceLanguage(marketplaceId: string): string {
  return MARKETPLACE_LANGUAGE[marketplaceId] ?? 'en-US';
}

export function createEbayClient(options: EbayClientOptions): EbayClient {
  const {
    config,
    getAccessToken,
    fetchImpl = fetch,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  async function attempt<T>(
    method: string,
    url: string,
    body: unknown,
    extraHeaders: Record<string, string> | undefined,
    signal: AbortSignal | undefined,
    responseType: 'json' | 'bytes'
  ): Promise<T> {
    const token = await getAccessToken();

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      // Sell Inventory rejects a request without this, reporting it as
      // "Invalid value for header Accept-Language" rather than as missing.
      'accept-language': marketplaceLanguage(config.marketplaceId),
      'x-ebay-c-marketplace-id': config.marketplaceId,
      ...extraHeaders,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });

    // A successful binary response is never decoded as text: `response.text()`
    // would replace invalid UTF-8 sequences and quietly corrupt the archive.
    if (response.ok && responseType === 'bytes') {
      return new Uint8Array(await response.arrayBuffer()) as T;
    }

    const raw = await response.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw; // parseEbayError copes with a non-JSON body.
      }
    }

    if (!response.ok) {
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        responseHeaders[k.toLowerCase()] = v;
      });

      const error = parseEbayError(response.status, parsed, responseHeaders);

      // eBay echoes the presented credential back in some auth failures. This
      // is the one place that knows the exact token value that was sent, so it
      // can remove that specific string -- `redactString` only recognises
      // credential *shapes* and would let an opaque bearer token through.
      // Both the message and the retained `details` are scrubbed: details is
      // kept for diagnostics and would otherwise carry the token into any log
      // line that serialises the error.
      error.message = redactString(scrubToken(error.message, token));
      // `details` is declared readonly for callers; overwriting it here, at the
      // boundary that created it, is deliberate.
      (error as { details?: unknown }).details = scrubTokenDeep(
        error.details,
        token
      );

      throw error;
    }

    return parsed as T;
  }

  async function request<T = unknown>(
    method: string,
    path: string,
    requestOptions: EbayRequestOptions = {}
  ): Promise<T> {
    // FIRST. Before the URL is built, before a token is fetched, before any
    // retry bookkeeping. A blocked write must not be observable as network
    // activity of any kind.
    assertLiveIntegrationAllowed();
    assertReadOnlyRequest(method, path, requestOptions.body);

    const url = buildUrl(config.apiBaseUrl, path, requestOptions.query);
    const upperMethod = method.toUpperCase();

    let lastError: unknown;

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
      try {
        return await attempt<T>(
          upperMethod,
          url,
          requestOptions.body,
          requestOptions.headers,
          requestOptions.signal,
          requestOptions.responseType ?? 'json'
        );
      } catch (error) {
        lastError = error;

        const decision = classifyRetry(error);
        const isLastAttempt = attemptIndex === maxAttempts - 1;
        if (!decision.retryable || isLastAttempt) throw error;

        await sleep(
          backoffDelayMs(attemptIndex, { retryAfterMs: decision.retryAfterMs })
        );
      }
    }

    // Unreachable: the loop either returns or throws.
    throw lastError instanceof Error
      ? lastError
      : new EbayApiError('eBay request failed', 0);
  }

  return {
    request,
    get: (path, opts) => request('GET', path, opts),
  };
}
