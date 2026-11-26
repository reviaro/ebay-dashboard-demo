import { describe, it, expect, vi } from 'vitest';
import { startAuthorization, completeAuthorization, OAuthFlowError } from './oauth-service';
import { loadEbayConfig } from './config';
import { decryptToken } from './token-store';
import type { OAuthStateStore, AccountStore, StoredAccount } from './stores';

const CFG = loadEbayConfig({
  EBAY_ENVIRONMENT: 'production',
  EBAY_CLIENT_ID: 'Test-App-PRD-abc-def',
  EBAY_CLIENT_SECRET: 'PRD-a1b2c3d4e5f6-1a2b-3c4d-5e6f',
  EBAY_RUNAME: 'Test_Seller-TestApp-prod-abc123xyz',
  EBAY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
});

function fakeStateStore() {
  const rows = new Map<string, { expiresAt: Date; consumedAt: Date | null }>();
  const store: OAuthStateStore & { rows: typeof rows } = {
    rows,
    async create(state, _env, expiresAt) {
      rows.set(state, { expiresAt, consumedAt: null });
    },
    async consume(state, now) {
      const row = rows.get(state);
      if (!row) return null;
      if (row.consumedAt) return null;
      if (row.expiresAt.getTime() <= now.getTime()) return null;
      row.consumedAt = now;
      return { state, expiresAt: row.expiresAt, environment: 'production', scopes: [...CFG.scopes] };
    },
  };
  return store;
}

function fakeAccountStore() {
  let saved: StoredAccount | null = null;
  const store: AccountStore & { get saved(): StoredAccount | null } = {
    get saved() { return saved; },
    async upsert(account) { saved = account; return account; },
    async find() { return saved; },
    async clear() { saved = null; },
  };
  return store;
}

const tokenPayload = {
  access_token: 'access-token-value',
  expires_in: 7200,
  refresh_token: 'refresh-token-value',
  refresh_token_expires_in: 47304000,
};

