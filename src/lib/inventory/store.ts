/**
 * Loads the merged inventory list.
 *
 * Kept apart from `unified.ts` so the merge stays pure. Every reader of
 * inventory should come through here: if `/inventory` shows API prices while
 * the dashboard totals read the CSV, the two pages disagree.
 */

import prisma from '@/lib/prisma';
import { createPrismaOfferStore } from '@/lib/ebay/sync/prisma-offer-writer';
import { mergeInventory, type InventoryRow, type UnifiedInventory } from './unified';
import { isDemoMode } from '@/lib/demo/server';

export async function loadUnifiedInventory(): Promise<UnifiedInventory[]> {
  // The sale data is what separates "sold" from "no longer listed" among the
  // rows the report does not mention. Both sources are needed: the CSV reaches
  // back to 2025, the API only 90 days.
  const [inventory, offers, soldListingIds, drafts] = await Promise.all([
    prisma.inventory.findMany({
      select: {
        id: true, itemId: true, sku: true, title: true, brand: true,
        price: true, cost: true, quantity: true, views: true, watchers: true, location: true,
        ...(isDemoMode() ? { condition: true } : {}),
      },
    }),
    prisma.ebayOffer.findMany({
      select: {
        listingId: true, sku: true, price: true, currency: true,
        quantity: true, status: true, lastSeenAt: true,
      },
    }),
    createPrismaOfferStore(prisma).soldListingIds(),
    prisma.listingDraft.findMany({ where: { listingId: { not: null }, publishedPayload: { not: null } }, select: { listingId: true, publishedPayload: true } }),
  ]);

  const rows: InventoryRow[] = inventory;
  const known = new Set(rows.map(row => row.itemId));
  for (const draft of drafts) {
    if (!draft.listingId || !draft.publishedPayload || known.has(draft.listingId)) continue;
    const payload = JSON.parse(draft.publishedPayload) as { sku: string; title: string; specifics: { name: string; value: string }[]; price: string; quantity: number };
    rows.push({ id: -1, itemId: draft.listingId, sku: payload.sku, title: payload.title, brand: payload.specifics.find(s => s.name.toLowerCase() === 'brand')?.value || 'Unknown', price: Number(payload.price), quantity: payload.quantity, cost: null, location: null, views: 0, watchers: 0 });
  }
  return mergeInventory(rows, offers, soldListingIds);
}

/** Case-insensitive, matching the SQL LIKE the Prisma query used. */
export function filterInventory(rows: UnifiedInventory[], search: string): UnifiedInventory[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return rows;

  return rows.filter(
    (row) =>
      row.title.toLowerCase().includes(needle) ||
      row.brand.toLowerCase().includes(needle) ||
      (row.sku ?? '').toLowerCase().includes(needle)
  );
}
