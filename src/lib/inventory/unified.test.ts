import { describe, expect, it } from 'vitest';
import { mergeInventory, type InventoryRow, type OfferRow } from './unified';

const csv = (o: Partial<InventoryRow> = {}): InventoryRow => ({
  id: 1, itemId: '111', sku: null, title: 'Volvo XC90 Headlight', brand: 'Volvo',
  price: 100, cost: 40, quantity: 1, views: 5, watchers: 2, location: 'Stafford', ...o,
});
const offer = (o: Partial<OfferRow> = {}): OfferRow => ({
  listingId: '111', sku: null, price: 149.99, currency: 'USD', quantity: 3,
  status: 'active', lastSeenAt: new Date('2026-09-11T03:00:00Z'), ...o,
});

describe('mergeInventory', () => {
  it('takes price, quantity and status from the API where both know a listing', () => {
    const [row] = mergeInventory([csv()], [offer()]);

    expect(row).toMatchObject({
      itemId: '111', price: 149.99, quantity: 3, status: 'active', source: 'api',
    });
  });

  it('keeps the title, brand and cost that only the CSV carries', () => {
    const [row] = mergeInventory([csv({ title: 'Volvo XC90 Headlight', brand: 'Volvo', cost: 40 })], [offer()]);

    expect(row).toMatchObject({ title: 'Volvo XC90 Headlight', brand: 'Volvo', cost: 40 });
  });

  it('carries a listing the API has and the CSV has never seen', () => {
    const [row] = mergeInventory([], [offer({ listingId: '999' })]);

    expect(row).toMatchObject({ itemId: '999', source: 'api', status: 'active' });
    // Nothing supplies a title for these; the UI must cope rather than blank.
    expect(row.title).toBe('');
    expect(row.brand).toBe('Unknown');
  });

  // Each "active listings" CSV upload is a snapshot of what was live that day.
  // Combining snapshots creates a historical union, so a row absent from
  // today's report is not current stock.
  describe('a CSV row the report does not list', () => {
    it('is sold when a sale references it', () => {
      const [row] = mergeInventory([csv({ itemId: '222' })], [], new Set(['222']));

      expect(row).toMatchObject({ itemId: '222', source: 'csv', status: 'sold' });
    });

    it('is no longer listed when nothing ever sold it', () => {
      const [row] = mergeInventory([csv({ itemId: '222' })], [], new Set());

      expect(row).toMatchObject({ itemId: '222', source: 'csv', status: 'ended' });
    });

    // Without the sale data there is genuinely no way to tell, and saying so
    // beats guessing either way.
    it('stays unknown when no sale data is supplied at all', () => {
      const [row] = mergeInventory([csv({ itemId: '222' })], []);

      expect(row.status).toBe('unknown');
    });
  });

  it('emits one row per listing', () => {
    expect(mergeInventory([csv()], [offer()])).toHaveLength(1);
  });

  it('keeps CSV rows that have no item id at all', () => {
    const rows = mergeInventory([csv({ id: 1, itemId: null }), csv({ id: 2, itemId: null })], []);

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.key)).size).toBe(2);
  });

  it('puts active listings first, since those are the ones on sale', () => {
    const rows = mergeInventory(
      [csv({ id: 1, itemId: 'a' }), csv({ id: 2, itemId: 'b' })],
      [offer({ listingId: 'b' })],
    );

    expect(rows[0].itemId).toBe('b');
  });
});
