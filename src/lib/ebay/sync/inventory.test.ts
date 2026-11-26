import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { syncInventory, InventorySyncError } from './inventory';

const XML = `<?xml version="1.0"?><BulkDataExchangeResponses><ActiveInventoryReport>
<SKUDetails><Price currencyID="USD">10.00</Price><Quantity>1</Quantity><ItemID>111</ItemID></SKUDetails>
</ActiveInventoryReport></BulkDataExchangeResponses>`;
const ARCHIVE = zipSync({ 'report.xml': strToU8(XML) });

/** A client that walks the task from CREATED to COMPLETED. */
function fakeClient(statuses: string[], archive: Uint8Array = ARCHIVE) {
  let poll = 0;
  return {
    request: vi.fn().mockResolvedValue(null),
    get: vi.fn(async (path: string) => {
      if (path.includes('download_result_file')) return archive;
      const status = statuses[Math.min(poll++, statuses.length - 1)];
      return { tasks: [{ taskId: 'task-1', status, creationDate: '2026-09-04T18:00:00Z' }] };
    }),
  };
}

const opts = { sleep: async () => {}, now: () => new Date('2026-09-11T03:00:00Z') };

describe('syncInventory', () => {
  it('creates the report task, waits for it, and returns the listings', async () => {
    const client = fakeClient(['COMPLETED']);

    const result = await syncInventory({ client: client as never, ...opts });

    expect(client.request).toHaveBeenCalledWith('POST', '/sell/feed/v1/inventory_task', {
      body: { feedType: 'LMS_ACTIVE_INVENTORY_REPORT', schemaVersion: '1.0' },
    });
    expect(result.listings).toEqual([
      { listingId: '111', price: 10, currency: 'USD', quantity: 1, sku: null },
    ]);
    expect(result.taskId).toBe('task-1');
  });

  it('keeps polling while the report is still being generated', async () => {
    const client = fakeClient(['IN_PROCESS', 'IN_PROCESS', 'COMPLETED']);

    const result = await syncInventory({ client: client as never, ...opts });

    expect(result.listings).toHaveLength(1);
  });

  // Better to fail loudly than to return an empty snapshot: an empty report is
  // indistinguishable from "the seller listed nothing", which would mark every
  // listing ended.
  it('gives up rather than returning nothing when the task never completes', async () => {
    const client = fakeClient(['IN_PROCESS']);

    await expect(syncInventory({ client: client as never, ...opts, maxPolls: 3 }))
      .rejects.toThrow(InventorySyncError);
  });

  it('fails when the task reports an error', async () => {
    const client = fakeClient(['COMPLETED_WITH_ERROR']);

    await expect(syncInventory({ client: client as never, ...opts }))
      .rejects.toThrow(InventorySyncError);
  });

  it('downloads the result from the task endpoint as bytes', async () => {
    const client = fakeClient(['COMPLETED']);

    await syncInventory({ client: client as never, ...opts });

    expect(client.get).toHaveBeenCalledWith(
      '/sell/feed/v1/task/task-1/download_result_file',
      { responseType: 'bytes' }
    );
  });
});
