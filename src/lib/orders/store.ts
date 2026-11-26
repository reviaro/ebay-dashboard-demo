/**
 * Loads the merged order list.
 *
 * Kept apart from `unified.ts` so the merge itself stays pure and testable
 * without a database. Every reader of order history goes through here -- if
 * one route reads `Sale` directly while another reads the merged list, the
 * orders page and the dashboard will quietly disagree.
 */

import prisma from '@/lib/prisma';
import { mergeOrders, type UnifiedOrder } from './unified';

export async function loadUnifiedOrders(): Promise<UnifiedOrder[]> {
  const [sales, orders] = await Promise.all([
    prisma.sale.findMany({
      select: {
        id: true,
        orderNumber: true,
        saleDate: true,
        itemTitle: true,
        brand: true,
        itemNumber: true,
        soldFor: true,
        shipping: true,
        eBayTax: true,
        totalPrice: true,
        shipToState: true,
        shipToCountry: true,
        promoted: true,
        quantity: true,
      },
    }),
    prisma.ebayOrder.findMany({
      select: {
        id: true,
        creationDate: true,
        orderFulfillmentStatus: true,
        orderPaymentStatus: true,
        pricingSummary: true,
        lineItems: true,
      },
    }),
  ]);

  return mergeOrders(sales, orders);
}
