import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EbayConfig } from '../config';
import { categoryAspects, categorySuggestions, clearTaxonomyCache } from './taxonomy';

const config = { environment: 'sandbox', clientId: 'id', clientSecret: 'secret', tokenUrl: 'https://auth.example.test/token', apiBaseUrl: 'https://api.example.test' } as EbayConfig;
let calls: string[];
let rejectToken: string | null;
let issued: number;

beforeEach(() => {
  clearTaxonomyCache(); calls = []; rejectToken = null; issued = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === config.tokenUrl) { calls.push('token'); return Response.json({ access_token: `app-token-${++issued}`, expires_in: 7200 }); }
    const token = new Headers(options?.headers).get('Authorization');
    if (rejectToken && token === `Bearer ${rejectToken}`) { calls.push('rejected'); return new Response('', { status: 401 }); }
    if (url.includes('get_default_category_tree_id')) { calls.push('tree'); return Response.json({ categoryTreeId: '0' }); }
    calls.push(url.includes('get_category_suggestions') ? 'suggest' : 'aspects');
    return Response.json({ url });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('category lookups', () => {
  it('fetches the application token and category tree once, then one eBay call per lookup', async () => {
    await categorySuggestions(config, 'alternator');
    expect(calls).toEqual(['token', 'tree', 'suggest']);
    await categorySuggestions(config, 'starter & solenoid');
    const aspects = await categoryAspects(config, '33573');
    expect(calls).toEqual(['token', 'tree', 'suggest', 'suggest', 'aspects']);
    expect(aspects.url).toContain('/category_tree/0/get_item_aspects_for_category?category_id=33573');
  });

  it('replaces a cached token that eBay stops accepting', async () => {
    await categorySuggestions(config, 'alternator');
    rejectToken = 'app-token-1';
    await categorySuggestions(config, 'starter');
    expect(calls.slice(3)).toEqual(['rejected', 'token', 'suggest']);
  });

  it('does not cache a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(categorySuggestions(config, 'alternator')).rejects.toThrow(/Category lookup is unavailable/);
  });
});
