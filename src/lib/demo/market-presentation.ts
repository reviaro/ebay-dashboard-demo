/** Presentation-only reconciliation of the read-only profitability response. */
export interface DemoMarketFinancials {
  grossOfFees: number;
  ebayFees: number;
  refunds: number;
  shippingLabels: number;
  adFees: number;
  netPayout: number;
}

const cents = (value: number) => Math.round(value * 100);

export function demoMarketCashSummary(
  financials: DemoMarketFinancials,
  inventoryPurchases: number,
  operatingExpenses: number,
) {
  const gross = cents(financials.grossOfFees);
  const marketplaceFees = cents(financials.ebayFees);
  const refunds = cents(financials.refunds);
  const postage = cents(financials.shippingLabels);
  const advertising = cents(financials.adFees);
  const settlement = cents(financials.netPayout);
  // `otherFees` includes fees already in ebayFees. Reconcile the remaining
  // ledger deduction instead, so no SALE fee or credit is counted twice.
  const otherLedgerCosts = gross - marketplaceFees - refunds - postage - advertising - settlement;
  const purchases = cents(inventoryPurchases);
  const overhead = cents(operatingExpenses);
  const cashAfterExpenses = settlement - purchases - overhead;
  return {
    grossRevenue: gross / 100,
    marketplaceFees: marketplaceFees / 100,
    refunds: refunds / 100,
    postage: postage / 100,
    advertising: advertising / 100,
    otherLedgerCosts: otherLedgerCosts / 100,
    settlement: settlement / 100,
    inventoryPurchases: purchases / 100,
    operatingExpenses: overhead / 100,
    cashAfterExpenses: cashAfterExpenses / 100,
  };
}