describe('startAuthorization', () => {
  it('persists the state before returning a URL that carries it', async () => {
    const states = fakeStateStore();
    const { url, state } = await startAuthorization(CFG, states);
    expect(states.rows.has(state)).toBe(true);
    expect(new URL(url).searchParams.get('state')).toBe(state);
  });

  it('gives the state a short expiry', async () => {
    const states = fakeStateStore();
    const now = new Date('2026-09-03T00:00:00Z');
    const { state } = await startAuthorization(CFG, states, now);
    const row = states.rows.get(state)!;
    const minutes = (row.expiresAt.getTime() - now.getTime()) / 60000;
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  it('issues a different state each time', async () => {
    const states = fakeStateStore();
    const a = await startAuthorization(CFG, states);
    const b = await startAuthorization(CFG, states);
    expect(a.state).not.toBe(b.state);
  });
});

describe('completeAuthorization', () => {
  const redirect = (state: string, code = 'auth-code') =>
    `https://example.com/cb?code=${encodeURIComponent(code)}&state=${state}`;

  async function setup() {
    const states = fakeStateStore();
    const accounts = fakeAccountStore();
    const { state } = await startAuthorization(CFG, states);
    return { states, accounts, state };
  }

  it('exchanges the code and stores the refresh token encrypted', async () => {
    const { states, accounts, state } = await setup();
    const exchange = vi.fn().mockResolvedValue(tokenPayload);

    await completeAuthorization(CFG, redirect(state), { states, accounts }, { exchange, identify: async () => ({ sellerId: 'seller-1', username: 'seller' }) });

    const saved = accounts.saved!;
    expect(saved.refreshTokenCiphertext).toBeTruthy();
    // The plaintext must not appear anywhere in the stored record.
    expect(JSON.stringify(saved)).not.toContain('refresh-token-value');
    expect(
      decryptToken(
        {
          ciphertext: saved.refreshTokenCiphertext,
          iv: saved.refreshTokenIv,
          authTag: saved.refreshTokenAuthTag,
          keyVersion: saved.refreshTokenKeyVersion,
        },
        CFG.encryptionKeys
      )
    ).toBe('refresh-token-value');
  });

  it('never stores the access token', async () => {
    const { states, accounts, state } = await setup();
    await completeAuthorization(CFG, redirect(state), { states, accounts }, {
      identify: async () => ({ sellerId: 'seller-1', username: 'seller' }),
      exchange: vi.fn().mockResolvedValue(tokenPayload),
    });
    expect(JSON.stringify(accounts.saved)).not.toContain('access-token-value');
  });

  it('records granted scopes and a connected status', async () => {
    const { states, accounts, state } = await setup();
    await completeAuthorization(CFG, redirect(state), { states, accounts }, {
      identify: async () => ({ sellerId: 'seller-1', username: 'seller' }),
      exchange: vi.fn().mockResolvedValue(tokenPayload),
    });
    expect(accounts.saved!.status).toBe('connected');
    expect(JSON.parse(accounts.saved!.scopes)).toEqual([...CFG.scopes]);
  });

  it('rejects a state that was never issued', async () => {
    const { states, accounts } = await setup();
    const exchange = vi.fn();
    await expect(
      completeAuthorization(CFG, redirect('never-issued'), { states, accounts }, { exchange, identify: async () => ({ sellerId: 'seller-1', username: 'seller' }) })
    ).rejects.toThrow(OAuthFlowError);
    // Critically: the code must not be exchanged when state validation fails.
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects a replayed state, so a leaked redirect cannot be reused', async () => {
    const { states, accounts, state } = await setup();
    const exchange = vi.fn().mockResolvedValue(tokenPayload);
    await completeAuthorization(CFG, redirect(state), { states, accounts }, { exchange, identify: async () => ({ sellerId: 'seller-1', username: 'seller' }) });
    await expect(
      completeAuthorization(CFG, redirect(state), { states, accounts }, { exchange, identify: async () => ({ sellerId: 'seller-1', username: 'seller' }) })
    ).rejects.toThrow(OAuthFlowError);
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired state', async () => {
    const states = fakeStateStore();
    const accounts = fakeAccountStore();
    const start = new Date('2026-09-03T00:00:00Z');
    const { state } = await startAuthorization(CFG, states, start);
    const exchange = vi.fn();
    const muchLater = new Date(start.getTime() + 60 * 60 * 1000);
    await expect(
      completeAuthorization(CFG, redirect(state), { states, accounts }, { exchange, identify: async () => ({ sellerId: 'seller-1', username: 'seller' }), now: muchLater })
    ).rejects.toThrow(OAuthFlowError);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects a redirect carrying no state at all', async () => {
    const { states, accounts } = await setup();
    const exchange = vi.fn();
    await expect(
      completeAuthorization(CFG, 'https://example.com/cb?code=abc', { states, accounts }, { exchange, identify: async () => ({ sellerId: 'seller-1', username: 'seller' }) })
    ).rejects.toThrow(OAuthFlowError);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('surfaces an eBay refusal without consuming state or calling exchange', async () => {
    const { states, accounts, state } = await setup();
    const exchange = vi.fn();
    await expect(
      completeAuthorization(
        CFG,
        `https://example.com/cb?error=access_denied&state=${state}`,
        { states, accounts },
        { exchange, identify: async () => ({ sellerId: 'seller-1', username: 'seller' }) }
      )
    ).rejects.toThrow(/access_denied/);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('fails when the token response omits a refresh token', async () => {
    const { states, accounts, state } = await setup();
    await expect(
      completeAuthorization(CFG, redirect(state), { states, accounts }, {
        identify: async () => ({ sellerId: 'seller-1', username: 'seller' }),
        exchange: vi.fn().mockResolvedValue({ access_token: 'at', expires_in: 7200 }),
      })
    ).rejects.toThrow(/refresh token/i);
    expect(accounts.saved).toBeNull();
  });

  it('does not leak the authorization code in an error message', async () => {
    const { states, accounts, state } = await setup();
    const exchange = vi.fn().mockRejectedValue(new Error('boom for code=secret-code-xyz'));
    try {
      await completeAuthorization(CFG, redirect(state, 'secret-code-xyz'), { states, accounts }, { exchange, identify: async () => ({ sellerId: 'seller-1', username: 'seller' }) });
    } catch (e) {
      expect((e as Error).message).not.toContain('secret-code-xyz');
    }
  });
});
