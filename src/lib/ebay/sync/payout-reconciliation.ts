/**
 * Cross-checks the payouts this sync has stored against eBay's own
 * `payout_summary` -- a reconciliation signal, not a stored domain.
 * `EbayFinanceTransaction`/`EbayPayout` are the source of
 * truth either way; this only surfaces a discrepancy to look at.
 *
 * `seller_funds_summary` returns a *current* funds snapshot with no date
 * parameter.
 * `payout_summary` takes `payoutDate:[from..to]` and returns a period total
 * `{ payoutCount, transactionCount, amount }`. Served from the `apiz` host, so
 * pass a client pointed there.
 *
 * **Why this calls per calendar month.** `payout_summary` can silently
 * truncate `amount` over wider windows while keeping `payoutCount` correct.
 * The check calls it once per UTC calendar month overlapping [from, to] and
 * sums. The comparison is therefore over whole months: pass month-aligned
 * `from`/`to` for an exact match against `stored()`.
 */

import { Decimal } from '@prisma/client/runtime/library';
import type { EbayClient } from '../client';

const PAYOUT_SUMMARY_PATH = '/sell/finances/v1/payout_summary';

export interface PayoutReconciliation {
  ebayCount: number;
  ebayAmount: Decimal;
  storedCount: number;
  storedAmount: Decimal;
  matches: boolean;
  /** Per-month `payout_summary` results, in order, for inspection. */
  months: { month: string; count: number; amount: Decimal }[];
}

/** `payoutDate:[..]` filter for the whole UTC calendar month containing `d`. */
function monthFilter(d: Date): string {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return `payoutDate:[${start.toISOString()}..${end.toISOString()}]`;
}

/** First-of-month dates from the month containing `from` through the one containing `to`. */
function monthsBetween(from: Date, to: Date): Date[] {
  const months: Date[] = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  const endYear = to.getUTCFullYear();
  const endMonth = to.getUTCMonth();
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(new Date(Date.UTC(year, month, 1)));
    month += 1;
    if (month === 12) { month = 0; year += 1; }
  }
  return months;
}

export async function reconcilePayouts(options: {
  client: EbayClient;
  from: Date;
  to: Date;
  /** Count and Decimal-summed amount of EbayPayout rows in [from, to]. */
  stored: () => Promise<{ count: number; amount: Decimal }>;
}): Promise<PayoutReconciliation> {
  const { client, from, to, stored } = options;

  const months: PayoutReconciliation['months'] = [];
  let ebayCount = 0;
  let ebayAmount = new Decimal(0);

  for (const monthStart of monthsBetween(from, to)) {
    const response = (await client.get(PAYOUT_SUMMARY_PATH, {
      query: { filter: monthFilter(monthStart) },
    })) as { payoutCount?: number; amount?: { value?: string } } | null;

    const count = Number(response?.payoutCount ?? 0);
    const amount = new Decimal(response?.amount?.value ?? '0');
    months.push({ month: monthStart.toISOString().slice(0, 7), count, amount });
    ebayCount += count;
    ebayAmount = ebayAmount.plus(amount);
  }

  const { count: storedCount, amount: storedAmount } = await stored();

  return {
    ebayCount,
    ebayAmount,
    storedCount,
    storedAmount,
    matches: ebayCount === storedCount && ebayAmount.equals(storedAmount),
    months,
  };
}
