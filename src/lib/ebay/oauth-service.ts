/**
 * Orchestrates the OAuth authorization-code flow: issue state, validate the
 * redirect, exchange the code, and store the refresh token encrypted.
 *
 * The HTTP exchange is injected so this module has no network dependency and
 * every failure branch is exercised in tests.
 */

import type { EbayConfig } from './config';
import {
  buildAuthorizationUrl,
  buildTokenRequest,
  extractCodeFromRedirect,
  generateState,
  parseTokenResponse,
} from './oauth';
import { encryptToken } from './token-store';
import { redactString } from './redact';
import type { AccountStore, OAuthStateStore, StoredAccount } from './stores';

/** A consent request is short-lived; the operator completes it in one sitting. */
const STATE_TTL_MS = 15 * 60 * 1000;

export class OAuthFlowError extends Error {
  constructor(message: string) {
    super(redactString(message));
    this.name = 'OAuthFlowError';
  }
}

export interface StartResult {
  url: string;
  state: string;
}

/**
 * Issues a consent URL.
 *
 * The state is persisted *before* the URL is returned: if the write fails, no
 * URL is handed out, so a callback can never arrive for a state we never stored.
 */
export async function startAuthorization(
  config: EbayConfig,
  states: OAuthStateStore,
  now: Date = new Date()
): Promise<StartResult> {
  const state = generateState();
  await states.create(state, config.environment, new Date(now.getTime() + STATE_TTL_MS), config.scopes);
  return { url: buildAuthorizationUrl(config, state), state };
}

/** Performs the token-endpoint call. Injected so tests need no network. */
export type ExchangeFn = (request: ReturnType<typeof buildTokenRequest>) => Promise<unknown>;

export interface CompleteDeps {
  exchange: ExchangeFn;
  identify: (accessToken: string) => Promise<{ sellerId: string; username: string }>;
  now?: Date;
}

export interface CompleteStores {
  states: OAuthStateStore;
  accounts: AccountStore;
}

/**
 * Validates a pasted redirect and completes the connection.
 *
 * Order matters: the redirect is parsed and the state validated *before* the
 * authorization code is exchanged, so a forged or replayed redirect never
 * reaches eBay's token endpoint.
 */
export async function completeAuthorization(
  config: EbayConfig,
  redirectInput: string,
  stores: CompleteStores,
  deps: CompleteDeps
): Promise<StoredAccount> {
  const now = deps.now ?? new Date();

  // Throws on an ?error= redirect, reporting eBay's refusal verbatim.
  const { code, state } = extractCodeFromRedirect(redirectInput);

  if (!state) {
    throw new OAuthFlowError(
      'That redirect carried no state parameter, so it cannot be verified. Start the connection again.'
    );
  }

  const consumed = await stores.states.consume(state, now);
  if (!consumed || consumed.environment !== config.environment) {
    // Unknown, already used, and expired are deliberately one message: telling
    // a caller which one it was leaks whether a state value existed.
    throw new OAuthFlowError(
      'That authorization link is invalid, expired, or already used. Start the connection again.'
    );
  }

  let payload: unknown;
  try {
    payload = await deps.exchange(
      buildTokenRequest(config, { grantType: 'authorization_code', code })
    );
  } catch (error) {
    // The code is single-use and now spent, but it must not reach a log line.
    throw new OAuthFlowError(
      `Token exchange failed: ${redactString(
        error instanceof Error ? error.message : String(error)
      )}`
    );
  }

  const tokens = parseTokenResponse(payload, now);

  if (!tokens.refreshToken) {
    throw new OAuthFlowError(
      'eBay returned no refresh token, so the connection could not be stored. Start the connection again.'
    );
  }

  const envelope = encryptToken(tokens.refreshToken, config.encryptionKeys);
  const seller = await deps.identify(tokens.accessToken);
  if (!seller.sellerId || !seller.username) throw new OAuthFlowError('eBay did not identify the seller. Reconnect the account.');

  return stores.accounts.upsert({
    sellerId: seller.sellerId,
    username: seller.username,
    environment: config.environment,
    marketplaceId: config.marketplaceId,
    refreshTokenCiphertext: envelope.ciphertext,
    refreshTokenIv: envelope.iv,
    refreshTokenAuthTag: envelope.authTag,
    refreshTokenKeyVersion: envelope.keyVersion,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
    // Scopes belong to the consent that started this flow, not a later settings change.
    scopes: JSON.stringify(consumed.scopes),
    status: 'connected',
    authorizedAt: now,
  });
}
