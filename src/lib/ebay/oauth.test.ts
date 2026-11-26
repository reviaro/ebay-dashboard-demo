import { describe, it, expect } from 'vitest';
import {
  buildAuthorizationUrl,
  generateState,
  extractCodeFromRedirect,
  buildTokenRequest,
  parseTokenResponse,
} from './oauth';
import { loadEbayConfig } from './config';

const CFG = loadEbayConfig({
  EBAY_ENVIRONMENT: 'production',
  EBAY_CLIENT_ID: 'Demo-App-PRD-abc123-def456',
  EBAY_CLIENT_SECRET: 'PRD-a1b2c3d4e5f6-1a2b-3c4d-5e6f',
  EBAY_RUNAME: 'Test_Seller-TestApp-prod-abc123xyz',
  EBAY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
});

describe('generateState', () => {
  it('produces a long, unguessable value', () => {
    expect(generateState().length).toBeGreaterThanOrEqual(32);
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateState()));
    expect(seen.size).toBe(200);
  });

  it('is URL-safe so it survives a redirect round trip', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('buildAuthorizationUrl', () => {
  it('targets the environment consent endpoint', () => {
    const url = new URL(buildAuthorizationUrl(CFG, 'state-123'));
    expect(url.origin + url.pathname).toBe('https://auth.ebay.com/oauth2/authorize');
  });

  it('sends the RuName as redirect_uri, not a URL', () => {
    const url = new URL(buildAuthorizationUrl(CFG, 'state-123'));
    expect(url.searchParams.get('redirect_uri')).toBe(
      'Test_Seller-TestApp-prod-abc123xyz'
    );
  });

  it('requests the authorization-code flow with our state', () => {
    const url = new URL(buildAuthorizationUrl(CFG, 'state-123'));
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('Demo-App-PRD-abc123-def456');
    expect(url.searchParams.get('state')).toBe('state-123');
  });

  it('requests every read scope, space-delimited', () => {
    const url = new URL(buildAuthorizationUrl(CFG, 's'));
    const scopes = (url.searchParams.get('scope') ?? '').split(' ');
    expect(scopes).toEqual([...CFG.scopes]);
  });

  it('never leaks the client secret into the consent URL', () => {
    expect(buildAuthorizationUrl(CFG, 's')).not.toContain(CFG.clientSecret);
  });
});

describe('extractCodeFromRedirect', () => {
  it('reads code and state from a pasted redirect URL', () => {
    const got = extractCodeFromRedirect(
      'https://example.com/cb?code=v%5E1.1%23abc123&state=st-9'
    );
    expect(got).toEqual({ code: 'v^1.1#abc123', state: 'st-9' });
  });

  it('accepts a bare query string, since browsers show partial URLs', () => {
    expect(extractCodeFromRedirect('?code=abc&state=st-9')).toEqual({
      code: 'abc',
      state: 'st-9',
    });
  });

  it('surfaces an eBay error redirect rather than reporting a missing code', () => {
    expect(() =>
      extractCodeFromRedirect('https://example.com/cb?error=access_denied&state=s')
    ).toThrow(/access_denied/);
  });

  it('rejects a redirect with no code', () => {
    expect(() => extractCodeFromRedirect('https://example.com/cb?state=s')).toThrow(
      /code/i
    );
  });

  it('rejects unparseable input', () => {
    expect(() => extractCodeFromRedirect('not a url at all')).toThrow();
  });
});

describe('buildTokenRequest', () => {
  it('authenticates with HTTP Basic over client id and secret', () => {
    const req = buildTokenRequest(CFG, { grantType: 'authorization_code', code: 'c' });
    const [scheme, encoded] = (req.headers.Authorization ?? '').split(' ');
    expect(scheme).toBe('Basic');
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(
      `${CFG.clientId}:${CFG.clientSecret}`
    );
  });

  it('posts form-encoded to the token endpoint', () => {
    const req = buildTokenRequest(CFG, { grantType: 'authorization_code', code: 'c' });
    expect(req.url).toBe('https://api.ebay.com/identity/v1/oauth2/token');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('sends the RuName as redirect_uri when exchanging a code', () => {
    const req = buildTokenRequest(CFG, { grantType: 'authorization_code', code: 'c' });
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('c');
    expect(body.get('redirect_uri')).toBe(CFG.runame);
  });

  it('omits redirect_uri and sends scopes when refreshing', () => {
    const req = buildTokenRequest(CFG, {
      grantType: 'refresh_token',
      refreshToken: 'rt',
    });
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt');
    expect(body.get('redirect_uri')).toBeNull();
    expect(body.get('scope')).toBe(CFG.scopes.join(' '));
  });
});

describe('parseTokenResponse', () => {
  it('reads an authorization-code exchange, including the refresh token', () => {
    const now = new Date('2026-09-03T00:00:00Z');
    const t = parseTokenResponse(
      {
        access_token: 'at',
        expires_in: 7200,
        refresh_token: 'rt',
        refresh_token_expires_in: 47304000,
        token_type: 'User Access Token',
      },
      now
    );
    expect(t.accessToken).toBe('at');
    expect(t.refreshToken).toBe('rt');
    expect(t.accessTokenExpiresAt.toISOString()).toBe('2026-09-03T02:00:00.000Z');
    // 47304000s is eBay's ~18-month refresh-token lifetime: 547.5 days,
    // which from 2026-09-03 lands mid-day on 2028-03-03 (2028 is a leap year).
    expect(t.refreshTokenExpiresAt?.toISOString()).toBe('2028-03-03T12:00:00.000Z');
  });

  it('tolerates a refresh response that omits a new refresh token', () => {
    const t = parseTokenResponse(
      { access_token: 'at2', expires_in: 7200 },
      new Date('2026-09-03T00:00:00Z')
    );
    expect(t.accessToken).toBe('at2');
    expect(t.refreshToken).toBeUndefined();
    expect(t.refreshTokenExpiresAt).toBeUndefined();
  });

  it('rejects a response with no access token instead of storing undefined', () => {
    expect(() => parseTokenResponse({ expires_in: 7200 }, new Date())).toThrow();
  });

  it('rejects a non-numeric expires_in', () => {
    expect(() =>
      parseTokenResponse({ access_token: 'at', expires_in: 'soon' }, new Date())
    ).toThrow();
  });
});
