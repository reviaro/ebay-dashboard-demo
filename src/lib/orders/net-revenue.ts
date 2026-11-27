/** Finance figures /api/orders returns alongside the order list. */
export interface OrderFinanceStats {
  proceedsAfterFees?: number;
  ebayFees?: number;
  refundTotal?: number;
}

/**
 * Net revenue for a set of orders: eBay sale proceeds (already net of eBay
 * fees) minus refunds. This is the same definition the dashboard and the
 * Profit page use (`netRevenue` in src/lib/finance/summary.ts), so the
 * Orders card agrees with them for the same period.
 *
 * Returns null when no finance rows were synced for the period: proceeds of 0
 * with no fees means the ledger is missing, not that the orders earned nothing.
 */
export function orderNetRevenue(stats: OrderFinanceStats | undefined): number | null {
  const proceeds = stats?.proceedsAfterFees ?? 0;
  if (!stats || (proceeds === 0 && (stats.ebayFees ?? 0) === 0)) return null;
  return proceeds - (stats.refundTotal ?? 0);
}
