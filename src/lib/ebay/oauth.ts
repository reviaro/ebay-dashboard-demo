/**
 * eBay OAuth 2.0 authorization-code flow (server-side only).
 *
 * Pure functions: URL building, redirect parsing, request shaping, and response
 * parsing. Nothing here performs I/O or touches the database, so every branch
 * is testable without a network or a live credential.
 *
 * Operator setup: production keyset, no public HTTPS callback. Consent happens
 * in a browser and the operator pastes the resulting redirect URL back into the
 * dashboard, which `extractCodeFromRedirect` parses.
 */

import { randomBytes } from 'crypto';
import type { EbayConfig } from './config';

/** CSRF nonce binding a consent request to the session that began it. */
export function generateState(): string {
  return randomBytes(32).toString('base64url');
}

/** Builds the eBay consent URL the operator opens in a browser. */
export function buildAuthorizationUrl(config: EbayConfig, state: string): string {
  const url = new URL(config.authUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  // eBay takes the RuName here, not an https URL.
  url.searchParams.set('redirect_uri', config.runame);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

export interface RedirectResult {
  code: string;
  state: string | null;
}

export class OAuthRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthRedirectError';
  }
}

/**
 * Parses the redirect the operator pastes back.
 *
 * Accepts a full URL or a bare query string, because browsers and operators
 * both truncate. eBay URL-encodes the code, so decoding is required before the
 * exchange — `URLSearchParams` handles that.
 */
export function extractCodeFromRedirect(input: string): RedirectResult {
  const trimmed = input.trim();
  if (!trimmed) throw new OAuthRedirectError('No redirect URL was provided.');

  let params: URLSearchParams;
  if (trimmed.startsWith('?')) {
    params = new URLSearchParams(trimmed.slice(1));
  } else {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new OAuthRedirectError(
        'Could not parse that as a URL. Paste the full address bar contents after approving access.'
      );
    }
    params = url.searchParams;
  }

  // eBay reports refusals as ?error=...; report that instead of "missing code".
  const error = params.get('error');
  if (error) {
    const description = params.get('error_description');
    throw new OAuthRedirectError(
      `eBay refused the authorization: ${error}${description ? ` (${description})` : ''}`
    );
  }

  const code = params.get('code');
  if (!code) {
    throw new OAuthRedirectError(
      'That URL has no `code` parameter. Make sure you copied the address after approving access.'
    );
  }

  return { code, state: params.get('state') };
}

export type TokenGrant =
  | { grantType: 'authorization_code'; code: string }
  | { grantType: 'refresh_token'; refreshToken: string };

export interface TokenRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

/**
 * Shapes the token-endpoint call. eBay authenticates the client with HTTP Basic
 * over `clientId:clientSecret`, so the secret goes in a header, never the body.
 */
export function buildTokenRequest(
  config: EbayConfig,
  grant: TokenGrant
): TokenRequest {
  const body = new URLSearchParams();
  body.set('grant_type', grant.grantType);

  if (grant.grantType === 'authorization_code') {
    body.set('code', grant.code);
    // Must match the redirect_uri used for consent, i.e. the RuName.
    body.set('redirect_uri', config.runame);
  } else {
    body.set('refresh_token', grant.refreshToken);
    // eBay requires the scope list on refresh; it may be a subset of the grant.
    body.set('scope', config.scopes.join(' '));
  }

  const basic = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
    'utf8'
  ).toString('base64');

  return {
    url: config.tokenUrl,
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  };
}

export interface EbayTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  /** Absent on refresh: eBay returns a new refresh token only on first grant. */
  refreshToken?: string;
  refreshTokenExpiresAt?: Date;
}

export class TokenResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenResponseError';
  }
}

/** Converts eBay's token payload into absolute expiry timestamps. */
export function parseTokenResponse(
  payload: unknown,
  now: Date = new Date()
): EbayTokens {
  const body = (payload ?? {}) as Record<string, unknown>;

  const accessToken = body.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new TokenResponseError('Token response contained no access_token.');
  }

  const expiresIn = body.expires_in;
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) {
    throw new TokenResponseError(
      'Token response contained no numeric expires_in.'
    );
  }

  const tokens: EbayTokens = {
    accessToken,
    accessTokenExpiresAt: new Date(now.getTime() + expiresIn * 1000),
  };

  if (typeof body.refresh_token === 'string' && body.refresh_token) {
    tokens.refreshToken = body.refresh_token;
    const refreshExpiresIn = body.refresh_token_expires_in;
    if (typeof refreshExpiresIn === 'number' && Number.isFinite(refreshExpiresIn)) {
      tokens.refreshTokenExpiresAt = new Date(
        now.getTime() + refreshExpiresIn * 1000
      );
    }
  }

  return tokens;
}
