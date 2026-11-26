import { withStoreData } from '@/lib/stores/context';
/**
 * Persists reconciled offers, and supplies the facts reconciliation needs.
 *
 * `soldListingIds` is drawn from both sale sources -- CSV `Sale.itemNumber`
 * and `EbayOrder` line items -- because neither alone covers the history:
 * the CSV reaches back to 2025 while the API only holds 90 days, and the
 * distinction decides whether a vanished listing reads as sold or as ended.
 */

import type { PrismaClient } from '@prisma/client';
import type { KnownOffer, OfferState } from './reconcile-offers';

export interface OfferStore {
  known(): Promise<KnownOffer[]>;
  soldListingIds(): Promise<Set<string>>;
  save(offers: OfferState[], syncedAt: Date): Promise<number>;
}

export function createPrismaOfferStore(prisma: PrismaClient): OfferStore {
  return {
    async known(): Promise<KnownOffer[]> {
      const rows = await prisma.ebayOffer.findMany();
      return rows.map((row) => ({
        listingId: row.listingId,
        status: row.status,
        price: row.price,
        quantity: row.quantity,
        sku: row.sku,
        lastSeenAt: row.lastSeenAt ?? undefined,
      }));
    },

    async soldListingIds(): Promise<Set<string>> {
      const [sales, orders] = await Promise.all([
        prisma.sale.findMany({ select: { itemNumber: true } }),
        prisma.ebayOrder.findMany({ select: { lineItems: true } }),
      ]);

      const ids = new Set<string>();
      for (const sale of sales) if (sale.itemNumber) ids.add(sale.itemNumber);
      for (const order of orders) {
        for (const item of JSON.parse(order.lineItems) as Array<{ legacyItemId?: string }>) {
          if (item.legacyItemId) ids.add(item.legacyItemId);
        }
      }
      return ids;
    },

    async save(offers: OfferState[], syncedAt: Date): Promise<number> {
      for (const offer of offers) {
        const fields = {
          sku: offer.sku,
          price: offer.price,
          currency: offer.currency,
          quantity: offer.quantity,
          status: offer.status,
          lastSeenAt: offer.lastSeenAt ?? null,
          syncedAt,
        };
        await prisma.ebayOffer.upsert({
          where: { storeId_listingId: withStoreData({ listingId: offer.listingId }) },
          create: withStoreData({ listingId: offer.listingId, ...fields }),
          update: fields,
        });
      }
      return offers.length;
    },
  };
}
