/**
 * Fetches transactions and payouts from the Sell Finances API.
 *
 * The `client` passed in must be pointed at `config.financeApiBaseUrl`
 * (`apiz.ebay.com`) -- these paths 404 on the ordinary `api.ebay.com` host.
 * `run-finance.ts` / `run-payout.ts` build that client.
 *
 * Both endpoints paginate via a `next` link and report `total` -- eBay's own
 * count of matching records -- **whenever a `filter` is supplied** (an
 * unfiltered call omits it). These fetchers always send a
 * date filter, so `total` is present, and collecting fewer than `total` after
 * following every `next` link means something was lost mid-pagination: a fetch
 * error, not a legitimately-empty window (a quiet period returns `total: 0`).
 * If eBay ever omits `total` the completeness check is skipped rather than
 * firing a false positive.
 */

import type { EbayClient } from '../client';
import { mapFinanceTransaction, type MappedFinanceTransaction } from '../mappers/finance-transaction';
import { mapPayout, type MappedPayout } from '../mappers/payout';

const TRANSACTION_PATH = '/sell/finances/v1/transaction';
const PAYOUT_PATH = '/sell/finances/v1/payout';
const PAGE_LIMIT = 200;

export class FinanceFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceFetchError';
  }
}

/** eBay's date filter: `transactionDate:[2026-06-01T00:00:00.000Z..2026-06-02T23:59:59.999Z]`. */
function dateFilter(field: string, from: Date, to: Date): string {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 999));
  return `${field}:[${start.toISOString()}..${end.toISOString()}]`;
}

interface RawPage {
  total?: number;
  transactions?: unknown[];
  payouts?: unknown[];
  next?: string;
}

function completenessError(kind: string, from: Date, to: Date, total: number, got: number): FinanceFetchError {
  return new FinanceFetchError(
    `eBay reported ${total} ${kind}(s) for ${from.toISOString().slice(0, 10)}..` +
      `${to.toISOString().slice(0, 10)} but pagination returned ${got}.`
  );
}

export async function fetchTransactionWindow(options: {
  client: EbayClient;
  accountId: string;
  marketplaceId: string;
  from: Date;
  to: Date;
}): Promise<MappedFinanceTransaction[]> {
  const { client, accountId, marketplaceId, from, to } = options;

  const rows: MappedFinanceTransaction[] = [];
  let offset = 0;
  let total: number | null = null;

  for (;;) {
    // eBay answers an empty window with a bare `null` body, which the client
    // passes straight through -- treat that as a page with no rows.
    const page = ((await client.get(TRANSACTION_PATH, {
      query: { filter: dateFilter('transactionDate', from, to), limit: PAGE_LIMIT, offset },
    })) ?? {}) as RawPage;

    if (total === null && Number.isFinite(Number(page.total))) total = Number(page.total);

    for (const raw of page.transactions ?? []) {
      rows.push(mapFinanceTransaction(raw, accountId, marketplaceId));
    }

    if (!page.next) break;
    offset += PAGE_LIMIT;
  }

  if (total !== null && rows.length !== total) {
    throw completenessError('transaction', from, to, total, rows.length);
  }

  return rows;
}

export async function fetchPayoutWindow(options: {
  client: EbayClient;
  accountId: string;
  from: Date;
  to: Date;
}): Promise<MappedPayout[]> {
  const { client, accountId, from, to } = options;

  const rows: MappedPayout[] = [];
  let offset = 0;
  let total: number | null = null;

  for (;;) {
    const page = ((await client.get(PAYOUT_PATH, {
      query: { filter: dateFilter('payoutDate', from, to), limit: PAGE_LIMIT, offset },
    })) ?? {}) as RawPage;

    if (total === null && Number.isFinite(Number(page.total))) total = Number(page.total);

    for (const raw of page.payouts ?? []) {
      rows.push(mapPayout(raw, accountId));
    }

    if (!page.next) break;
    offset += PAGE_LIMIT;
  }

  if (total !== null && rows.length !== total) {
    throw completenessError('payout', from, to, total, rows.length);
  }

  return rows;
}
