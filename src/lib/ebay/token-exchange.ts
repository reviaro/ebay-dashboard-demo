import { assertLiveIntegrationAllowed } from '../demo/server';
/**
 * The real token-endpoint call, isolated so oauth-service.ts stays network-free
 * and fully testable.
 */

import { parseEbayError } from './errors';
import type { buildTokenRequest } from './oauth';

const TIMEOUT_MS = 20_000;

/** POSTs to eBay's token endpoint and returns the parsed JSON body. */
export async function exchangeWithEbay(
  request: ReturnType<typeof buildTokenRequest>
): Promise<unknown> {
  assertLiveIntegrationAllowed();
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });

  const raw = await response.text();
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw; // parseEbayError handles a non-JSON body.
  }

  if (!response.ok) {
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    throw parseEbayError(response.status, body, headers);
  }

  return body;
}
