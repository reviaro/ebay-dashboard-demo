/**
 * Fetches the seller's live listings via the Active Inventory Report.
 *
 * The report includes listings created in eBay's web UI, which Sell Inventory
 * does not cover. Generation is asynchronous: create a task, wait for it,
 * download a ZIP.
 *
 * The single POST it issues is the one the read-only guard permits, pinned by
 * path and feed type. Every other call here is a GET.
 */

import type { EbayClient } from '../client';
import { parseActiveInventoryReport, type ReportListing } from '../mappers/active-inventory-report';

export class InventorySyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventorySyncError';
  }
}

const FEED_TYPE = 'LMS_ACTIVE_INVENTORY_REPORT';
const TASK_PATH = '/sell/feed/v1/inventory_task';
const DEFAULT_MAX_POLLS = 30;
const DEFAULT_POLL_MS = 2_000;

interface TaskRow {
  taskId?: string;
  status?: string;
  creationDate?: string;
}

export interface SyncInventoryResult {
  listings: ReportListing[];
  taskId: string;
}

export async function syncInventory(options: {
  client: EbayClient;
  maxPolls?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}): Promise<SyncInventoryResult> {
  const {
    client,
    maxPolls = DEFAULT_MAX_POLLS,
    pollMs = DEFAULT_POLL_MS,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  } = options;

  // The only write-shaped call in the integration, and it creates a report
  // that belongs to us. See read-only.ts.
  await client.request('POST', TASK_PATH, {
    body: { feedType: FEED_TYPE, schemaVersion: '1.0' },
  });

  // The POST returns no body, and the task id arrives in a Location header the
  // client does not surface. Listing newest-first is equivalent here because
  // the sync lease guarantees only one inventory run at a time.
  let task: TaskRow | undefined;
  for (let poll = 0; poll < maxPolls; poll++) {
    const page = (await client.get(TASK_PATH, {
      query: { feed_type: FEED_TYPE, limit: '1' },
    })) as { tasks?: TaskRow[] };

    task = page.tasks?.[0];
    const status = task?.status;

    if (status === 'COMPLETED') break;
    if (status && status !== 'IN_PROCESS' && status !== 'CREATED' && status !== 'QUEUED') {
      throw new InventorySyncError(`The inventory report task ended as ${status}.`);
    }

    task = undefined;
    await sleep(pollMs);
  }

  if (!task?.taskId) {
    // Deliberately an error, not an empty result: an empty snapshot is
    // indistinguishable from "this seller lists nothing", and would mark every
    // listing we know as ended.
    throw new InventorySyncError(
      `The inventory report did not complete after ${maxPolls} checks.`
    );
  }

  const archive = await client.get<Uint8Array>(
    `/sell/feed/v1/task/${task.taskId}/download_result_file`,
    { responseType: 'bytes' }
  );

  return { listings: parseActiveInventoryReport(archive), taskId: task.taskId };
}
