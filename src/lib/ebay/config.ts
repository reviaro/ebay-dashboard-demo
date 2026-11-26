/**
 * Server-only eBay configuration.
 *
 * Fails fast and loudly at startup rather than surfacing a confusing 401 on the
 * first API call. Never import this from client code: it reads the client
 * secret and the token-encryption key.
 */

import { parseEncryptionKeys, type EncryptionKeyring } from './token-store';
import { EBAY_READ_SCOPES } from './read-only';

export type EbayEnvironment = 'production' | 'sandbox';

export interface EbayConfig {
  environment: EbayEnvironment;
  clientId: string;
  clientSecret: string;
  /** eBay RuName, passed as the OAuth `redirect_uri` parameter. */
  runame: string;
  marketplaceId: string;
  scopes: readonly string[];
  encryptionKeys: EncryptionKeyring;
  authUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  /**
   * Base URL for the Sell Finances API, which eBay serves from `apiz.ebay.com`
   * rather than `api.ebay.com` -- every `/sell/finances/v1/*` path 404s on the
   * ordinary host.
   */
  financeApiBaseUrl: string;
}

export class EbayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EbayConfigError';
  }
}

const HOSTS: Record<EbayEnvironment, { auth: string; api: string; financeApi: string }> = {
  production: {
    auth: 'https://auth.ebay.com',
    api: 'https://api.ebay.com',
    financeApi: 'https://apiz.ebay.com',
  },
  sandbox: {
    auth: 'https://auth.sandbox.ebay.com',
    api: 'https://api.sandbox.ebay.com',
    financeApi: 'https://apiz.sandbox.ebay.com',
  },
};

/**
 * A RuName is an eBay-issued token like `User_Name-AppName-env-random`, not a
 * URL. The developer console shows it embedded in a legacy sign-in URL, which
 * is easy to copy wholesale — so detect that and name the value to extract.
 */
function validateRuName(value: string): string {
  if (!/^https?:\/\//i.test(value)) {
    if (value.includes('/') || value.includes('?')) {
      throw new EbayConfigError(
        'EBAY_RUNAME looks like a URL fragment. It must be the RuName token itself, e.g. User_Name-AppName-env-random.'
      );
    }
    return value;
  }

  let embedded: string | null = null;
  try {
    embedded = new URL(value).searchParams.get('runame');
  } catch {
    // Fall through to the generic message below.
  }

  if (embedded) {
    throw new EbayConfigError(
      `EBAY_RUNAME is a full sign-in URL, but eBay's OAuth flow needs the RuName token. Set EBAY_RUNAME=${embedded}`
    );
  }

  throw new EbayConfigError(
    'EBAY_RUNAME must be the RuName token from your eBay keyset (e.g. User_Name-AppName-env-random), not a redirect URL.'
  );
}

/**
 * The configured eBay environment, defaulting to production. The single place
 * `EBAY_ENVIRONMENT` is read, for callers that need only this and must not
 * fail on unrelated missing credentials.
 */
export function ebayEnvironment(env: Record<string, string | undefined> = process.env): EbayEnvironment {
  const raw = (env.EBAY_ENVIRONMENT ?? 'production').trim();
  if (raw !== 'production' && raw !== 'sandbox') {
    throw new EbayConfigError(`EBAY_ENVIRONMENT must be "production" or "sandbox", got "${raw}".`);
  }
  return raw;
}

/**
 * Builds config from an environment bag, defaulting to `process.env`.
 *
 * Reports every missing variable in one pass, so filling in `.env.local` is not
 * a guess-and-rerun loop.
 */
export function loadEbayConfig(
  env: Record<string, string | undefined> = process.env
): EbayConfig {
  const required = [
    'EBAY_CLIENT_ID',
    'EBAY_CLIENT_SECRET',
    'EBAY_RUNAME',
    'EBAY_TOKEN_ENCRYPTION_KEY',
  ] as const;

  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new EbayConfigError(
      `Missing required eBay environment variable(s): ${missing.join(', ')}. See .env.example for the expected block.`
    );
  }

  const environment = ebayEnvironment(env);
  const hosts = HOSTS[environment];

  return {
    environment,
    clientId: env.EBAY_CLIENT_ID!.trim(),
    clientSecret: env.EBAY_CLIENT_SECRET!.trim(),
    runame: validateRuName(env.EBAY_RUNAME!.trim()),
    marketplaceId: (env.EBAY_MARKETPLACE_ID ?? 'EBAY_US').trim(),
    scopes: EBAY_READ_SCOPES,
    encryptionKeys: parseEncryptionKeys(env.EBAY_TOKEN_ENCRYPTION_KEY!.trim()),
    authUrl: `${hosts.auth}/oauth2/authorize`,
    tokenUrl: `${hosts.api}/identity/v1/oauth2/token`,
    apiBaseUrl: hosts.api,
    financeApiBaseUrl: hosts.financeApi,
  };
}
