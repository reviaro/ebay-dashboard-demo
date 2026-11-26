import { describe, it, expect } from 'vitest';
import { assertReadOnlyRequest, EbayWriteBlockedError, EBAY_READ_SCOPES } from './read-only';

describe('assertReadOnlyRequest', () => {
  it('allows GET on any eBay resource', () => {
    expect(() =>
      assertReadOnlyRequest('GET', '/sell/fulfillment/v1/order')
    ).not.toThrow();
    expect(() =>
      assertReadOnlyRequest('get', '/sell/finances/v1/transaction')
    ).not.toThrow();
  });

  it('blocks the inventory writes that would change live listings', () => {
    expect(() =>
      assertReadOnlyRequest('PUT', '/sell/inventory/v1/inventory_item/SKU-1')
    ).toThrow(/read-only/i);
    expect(() =>
      assertReadOnlyRequest('POST', '/sell/inventory/v1/offer')
    ).toThrow(/read-only/i);
    expect(() =>
      assertReadOnlyRequest('DELETE', '/sell/inventory/v1/offer/123')
    ).toThrow(/read-only/i);
  });

  it('blocks order fulfillment writes', () => {
    expect(() =>
      assertReadOnlyRequest(
        'POST',
        '/sell/fulfillment/v1/order/123/shipping_fulfillment'
      )
    ).toThrow(/read-only/i);
  });

  it('blocks campaign and listing mutations', () => {
    expect(() =>
      assertReadOnlyRequest('POST', '/sell/marketing/v1/ad_campaign')
    ).toThrow(/read-only/i);
    expect(() =>
      assertReadOnlyRequest('PUT', '/sell/marketing/v1/ad_campaign/9/ad/1')
    ).toThrow(/read-only/i);
  });

  it('names the offending method and path so the block is debuggable', () => {
    expect(() =>
      assertReadOnlyRequest('PUT', '/sell/inventory/v1/inventory_item/SKU-1')
    ).toThrow(/PUT \/sell\/inventory\/v1\/inventory_item\/SKU-1/);
  });

  it('permits creating a Promoted Listings report task, the one read-only POST', () => {
    // eBay exposes ad reports only by POSTing a task and polling for the result.
    // It creates a report, not seller data, so it is the sole non-GET exception.
    expect(() =>
      assertReadOnlyRequest('POST', '/sell/marketing/v1/ad_report_task')
    ).not.toThrow();
  });

  it('does not let the report-task exception widen to other marketing paths', () => {
    expect(() =>
      assertReadOnlyRequest('POST', '/sell/marketing/v1/ad_report_task/../ad_campaign')
    ).toThrow(/read-only/i);
    expect(() =>
      assertReadOnlyRequest('POST', '/sell/marketing/v1/ad_report_task_extra')
    ).toThrow(/read-only/i);
  });

  it('blocks deleting a report task, since deletion is optional for reads', () => {
    expect(() =>
      assertReadOnlyRequest('DELETE', '/sell/marketing/v1/ad_report_task/77')
    ).toThrow(/read-only/i);
  });

  it('blocks creating notification subscriptions, which write eBay-side config', () => {
    expect(() =>
      assertReadOnlyRequest('POST', '/commerce/notification/v1/subscription')
    ).toThrow(/read-only/i);
  });
});

describe('EBAY_READ_SCOPES', () => {
  it('requests no scope that grants write access', () => {
    const writeScopes = EBAY_READ_SCOPES.filter((scope) => {
      const leaf = scope.split('/').pop() ?? '';
      if (leaf === 'api_scope') return false; // base scope, read-only
      if (leaf.endsWith('.readonly')) return false;
      // sell.finances has no .readonly variant; the scope is read-only by design.
      return leaf !== 'sell.finances';
    });
    expect(writeScopes).toEqual([]);
  });

  it('covers every domain the sync plan reads', () => {
    const joined = EBAY_READ_SCOPES.join(' ');
    expect(joined).toContain('sell.fulfillment.readonly');
    expect(joined).toContain('sell.inventory.readonly');
    expect(joined).toContain('sell.analytics.readonly');
    expect(joined).toContain('sell.marketing.readonly');
    expect(joined).toContain('sell.finances');
  });

  it('lists each scope once', () => {
    expect(new Set(EBAY_READ_SCOPES).size).toBe(EBAY_READ_SCOPES.length);
  });

});


// The Active Inventory Report includes listings created through the web UI,
// which Sell Inventory does not cover. Reaching the report means one POST.
describe('the Active Inventory Report task', () => {
  const REPORT = { feedType: 'LMS_ACTIVE_INVENTORY_REPORT' };

  it('allows the download task that produces the report', () => {
    expect(() =>
      assertReadOnlyRequest('POST', '/sell/feed/v1/inventory_task', REPORT)
    ).not.toThrow();
  });

  // eBay accepts exactly one feed type here today. Pinning it means a feed
  // type added later -- an upload one, say -- cannot inherit this exception
  // just by arriving on a path we already trust.
  it('refuses any other feed type on the same path', () => {
    expect(() =>
      assertReadOnlyRequest('POST', '/sell/feed/v1/inventory_task', { feedType: 'LMS_ADD_FIXED_PRICE_ITEM' })
    ).toThrow(EbayWriteBlockedError);
  });

  it('refuses the task with no feed type at all', () => {
    expect(() => assertReadOnlyRequest('POST', '/sell/feed/v1/inventory_task')).toThrow(EbayWriteBlockedError);
    expect(() => assertReadOnlyRequest('POST', '/sell/feed/v1/inventory_task', {})).toThrow(EbayWriteBlockedError);
  });

  // The general task endpoint is the dangerous sibling: the SAME POST
  // creates upload feeds that add and revise real listings. It is not, and
  // must never be, on the allow-list.
  it('refuses the general feed task endpoint, which can upload', () => {
    expect(() =>
      assertReadOnlyRequest('POST', '/sell/feed/v1/task', REPORT)
    ).toThrow(EbayWriteBlockedError);
  });

  it('refuses sibling and traversal paths', () => {
    expect(() =>
      assertReadOnlyRequest('POST', '/sell/feed/v1/inventory_task_extra', REPORT)
    ).toThrow(EbayWriteBlockedError);
    expect(() =>
      assertReadOnlyRequest('POST', '/sell/feed/v1/inventory_task/../task', REPORT)
    ).toThrow(EbayWriteBlockedError);
  });

  it('refuses other methods on the report path', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(() =>
        assertReadOnlyRequest(method, '/sell/feed/v1/inventory_task', REPORT)
      ).toThrow(EbayWriteBlockedError);
    }
  });
});
