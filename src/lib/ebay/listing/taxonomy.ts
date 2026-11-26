import { assertLiveIntegrationAllowed } from '../../demo/server';
import type { EbayConfig } from '../config';

/**
 * Category lookups use an application token, not a seller's. Both the token
 * and the marketplace's category-tree ID are the same for every request, so
 * they are fetched once and reused: a category search is then one eBay call
 * instead of three.
 */
const TOKEN_MARGIN_MS = 60_000;
const TREE_TTL_MS = 24 * 60 * 60_000;
type Cached = { value: string; expiresAt: number };
const appTokens = new Map<string, Cached>();
const treeIds = new Map<string, Cached>();

/** Test hook. */
export function clearTaxonomyCache(): void { appTokens.clear(); treeIds.clear(); }

async function appToken(config: EbayConfig): Promise<string> {
  const key = `${config.environment}:${config.clientId}`;
  const cached = appTokens.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }),
    signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Category lookup is unavailable. Check the eBay application credentials.');
  const body = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('Category lookup is unavailable. Check the eBay application credentials.');
  const lifetimeMs = (Number(body.expires_in) || 0) * 1000;
  if (lifetimeMs > TOKEN_MARGIN_MS) appTokens.set(key, { value: body.access_token, expiresAt: Date.now() + lifetimeMs - TOKEN_MARGIN_MS });
  return body.access_token;
}

async function taxonomyGet(config: EbayConfig, path: string, retry = true): Promise<any> {
  const response = await fetch(`${config.apiBaseUrl}/commerce/taxonomy/v1${path}`, { headers: { Authorization: `Bearer ${await appToken(config)}` }, signal: AbortSignal.timeout(30000), redirect: 'error', cache: 'no-store' });
  // A cached token eBay no longer accepts is replaced once rather than failing until it expires.
  if (response.status === 401 && retry) { appTokens.clear(); return taxonomyGet(config, path, false); }
  if (!response.ok) throw new Error('eBay category lookup is unavailable for this environment. You can enter a category ID manually.');
  return response.json();
}

async function treeId(config: EbayConfig): Promise<string> {
  const cached = treeIds.get(config.environment);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const tree = await taxonomyGet(config, '/get_default_category_tree_id?marketplace_id=EBAY_US');
  const value = String(tree.categoryTreeId);
  if (!/^\d+$/.test(value)) throw new Error('eBay did not return a category tree.');
  treeIds.set(config.environment, { value, expiresAt: Date.now() + TREE_TTL_MS });
  return value;
}

export async function categorySuggestions(config: EbayConfig, query: string) {
  assertLiveIntegrationAllowed();
  return taxonomyGet(config, `/category_tree/${await treeId(config)}/get_category_suggestions?q=${encodeURIComponent(query)}`);
}
export async function categoryAspects(config: EbayConfig, categoryId: string) {
  assertLiveIntegrationAllowed();
  return taxonomyGet(config, `/category_tree/${await treeId(config)}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`);
}
