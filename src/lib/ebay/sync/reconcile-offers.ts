/**
 * Turns one Active Inventory Report into the state of every listing we know.
 *
 * The report is a *full snapshot* of what is currently listed, so a listing's
 * absence is meaningful — which is what makes inactive detection a single pass
 * here rather than the two the plan anticipated for a paginated API.
 *
 * Absence alone does not mean sold. A missing listing may have ended or been
 * withdrawn without a sale. A matching order distinguishes sold listings
 * from other ended listings, hence three states rather than two.
 */

import type { ReportListing } from '../mappers/active-inventory-report';

export type OfferStatus = 'active' | 'sold' | 'ended';

export interface KnownOffer {
  listingId: string;
  status: string;
  price: number;
  quantity: number;
  sku?: string | null;
  lastSeenAt?: Date;
}

export interface OfferState {
  listingId: string;
  sku: string | null;
  price: number;
  currency: string;
  quantity: number;
  status: OfferStatus;
  /** When the report last actually contained this listing. */
  lastSeenAt: Date | undefined;
}

export function reconcileOffers(input: {
  report: ReportListing[];
  known: KnownOffer[];
  /** Listing ids with a matching sale, from `Sale` and `EbayOrder` line items. */
  soldListingIds: ReadonlySet<string>;
  now: Date;
}): OfferState[] {
  const { report, known, soldListingIds, now } = input;

  const inReport = new Map(report.map((listing) => [listing.listingId, listing]));
  const byId = new Map<string, OfferState>();

  // Everything currently listed: the report wins on price and quantity, and
  // a listing that reappears becomes active again.
  for (const listing of report) {
    byId.set(listing.listingId, {
      listingId: listing.listingId,
      sku: listing.sku,
      price: listing.price,
      currency: listing.currency,
      quantity: listing.quantity,
      status: 'active',
      lastSeenAt: now,
    });
  }

  for (const offer of known) {
    if (inReport.has(offer.listingId)) continue;

    byId.set(offer.listingId, {
      listingId: offer.listingId,
      sku: offer.sku ?? null,
      // The last figures the report gave. Zeroing them would lose the price
      // the listing actually carried while it was live.
      price: offer.price,
      currency: 'USD',
      quantity: offer.quantity,
      status: soldListingIds.has(offer.listingId) ? 'sold' : 'ended',
      // Deliberately not advanced: this is when the report last held it.
      lastSeenAt: offer.lastSeenAt,
    });
  }

  return [...byId.values()];
}
