import type { UnifiedOrder } from '@/lib/orders/unified';

type GeographyOrder = Pick<UnifiedOrder, 'shipToCountry' | 'shipToState' | 'soldFor'>;

/** Demo Market uses the full filtered order set, never the truncated topStates list. */
export function demoMarketGeography(orders: GeographyOrder[]) {
  const countries = new Map<string, { country: string; orders: number; revenue: number }>();
  const states = new Map<string, { state: string; orders: number; revenue: number }>();
  let domesticOrders = 0;
  let internationalOrders = 0;
  let unknownCountryOrders = 0;

  for (const order of orders) {
    const country = order.shipToCountry?.trim();
    if (!country || country.toLowerCase() === 'unknown') {
      unknownCountryOrders++;
      continue;
    }
    const countryRow = countries.get(country) ?? { country, orders: 0, revenue: 0 };
    countryRow.orders++;
    countryRow.revenue += order.soldFor;
    countries.set(country, countryRow);

    if (country !== 'United States') {
      internationalOrders++;
      continue;
    }
    domesticOrders++;
    const state = order.shipToState?.trim();
    // Missing locations remain in the domestic denominator, not states reached.
    if (!state || state.toLowerCase() === 'unknown') continue;
    const stateRow = states.get(state) ?? { state, orders: 0, revenue: 0 };
    stateRow.orders++;
    stateRow.revenue += order.soldFor;
    states.set(state, stateRow);
  }

  const countryRows = [...countries.values()]
    .sort((a, b) => b.orders - a.orders || b.revenue - a.revenue || a.country.localeCompare(b.country));
  const stateRows = [...states.values()]
    .sort((a, b) => b.orders - a.orders || b.revenue - a.revenue || a.state.localeCompare(b.state));
  const topFiveDomesticOrders = stateRows.slice(0, 5).reduce((total, state) => total + state.orders, 0);

  return {
    domesticOrders,
    internationalOrders,
    unknownCountryOrders,
    statesReached: stateRows.length,
    countriesReached: countryRows.length,
    countries: countryRows,
    states: stateRows,
    topFiveDomesticOrders,
    topFiveDomesticShare: domesticOrders > 0 ? topFiveDomesticOrders / domesticOrders : 0,
    topFiveDomesticShareDenominator: domesticOrders,
  };
}

/** A purchase is one stored expense row; no static fallback for an empty ledger. */
export function demoLargestPurchase(expenses: { amount: number; vendor: string; date: Date }[]) {
  const largest = expenses.reduce<(typeof expenses)[number] | null>(
    (current, expense) => !current || expense.amount > current.amount ? expense : current,
    null,
  );
  return largest ? { amount: largest.amount, vendor: largest.vendor, date: largest.date.toISOString() } : null;
}
