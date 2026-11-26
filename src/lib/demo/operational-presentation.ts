import { DEMO_DATE } from './config';

/** Compact, public projection of buildDemoData().uploads; regression-tested against the seed. */
export const DEMO_UPLOAD_HISTORY = [
  { id: 1, filename: 'DEMO-generated-sales.csv', type: 'sales', rowCount: 1020 },
  { id: 2, filename: 'DEMO-generated-active.csv', type: 'active', rowCount: 60 },
  { id: 3, filename: 'DEMO-generated-traffic.csv', type: 'traffic', rowCount: 60 },
  { id: 4, filename: 'DEMO-generated-transactions.csv', type: 'transactions', rowCount: 2116 },
  { id: 5, filename: 'DEMO-generated-promoted.csv', type: 'promoted', rowCount: 720 },
].map(record => ({ ...record, createdAt: `${DEMO_DATE}T23:59:59.000Z` }));

export const DEMO_OPERATION_DISABLED = 'Read-only demo. Changes and live integrations are disabled.';

export interface DemoExpenseMetrics {
  revenue: number;
  totalOrders: number;
  ebayFees: number;
  byMonth: Array<{ month: string; finalValueFee: number; perOrderFee: number; otherFee: number }>;
}

/** Same canonical fee ledger used by Market Analysis, without the legacy PDF fallback. */
export function demoExpenseFeeMonths(metrics: DemoExpenseMetrics) {
  return metrics.byMonth.map(month => ({
    month: month.month,
    finalValue: month.finalValueFee,
    perOrder: month.perOrderFee,
    flat: month.otherFee,
    total: (Math.round(month.finalValueFee * 100) + Math.round(month.perOrderFee * 100) + Math.round(month.otherFee * 100)) / 100,
  }));
}
