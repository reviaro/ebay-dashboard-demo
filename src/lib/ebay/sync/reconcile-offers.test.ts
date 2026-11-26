import { describe, expect, it } from 'vitest';
import { reconcileOffers } from './reconcile-offers';

const now = new Date('2026-09-11T03:00:00.000Z');
const listing = (id: string, quantity = 1, price = 100) => ({
  listingId: id, price, currency: 'USD', quantity, sku: null,
});

describe('reconcileOffers', () => {
  it('records everything the report contains as active', () => {
    const result = reconcileOffers({
      report: [listing('A'), listing('B')], known: [], soldListingIds: new Set(), now,
    });

    expect(result.map(o => [o.listingId, o.status])).toEqual([['A', 'active'], ['B', 'active']]);
    expect(result[0].lastSeenAt).toEqual(now);
  });

  it('takes price and quantity from the report, which is authoritative', () => {
    const [offer] = reconcileOffers({
      report: [listing('A', 3, 149.99)],
      known: [{ listingId: 'A', status: 'active', price: 99, quantity: 1 }],
      soldListingIds: new Set(), now,
    });

    expect(offer).toMatchObject({ price: 149.99, quantity: 3, status: 'active' });
  });

  describe('a listing that has dropped out of the report', () => {
    // Absence alone does not establish a sale; a matching order is required.
    it('is sold when a sale references it', () => {
      const [offer] = reconcileOffers({
        report: [],
        known: [{ listingId: 'A', status: 'active', price: 100, quantity: 1 }],
        soldListingIds: new Set(['A']), now,
      });

      expect(offer.status).toBe('sold');
    });

    it('is ended, not sold, when nothing ever sold it', () => {
      const [offer] = reconcileOffers({
        report: [],
        known: [{ listingId: 'A', status: 'active', price: 100, quantity: 1 }],
        soldListingIds: new Set(), now,
      });

      expect(offer.status).toBe('ended');
    });

    it('keeps the last price and quantity seen rather than zeroing them', () => {
      const [offer] = reconcileOffers({
        report: [],
        known: [{ listingId: 'A', status: 'active', price: 129.99, quantity: 2 }],
        soldListingIds: new Set(), now,
      });

      expect(offer).toMatchObject({ price: 129.99, quantity: 2 });
    });

    // lastSeenAt is when the report last *contained* it, so it must not move
    // on a run that did not see it.
    it('does not advance lastSeenAt', () => {
      const seen = new Date('2026-09-04T03:00:00.000Z');
      const [offer] = reconcileOffers({
        report: [],
        known: [{ listingId: 'A', status: 'active', price: 100, quantity: 1, lastSeenAt: seen }],
        soldListingIds: new Set(), now,
      });

      expect(offer.lastSeenAt).toEqual(seen);
    });
  });

  it('reactivates a listing that comes back', () => {
    const [offer] = reconcileOffers({
      report: [listing('A')],
      known: [{ listingId: 'A', status: 'ended', price: 100, quantity: 0 }],
      soldListingIds: new Set(), now,
    });

    expect(offer).toMatchObject({ status: 'active', lastSeenAt: now });
  });

  it('leaves an already-sold listing sold', () => {
    const [offer] = reconcileOffers({
      report: [],
      known: [{ listingId: 'A', status: 'sold', price: 100, quantity: 0 }],
      soldListingIds: new Set(['A']), now,
    });

    expect(offer.status).toBe('sold');
  });

  it('returns one row per listing, never a duplicate', () => {
    const result = reconcileOffers({
      report: [listing('A'), listing('B')],
      known: [{ listingId: 'A', status: 'active', price: 1, quantity: 1 }],
      soldListingIds: new Set(), now,
    });

    expect(result).toHaveLength(2);
    expect(new Set(result.map(o => o.listingId)).size).toBe(2);
  });
});
