/**
 * Supplies a valid access token, refreshing from the stored refresh token.
 *
 * eBay access tokens last ~2 hours; the refresh token lasts ~18 months. This is
 * the only place the refresh token is decrypted, and it never leaves this
 * module: callers receive an access token and nothing else.
 *
 * Three behaviours matter more than they look:
 *
 *   - **Caching.** Without it every request would hit the token endpoint, which
 *     eBay rate-limits far more tightly than the data APIs.
 *   - **Coalescing.** Domain jobs run concurrently. Ten of them starting at
 *     once must cause one refresh, not ten -- concurrent refreshes waste quota
 *     and can invalidate one another.
 *   - **Distinguishing a dead grant from a blip.** A revoked or expired grant
 *     needs the operator to re-consent, and the account is flagged so the UI
 *     can say so. A 502 is just a 502 and must not flag anything.
 */

import type { EbayConfig } from './config';
import { buildTokenRequest, parseTokenResponse } from './oauth';
import { decryptToken } from './token-store';
import { EbayAuthError } from './errors';
import type { AccountStore } from './stores';

export interface TokenProvider {
  /** A valid access token, refreshing if the cached one is stale. */
  getAccessToken(): Promise<string>;
  /** Drops the cached token, forcing the next call to refresh. */
  invalidate(): void;
}

export interface TokenProviderOptions {
  config: EbayConfig;
  accounts: AccountStore;
  /** Performs the token-endpoint call; injectable so tests stay offline. */
  exchange: (request: ReturnType<typeof buildTokenRequest>) => Promise<unknown>;
  now?: () => Date;
}

export class EbayNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EbayNotConnectedError';
  }
}

/**
 * Treat a token as stale this long before it actually expires.
 *
 * A token that dies while a request is in flight surfaces as a confusing 401
 * that looks like a permissions problem. Refreshing a minute early costs
 * nothing and removes the whole class of failure.
 */
const EXPIRY_MARGIN_MS = 60_000;

export function createTokenProvider(
  options: TokenProviderOptions
): TokenProvider {
  const { config, accounts, exchange, now = () => new Date() } = options;

  let cachedToken: string | null = null;
  let cachedExpiry = 0;
  let cachedGrant = '';
  let inFlight: Promise<string> | null = null;

  function isFresh(): boolean {
    return (
      cachedToken !== null &&
      now().getTime() + EXPIRY_MARGIN_MS < cachedExpiry
    );
  }

  async function refresh(): Promise<string> {
    const account = await accounts.find(config.environment);

    if (!account) {
      throw new EbayNotConnectedError(
        `No eBay account is connected for the ${config.environment} environment. Connect one in Settings.`
      );
    }

    if (account.status !== 'connected') {
      throw new EbayNotConnectedError(
        'The eBay connection needs reauthorization. Reconnect the account in Settings.'
      );
    }

    const refreshToken = decryptToken(
      {
        ciphertext: account.refreshTokenCiphertext,
        iv: account.refreshTokenIv,
        authTag: account.refreshTokenAuthTag,
        keyVersion: account.refreshTokenKeyVersion,
      },
      config.encryptionKeys
    );

    let payload: unknown;
    try {
      payload = await exchange(
        buildTokenRequest({ ...config, scopes: config.scopes.filter(scope => (JSON.parse(account.scopes) as string[]).includes(scope)) }, { grantType: 'refresh_token', refreshToken })
      );
    } catch (error) {
      // Only a grant that eBay says is dead earns the flag. Everything else --
      // a 502, a timeout, a rate limit -- is transient, and marking the account
      // would send the operator to re-consent for no reason.
      if (error instanceof EbayAuthError && error.requiresReauthorization) {
        // The encrypted token is kept, not cleared: disconnecting is the
        // operator's decision, and the row still carries scopes and history.
        await accounts.upsert({ ...account, status: 'reauthorization_required' });
      }
      throw error;
    }

    const tokens = parseTokenResponse(payload, now());

    cachedToken = tokens.accessToken;
    cachedExpiry = tokens.accessTokenExpiresAt.getTime();
    cachedGrant = `${account.id ?? ''}:${account.authorizedAt.toISOString()}`;

    return tokens.accessToken;
  }

  return {
    async getAccessToken() {
      const current = await accounts.find(config.environment);
      if (!current || current.status !== 'connected') {
        cachedToken = null;
        throw new EbayNotConnectedError(current ? 'The eBay connection is disconnected or needs reauthorization.' : 'No eBay account is connected for this store.');
      }
      if (isFresh() && cachedGrant === `${current.id ?? ''}:${current.authorizedAt.toISOString()}`) return cachedToken as string;

      // Join the refresh already running rather than starting a second one.
      if (inFlight) return inFlight;

      inFlight = refresh().finally(() => {
        // Cleared on both paths: leaving a rejected promise here would poison
        // every later call with the original failure.
        inFlight = null;
      });

      return inFlight;
    },

    invalidate() {
      cachedToken = null;
      cachedExpiry = 0;
    },
  };
}
