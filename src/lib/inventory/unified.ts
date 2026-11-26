/**
 * One inventory list from the CSV upload and the Active Inventory Report.
 *
 * Same shape and precedence as `src/lib/orders/unified.ts`: the API wins on
 * what it knows -- price, quantity, listing status -- and the CSV supplies
 * what the report does not carry at all, which is title, brand, cost, location
 * and the watch/view counts.
 *
 * The report carries three fields per listing. Everything descriptive comes
 * from the CSV, so a listing the API has and the CSV has never seen has no
 * title from anywhere; that is a real state the UI has to render, not an error.
 */

export interface InventoryRow {
  id: number;
  itemId: string | null;
  sku: string | null;
  title: string;
  brand: string;
  price: number;
  cost: number | null;
  quantity: number;
  views: number;
  watchers: number;
  location: string | null;
  /** Included by the demo loader for the retained catalog condition column. */
  condition?: string | null;
}

export interface OfferRow {
  listingId: string;
  sku: string | null;
  price: number;
  currency: string;
  quantity: number;
  status: string;
  lastSeenAt: Date | null;
}

export interface UnifiedInventory {
  key: string;
  source: 'api' | 'csv';
  itemId: string | null;
  sku: string | null;
  title: string;
  brand: string;
  price: number;
  cost: number | null;
  quantity: number;
  views: number;
  watchers: number;
  location: string | null;
  condition?: string | null;
  /** active | sold | ended from the report; `unknown` for CSV-only rows. */
  status: string;
  lastSeenAt: Date | null;
}

const STATUS_ORDER: Record<string, number> = { active: 0, unknown: 1, sold: 2, ended: 3 };

export function mergeInventory(
  rows: InventoryRow[],
  offers: OfferRow[],
  /**
   * Listing ids with a matching sale. Supplied, a CSV row the report does not
   * list is classified sold or ended; omitted, it stays `unknown`.
   *
   * Each "active listings" upload is a snapshot of what was live that day.
   * Combining snapshots creates a historical union rather than current stock.
   * Absence from today's report means the listing is gone, and the sale data
   * distinguishes sold listings from other ended listings.
   */
  soldListingIds?: ReadonlySet<string>
): UnifiedInventory[] {
  const csvByItemId = new Map<string, InventoryRow>();
  for (const row of rows) if (row.itemId) csvByItemId.set(row.itemId, row);

  const merged: UnifiedInventory[] = offers.map((offer) => {
    const csv = csvByItemId.get(offer.listingId);
    return {
      key: offer.listingId,
      source: 'api',
      itemId: offer.listingId,
      sku: offer.sku ?? csv?.sku ?? null,
      title: csv?.title ?? '',
      brand: csv?.brand?.trim() || 'Unknown',
      price: offer.price,
      cost: csv?.cost ?? null,
      quantity: offer.quantity,
      views: csv?.views ?? 0,
      watchers: csv?.watchers ?? 0,
      location: csv?.location ?? null,
      ...(csv?.condition !== undefined ? { condition: csv.condition } : {}),
      status: offer.status,
      lastSeenAt: offer.lastSeenAt,
    };
  });

  const claimed = new Set(offers.map((offer) => offer.listingId));
  for (const row of rows) {
    if (row.itemId && claimed.has(row.itemId)) continue;
    merged.push({
      // Rows with no itemId cannot be keyed on one without collapsing together.
      key: row.itemId || `inv:${row.id}`,
      source: 'csv',
      itemId: row.itemId,
      sku: row.sku,
      title: row.title,
      brand: row.brand,
      price: row.price,
      cost: row.cost,
      quantity: row.quantity,
      views: row.views,
      watchers: row.watchers,
      location: row.location,
      ...(row.condition !== undefined ? { condition: row.condition } : {}),
      status: !soldListingIds
        ? 'unknown'
        : row.itemId && soldListingIds.has(row.itemId)
          ? 'sold'
          : 'ended',
      lastSeenAt: null,
    });
  }

  return merged.sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      b.watchers - a.watchers
  );
}
