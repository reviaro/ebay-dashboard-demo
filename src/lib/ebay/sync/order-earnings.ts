/**
 * `order_earnings` eligibility probe + cross-check.
 *
 * This is a *cross-check only* --
 * `EbayFinanceTransaction` stays the profitability source of truth regardless
 * of eligibility. eBay restricts this resource by seller location/marketplace.
 *
 * Use the query-param form
 * `GET /sell/finances/v1/order_earnings?orderId=…` on the `apiz` host; the
 * `/order/{id}/earnings` path form is not supported. A 403 is represented as
 * `eligible: false`. The success branch uses the documented
 * `netAmount.value` response shape.
 */

import { Decimal } from '@prisma/client/runtime/library';
import type { EbayClient } from '../client';

export interface OrderEarningsCheck {
  eligible: boolean;
  /** |eBay-reported net - computed net|, or null when not eligible. */
  discrepancy: Decimal | null;
}

export async function checkOrderEarnings(options: {
  client: EbayClient;
  orderId: string;
  computedNet: Decimal;
}): Promise<OrderEarningsCheck> {
  const { client, orderId, computedNet } = options;

  try {
    const response = (await client.get('/sell/finances/v1/order_earnings', {
      query: { orderId },
    })) as { netAmount?: { value?: string } } | null;

    const reported = new Decimal(response?.netAmount?.value ?? '0');
    return { eligible: true, discrepancy: reported.minus(computedNet).abs() };
  } catch (error) {
    // EbayApiError exposes `.status`, not `.statusCode`. 403 = exists but not
    // permitted for this account; 404 = also treated as "not available here".
    const status = (error as { status?: number }).status;
    if (status === 403 || status === 404) {
      return { eligible: false, discrepancy: null };
    }
    throw error;
  }
}
