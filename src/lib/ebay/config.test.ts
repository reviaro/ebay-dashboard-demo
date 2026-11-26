import { describe, it, expect } from 'vitest';
import { loadEbayConfig, EbayConfigError } from './config';

const KEY = Buffer.alloc(32, 3).toString('base64');
const valid = {
  EBAY_ENVIRONMENT: 'production',
  EBAY_CLIENT_ID: 'Demo-App-PRD-abc123-def456',
  EBAY_CLIENT_SECRET: 'PRD-a1b2c3d4e5f6-1a2b-3c4d-5e6f',
  EBAY_RUNAME: 'Test_Seller-TestApp-prod-abc123xyz',
  EBAY_MARKETPLACE_ID: 'EBAY_US',
  EBAY_TOKEN_ENCRYPTION_KEY: KEY,
};

describe('loadEbayConfig', () => {
  it('loads a complete production config', () => {
    const cfg = loadEbayConfig(valid);
    expect(cfg.environment).toBe('production');
    expect(cfg.marketplaceId).toBe('EBAY_US');
    expect(cfg.runame).toBe('Test_Seller-TestApp-prod-abc123xyz');
  });

  it('points at production hosts when environment is production', () => {
    const cfg = loadEbayConfig(valid);
    expect(cfg.authUrl).toContain('auth.ebay.com');
    expect(cfg.tokenUrl).toContain('api.ebay.com');
    expect(cfg.apiBaseUrl).toBe('https://api.ebay.com');
    expect(cfg.financeApiBaseUrl).toBe('https://apiz.ebay.com');
  });

  it('points at sandbox hosts when environment is sandbox', () => {
    const cfg = loadEbayConfig({ ...valid, EBAY_ENVIRONMENT: 'sandbox' });
    expect(cfg.authUrl).toContain('sandbox.ebay.com');
    expect(cfg.apiBaseUrl).toBe('https://api.sandbox.ebay.com');
    expect(cfg.financeApiBaseUrl).toBe('https://apiz.sandbox.ebay.com');
  });

  it('exposes only read scopes', () => {
    const cfg = loadEbayConfig(valid);
    const writeish = cfg.scopes.filter((s) => {
      const leaf = s.split('/').pop() ?? '';
      return leaf !== 'api_scope' && !leaf.endsWith('.readonly') && leaf !== 'sell.finances';
    });
    expect(writeish).toEqual([]);
  });

  it('parses the encryption keyring so callers get a usable key', () => {
    expect(loadEbayConfig(valid).encryptionKeys.byVersion.size).toBe(1);
  });

  it('defaults the marketplace to EBAY_US when unset', () => {
    const rest: Record<string, string> = { ...valid };
    delete rest.EBAY_MARKETPLACE_ID;
    expect(loadEbayConfig(rest).marketplaceId).toBe('EBAY_US');
  });

  it('names every missing variable at once, not one per run', () => {
    try {
      loadEbayConfig({ EBAY_ENVIRONMENT: 'production' });
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('EBAY_CLIENT_ID');
      expect(msg).toContain('EBAY_CLIENT_SECRET');
      expect(msg).toContain('EBAY_RUNAME');
      expect(msg).toContain('EBAY_TOKEN_ENCRYPTION_KEY');
    }
  });

  it('rejects an unknown environment instead of guessing a host', () => {
    expect(() => loadEbayConfig({ ...valid, EBAY_ENVIRONMENT: 'staging' })).toThrow(
      EbayConfigError
    );
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() =>
      loadEbayConfig({ ...valid, EBAY_TOKEN_ENCRYPTION_KEY: 'tooshort' })
    ).toThrow(/32 bytes/);
  });

  it('never puts a secret in the error message', () => {
    try {
      loadEbayConfig({ ...valid, EBAY_ENVIRONMENT: 'staging' });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('PRD-a1b2c3d4e5f6');
      expect(msg).not.toContain(KEY);
    }
  });

  describe('RuName validation', () => {
    it('rejects a full URL and points at the embedded runame parameter', () => {
      const url =
        'https://signin.ebay.com/ws/eBayISAPI.dll?SignIn&runame=Test_Seller-TestApp-prod-abc123xyz&SessID=<SESSION_ID>';
      try {
        loadEbayConfig({ ...valid, EBAY_RUNAME: url });
        throw new Error('should have thrown');
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toMatch(/RuName/i);
        // The fix must be actionable: name the value to use.
        expect(msg).toContain('Test_Seller-TestApp-prod-abc123xyz');
      }
    });

    it('rejects a bare https redirect URL with no runame parameter', () => {
      expect(() =>
        loadEbayConfig({ ...valid, EBAY_RUNAME: 'https://example.com/api/ebay/callback' })
      ).toThrow(/RuName/i);
    });

    it('accepts a well-formed RuName', () => {
      expect(loadEbayConfig(valid).runame).toBe(valid.EBAY_RUNAME);
    });
  });
});
