/**
 * Persistence interfaces for the OAuth flow.
 *
 * The flow depends on these rather than on Prisma directly, so the security
 * logic — state validation, replay rejection, token encryption — is testable
 * without a database, and the Prisma implementation stays thin enough to review
 * by eye.
 */

export interface ConsumedState {
  state: string;
  expiresAt: Date;
  environment: string;
  scopes: string[];
}

export interface OAuthStateStore {
  create(state: string, environment: string, expiresAt: Date, scopes: readonly string[]): Promise<void>;
  /**
   * Atomically marks a state used and returns it, or null when it is unknown,
   * already consumed, or expired. Returning null must be indistinguishable
   * between those cases to the caller's error message.
   */
  consume(state: string, now: Date): Promise<ConsumedState | null>;
}

export interface StoredAccount {
  id?: string;
  environment: string;
  marketplaceId: string;
  sellerId?: string | null;
  username?: string | null;
  refreshTokenCiphertext: string;
  refreshTokenIv: string;
  refreshTokenAuthTag: string;
  refreshTokenKeyVersion: string;
  refreshTokenExpiresAt?: Date | null;
  /** JSON array of granted scope URIs. */
  scopes: string;
  status: 'connected' | 'reauthorization_required' | 'disconnected';
  authorizedAt: Date;
}

export interface AccountStore {
  upsert(account: StoredAccount): Promise<StoredAccount>;
  find(environment: string): Promise<StoredAccount | null>;
  clear(environment: string): Promise<void>;
}
