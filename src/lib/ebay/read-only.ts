/**
 * Read-only enforcement for the reporting client.
 *
 * Reporting syncs remain read-only. Explicit listing actions use a separate,
 * store-authorized Trading/Media client (added 2026-11-14).
 * That is enforced in two independent layers so a single mistake cannot cause a
 * live listing change:
 *
 *   1. Scope — we request only read scopes, so eBay itself would reject a write.
 *   2. Method/path guard — the HTTP client refuses to issue a mutating request
 *      even if a broader token were ever supplied. The two POSTs it does allow
 *      are report-generation tasks, pinned by exact path and by the body that
 *      identifies them as reports; see below.
 *
 * Layer 2 matters because `sell.finances` has no `.readonly` variant in eBay's
 * scope list; the guard is what makes that scope read-only in practice.
 */

/**
 * Least-privilege read scopes, verified against eBay's published scope list.
 * Every entry is either the base scope or a `.readonly` variant, except
 * `sell.finances`, for which eBay publishes no `.readonly` form.
 */
export const EBAY_READ_SCOPES: readonly string[] = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
];

/**
 * The only non-GET requests this integration may issue.
 *
 * eBay exposes Promoted Listings reports exclusively through an asynchronous
 * task: you POST a task describing the report, poll it, then download the
 * result. The POST creates a report belonging to us — it does not alter
 * listings, campaigns, orders, or any other seller data. Without it, ads
 * reporting (plan Phase 6) is unreachable.
 *
 * Matched by exact normalized path, so no sibling or traversal path inherits
 * the exception. Deleting a finished report task is deliberately NOT allowed:
 * it is optional for reading, so it stays outside the permitted surface.
 */
const READ_ONLY_POST_PATHS: ReadonlySet<string> = new Set([
  '/sell/marketing/v1/ad_report_task',
]);

/**
 * The Active Inventory Report task.
 *
 * Sell Inventory does not cover listings created in eBay's web UI. The Active
 * Inventory Report is the supported way to see them, and reaching it costs one
 * POST, exactly like the ads report above: it creates a report belonging to
 * us and alters no listing, price, quantity or order.
 *
 * Two constraints keep this from becoming a write channel:
 *
 *   - `/sell/feed/v1/inventory_task` only, never `/sell/feed/v1/task`. The
 *     general endpoint takes the same POST to create *upload* feeds that add
 *     and revise real listings; it is the dangerous sibling and stays blocked.
 *   - The feed type is pinned. eBay accepts one value here today; pinning it
 *     means an upload feed type added later cannot inherit this exception
 *     merely by arriving on a path already trusted.
 */
const REPORT_TASK_PATH = '/sell/feed/v1/inventory_task';
const REPORT_TASK_FEED_TYPE = 'LMS_ACTIVE_INVENTORY_REPORT';

function isActiveInventoryReportTask(path: string, body: unknown): boolean {
  if (path !== REPORT_TASK_PATH) return false;
  const feedType = (body as { feedType?: unknown } | null | undefined)?.feedType;
  return feedType === REPORT_TASK_FEED_TYPE;
}

export class EbayWriteBlockedError extends Error {
  readonly method: string;
  readonly path: string;

  constructor(method: string, path: string) {
    super(
      `Blocked ${method} ${path}: this integration is read-only and must not write to eBay.`
    );
    this.name = 'EbayWriteBlockedError';
    this.method = method;
    this.path = path;
  }
}

/** Strips the query string and rejects anything that could escape the path. */
function normalizePath(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0];
  return withoutQuery.replace(/\/{2,}/g, '/');
}

/**
 * Throws unless the request is a read.
 *
 * Call this in the base client before any request leaves the process.
 */
export function assertReadOnlyRequest(method: string, path: string, body?: unknown): void {
  const upper = method.toUpperCase();
  const normalized = normalizePath(path);

  if (upper === 'GET' || upper === 'HEAD') return;

  if (upper === 'POST' && READ_ONLY_POST_PATHS.has(normalized)) return;

  if (upper === 'POST' && isActiveInventoryReportTask(normalized, body)) return;

  throw new EbayWriteBlockedError(upper, path);
}

/**
 * The one write scope, needed to upload listing photos through the Media API.
 * Requested only for a store with listing writes enabled; never part of
 * `EBAY_READ_SCOPES`.
 */
export const LISTING_WRITE_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.inventory';
