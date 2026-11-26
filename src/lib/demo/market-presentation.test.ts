import { describe, expect, it } from 'vitest';
import { buildDemoData, cents } from './data';
import { demoMarketCashSummary } from './market-presentation';

const seed = buildDemoData();
const sum = <T>(rows: T[], value: (row: T) => number) => rows.reduce((total, row) => total + cents(value(row)), 0) / 100;

const sales = seed.finance.filter(row => row.transactionType === 'SALE');
const saleFees = sum(sales, row => JSON.parse(row.feeDetails!).reduce((total: number, fee: { amount: string }) => total + Number(fee.amount), 0));
const financials = {
  grossOfFees: sum(seed.sales, row => row.soldFor! + row.shipping!),
  ebayFees: saleFees,
  refunds: sum(seed.finance.filter(row => row.transactionType === 'REFUND'), row => Number(row.amount)),
  shippingLabels: sum(seed.finance.filter(row => row.transactionType === 'SHIPPING_LABEL'), row => Number(row.amount)),
  adFees: sum(seed.finance.filter(row => row.transactionType === 'NON_SALE_CHARGE' && JSON.parse(row.rawPayload).feeType === 'AD_FEE'), row => Number(row.amount)),
  netPayout: sum(seed.finance, row => (row.bookingEntry === 'CREDIT' ? 1 : -1) * Number(row.amount)),
};

describe('restored Market demo cash summary', () => {
  it('reconciles the full seeded ledger without adding shipping revenue a second time', () => {
    const purchases = sum(seed.inventoryExpenses, row => row.amount);
    const operating = sum(seed.generalExpenses, row => row.amount);
    const summary = demoMarketCashSummary(financials, purchases, operating);
    const nonAdCosts = sum(seed.finance.filter(row => row.transactionType === 'NON_SALE_CHARGE' && JSON.parse(row.rawPayload).feeType !== 'AD_FEE'), row => Number(row.amount));
    expect(summary.otherLedgerCosts).toBe(nonAdCosts);
    expect(cents(summary.cashAfterExpenses)).toBe(cents(financials.netPayout) - cents(purchases) - cents(operating));
    expect(cents(summary.grossRevenue)).toBe(
      cents(summary.cashAfterExpenses) + cents(summary.marketplaceFees) + cents(summary.refunds)
      + cents(summary.postage) + cents(summary.advertising) + cents(summary.otherLedgerCosts)
      + cents(summary.inventoryPurchases) + cents(summary.operatingExpenses),
    );
    expect(summary.postage).toBeGreaterThan(0);
    expect(summary.advertising).toBeGreaterThan(0);
    expect(summary.refunds).toBeGreaterThan(0);
  });

  it('does not double-subtract a SALE fee that is included in otherFees upstream', () => {
    // A $15 sale fee can contain an "other" component. The UI relies on
    // settlement, not on upstream otherFees which overlaps that $15.
    const summary = demoMarketCashSummary({ grossOfFees: 120, ebayFees: 15, refunds: 3, shippingLabels: 7, adFees: 5, netPayout: 88 }, 20, 4);
    expect(summary.otherLedgerCosts).toBe(2);
    expect(summary.cashAfterExpenses).toBe(64);
  });

  it('preserves ledger credits and zero/negative cash results', () => {
    const summary = demoMarketCashSummary({ grossOfFees: 100, ebayFees: 10, refunds: 0, shippingLabels: 0, adFees: 0, netPayout: 92 }, 100, 2);
    expect(summary.otherLedgerCosts).toBe(-2);
    expect(summary.cashAfterExpenses).toBe(-10);
  });
});
