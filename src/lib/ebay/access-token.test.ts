import { describe, expect, it, vi, type Mock } from 'vitest';
import { loadEbayConfig } from './config';
import { encryptToken } from './token-store';
import { EbayApiError, EbayAuthError } from './errors';
import type { AccountStore, StoredAccount } from './stores';
import { createTokenProvider } from './access-token';

const CONFIG = loadEbayConfig({
  EBAY_ENVIRONMENT: 'sandbox',
  EBAY_CLIENT_ID: 'SBX-a1b2c3d4e5f6-1a2b-3c4d-5e6f',
  EBAY_CLIENT_SECRET: 'SBX-a1b2c3d4e5f6-1a2b-3c4d-5e6f',
  EBAY_RUNAME: 'Test_Name-TestName-testap-abcdef',
  EBAY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
});

const REFRESH_TOKEN = 'v^1.1#i^1#refresh-token-value';

function storedAccount(overrides: Partial<StoredAccount> = {}): StoredAccount {
  const secret = encryptToken(REFRESH_TOKEN, CONFIG.encryptionKeys);
  return {
    environment: 'sandbox',
    marketplaceId: 'EBAY_US',
    refreshTokenCiphertext: secret.ciphertext,
    refreshTokenIv: secret.iv,
    refreshTokenAuthTag: secret.authTag,
    refreshTokenKeyVersion: secret.keyVersion,
    scopes: JSON.stringify(CONFIG.scopes),
    status: 'connected',
    authorizedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

function accountStore(initial: StoredAccount | null = storedAccount()) {
  let account = initial;
  const store: AccountStore & { current: () => StoredAccount | null } = {
    async upsert(next) {
      account = next;
      return next;
    },
    async find() {
      return account;
    },
    async clear() {
      account = null;
    },
    current: () => account,
  };
  return store;
}

/** A token endpoint that returns a fresh access token each call. */
function exchanger(expiresIn = 7200): Mock {
  let n = 0;
  return vi.fn(async () => ({
    access_token: `access-${++n}`,
    expires_in: expiresIn,
    token_type: 'Application Access Token',
  }));
}

function provider(
  store = accountStore(),
  exchange: Mock = exchanger(),
  now: () => Date = () => new Date('2026-09-03T12:00:00Z')
) {
  return {
    store,
    exchange,
    provider: createTokenProvider({
      config: CONFIG,
      accounts: store,
      exchange,
      now,
    }),
  };
}

describe('createTokenProvider', () => {
  it('does not serve a cached access token after disconnect', async () => {
    const { provider: p, store } = provider();
    await p.getAccessToken();
    await store.clear('sandbox');
    await expect(p.getAccessToken()).rejects.toThrow(/No eBay account/);
  });

  it('refreshes a cached token after a new consent replaces the grant', async () => {
    const { provider: p, store, exchange } = provider();
    await p.getAccessToken();
    await store.upsert(storedAccount({ authorizedAt: new Date('2026-09-03T13:00:00Z') }));
    await expect(p.getAccessToken()).resolves.toBe('access-2');
    expect(exchange).toHaveBeenCalledTimes(2);
  });
  it('exchanges the stored refresh token for an access token', async () => {
    const { provider: p } = provider();
    await expect(p.getAccessToken()).resolves.toBe('access-1');
  });

  it('sends a refresh_token grant carrying the decrypted token', async () => {
    const { provider: p, exchange } = provider();
    await p.getAccessToken();

    const request = exchange.mock.calls[0][0] as { body: string };
    const body = new URLSearchParams(request.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe(REFRESH_TOKEN);
  });

  it('caches the access token instead of refreshing on every call', async () => {
    const { provider: p, exchange } = provider();

    await p.getAccessToken();
    await p.getAccessToken();
    await p.getAccessToken();

    expect(exchange).toHaveBeenCalledOnce();
  });

  it('refreshes once the cached token has expired', async () => {
    let clock = new Date('2026-09-03T12:00:00Z');
    const { provider: p, exchange } = provider(
      accountStore(),
      exchanger(3600),
      () => clock
    );

    await expect(p.getAccessToken()).resolves.toBe('access-1');
    clock = new Date('2026-09-03T13:30:00Z');
    await expect(p.getAccessToken()).resolves.toBe('access-2');
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('refreshes early, before the token actually expires', async () => {
    let clock = new Date('2026-09-03T12:00:00Z');
    const { provider: p } = provider(accountStore(), exchanger(3600), () => clock);

    await p.getAccessToken();
    // 30s before real expiry: a token that dies mid-flight would surface as a
    // spurious 401, so the provider must treat it as already stale.
    clock = new Date('2026-09-03T12:59:30Z');
    await expect(p.getAccessToken()).resolves.toBe('access-2');
  });

  it('coalesces concurrent callers into a single refresh', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const exchange = vi.fn(async () => {
      await gate;
      return { access_token: 'access-shared', expires_in: 7200 };
    });

    const { provider: p } = provider(accountStore(), exchange);

    const all = Promise.all([
      p.getAccessToken(),
      p.getAccessToken(),
      p.getAccessToken(),
      p.getAccessToken(),
    ]);
    release();

    // Ten parallel domain jobs must not mean ten refreshes: eBay rate-limits
    // the token endpoint, and concurrent refreshes can invalidate each other.
    await expect(all).resolves.toEqual([
      'access-shared',
      'access-shared',
      'access-shared',
      'access-shared',
    ]);
    expect(exchange).toHaveBeenCalledOnce();
  });

  it('lets a later call refresh again after an in-flight refresh fails', async () => {
    const exchange = vi
      .fn()
      .mockRejectedValueOnce(new EbayApiError('boom', 500))
      .mockResolvedValueOnce({ access_token: 'access-after', expires_in: 7200 });

    const { provider: p } = provider(accountStore(), exchange);

    await expect(p.getAccessToken()).rejects.toThrow(EbayApiError);
    // A failed refresh must not leave a permanently poisoned in-flight promise.
    await expect(p.getAccessToken()).resolves.toBe('access-after');
  });

  it('throws a clear error when no account is connected', async () => {
    const { provider: p } = provider(accountStore(null));
    await expect(p.getAccessToken()).rejects.toThrow(
      /No eBay account is connected/i
    );
  });

  it('throws when the stored account is already flagged for reauthorization', async () => {
    const { provider: p } = provider(
      accountStore(storedAccount({ status: 'reauthorization_required' }))
    );
    await expect(p.getAccessToken()).rejects.toThrow(/reauthoriz/i);
  });

  describe('a dead grant', () => {
    const deadGrant = () =>
      vi.fn(async () => {
        throw new EbayAuthError('invalid_grant', 400, undefined, true);
      });

    it('moves the account to reauthorization_required', async () => {
      const store = accountStore();
      const { provider: p } = provider(store, deadGrant());

      await expect(p.getAccessToken()).rejects.toThrow(EbayAuthError);
      expect(store.current()?.status).toBe('reauthorization_required');
    });

    it('keeps the encrypted refresh token rather than deleting it', async () => {
      const store = accountStore();
      const { provider: p } = provider(store, deadGrant());

      await p.getAccessToken().catch(() => {});

      // Disconnecting is the operator's decision, not a side effect of one
      // failed refresh -- and the row still carries the scopes and history.
      expect(store.current()?.refreshTokenCiphertext).toBeTruthy();
    });
  });

  it('does NOT flag the account when the failure is merely transient', async () => {
    const store = accountStore();
    const exchange = vi.fn(async () => {
      throw new EbayApiError('gateway', 502);
    });
    const { provider: p } = provider(store, exchange);

    await expect(p.getAccessToken()).rejects.toThrow(EbayApiError);
    expect(store.current()?.status).toBe('connected');
  });

  it('forgets the cached token when invalidated', async () => {
    const { provider: p, exchange } = provider();

    await expect(p.getAccessToken()).resolves.toBe('access-1');
    p.invalidate();
    await expect(p.getAccessToken()).resolves.toBe('access-2');
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('never exposes the refresh token through the returned value', async () => {
    const { provider: p } = provider();
    const token = await p.getAccessToken();
    expect(token).not.toContain('refresh-token-value');
  });
});
