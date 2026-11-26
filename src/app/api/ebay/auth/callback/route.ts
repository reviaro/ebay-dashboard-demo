/**
 * Alias of /api/ebay/oauth/callback.
 *
 * The eBay keyset's "auth accepted URL" is registered as
 * `/api/ebay/auth/callback`. That path does not need to resolve for the
 * paste-back flow — eBay matches on the RuName, and the operator copies the
 * code out of the address bar. But if this dashboard is ever hosted at the
 * registered domain, the direct redirect should land on a real handler rather
 * than a 404, so both paths are served.
 */
// `dynamic` must be declared statically here; Next.js cannot follow a re-export.
export const dynamic = 'force-dynamic';
export { GET, POST } from '../../oauth/callback/route';
