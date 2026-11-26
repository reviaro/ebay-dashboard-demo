import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildDemoData, cents } from './data';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const data = buildDemoData();
const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);

describe('synthetic demo fixtures', () => {
  it('has repeatable content, identifiers and every fixed timestamp', () => {
    expect(hash(buildDemoData())).toBe(hash(data));
    expect(data.inventory).toHaveLength(60);
    expect(data.orders).toHaveLength(1020);
    expect(data.trafficDays).toHaveLength(365);
    expect(data.trafficListings).toHaveLength(21900);
    expect(data.orders.every(row => row.id?.startsWith('DEMO-'))).toBe(true);
    expect(data.inventory.every(row => row.price >= 15 && row.price <= 600)).toBe(true);
    expect(data.inventory.filter(row => row.price < 150).length).toBeGreaterThan(30);
  });
  it('contains no connected accounts, OAuth state, buyer identity or enabled syncs', () => {
    expect(data.orders.every(row => row.buyerUsername === null && row.buyerEmail === null && row.sellerId === null)).toBe(true);
    expect(data.syncSettings.every(row => row.enabled === false && row.nextRunAt === null)).toBe(true);
    expect(data.finance.every(row => row.accountId === 'DEMO-FICTIONAL-STORE')).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/https?:\/\//);
  });
  it('reconciles each payout and all billed advertising to the cent', () => {
    for (const payout of data.payouts) {
      const entries = data.finance.filter(row => row.payoutId === payout.id);
      const amount = sum(entries, row => (row.transactionType === 'SALE' ? 1 : -1) * cents(Number(row.amount)));
      expect(amount).toBe(cents(Number(payout.amount)));
      expect(entries).toHaveLength(payout.transactionCount!);
    }
    const ads = data.finance.filter(row => row.transactionType === 'NON_SALE_CHARGE' && JSON.parse(row.rawPayload).feeType === 'AD_FEE');
    expect(sum(ads, row => cents(Number(row.amount)))).toBe(sum(data.adReports, row => cents(row.adSpend!)));
    expect(sum(data.transactions.filter(row => row.type !== 'Payout'), row => cents(row.netAmount!))).toBe(sum(data.payouts, row => cents(Number(row.amount))));
  });
  it('keeps return rate plausible and statuses tied to real synthetic refund entries', () => {
    const refunds = data.finance.filter(row => row.transactionType === 'REFUND');
    expect(refunds).toHaveLength(40);
    expect(refunds.length / data.orders.length).toBeGreaterThanOrEqual(0.03);
    expect(refunds.length / data.orders.length).toBeLessThanOrEqual(0.05);
    for (const refund of refunds) expect(data.orders.find(order => order.id === refund.orderId)?.orderPaymentStatus).toBe('FULLY_REFUNDED');
  });
  it('ties full-year daily traffic transactions to sales', () => {
    expect(sum(data.trafficDays, row => row.transactions!)).toBe(data.orders.length);
    expect(sum(data.trafficListings, row => row.transactions!)).toBe(data.orders.length);
    expect(sum(data.trafficDays, row => row.viewsTotal!)).toBe(sum(data.trafficListings, row => row.viewsTotal!));
    expect(sum(data.trafficDays, row => row.impressionsTotal!)).toBe(sum(data.trafficListings, row => row.impressionsTotal!));
  });
});
