import { describe, expect, it } from 'vitest';
import { demoLargestPurchase, demoMarketGeography } from './market-aggregates';

const location = (shipToCountry: string | null, shipToState: string | null, soldFor = 10) =>
  ({ shipToCountry, shipToState, soldFor });

describe('demo Market geography', () => {
  it('keeps every domestic state, excludes overseas regions, and uses all domestic orders as denominator', () => {
    const states = ['California', 'Texas', 'Florida', 'New York', 'Washington', 'Pennsylvania', 'Ohio', 'Virginia', 'Utah', 'Iowa', 'Oregon', 'Hawaii'];
    const result = demoMarketGeography([
      ...states.map((state, index) => location('United States', state, 12 - index)),
      location('United States', 'California', 20),
      location('United States', null),
      location('United States', 'Unknown'),
      location('Canada', 'Ontario', 50),
      location('United Kingdom', null),
      location(null, 'California'),
      location('  ', 'Texas'),
      location('Unknown', 'Ohio'),
    ]);

    expect(result.domesticOrders).toBe(15);
    expect(result.internationalOrders).toBe(2);
    expect(result.unknownCountryOrders).toBe(3);
    expect(result.statesReached).toBe(12);
    expect(result.countriesReached).toBe(3);
    expect(result.states).toHaveLength(12);
    expect(result.states[0]).toEqual({ state: 'California', orders: 2, revenue: 32 });
    expect(result.states.some(row => ['Ontario', 'Unknown'].includes(row.state))).toBe(false);
    expect(result.countries).toContainEqual({ country: 'United States', orders: 15, revenue: 118 });
    expect(result.topFiveDomesticOrders).toBe(6);
    expect(result.topFiveDomesticShareDenominator).toBe(15);
    expect(result.topFiveDomesticShare).toBe(6 / 15);
  });

  it('sorts equal-volume states by item revenue, with deterministic alphabetical ties', () => {
    const result = demoMarketGeography([
      location('United States', 'Texas', 20),
      location('United States', 'Florida', 20),
      location('United States', 'California', 30),
    ]);
    expect(result.states.map(row => row.state)).toEqual(['California', 'Florida', 'Texas']);
  });

  it('returns an honest empty geography without static fallback values', () => {
    expect(demoMarketGeography([])).toEqual({
      domesticOrders: 0, internationalOrders: 0, unknownCountryOrders: 0,
      statesReached: 0, countriesReached: 0, countries: [], states: [],
      topFiveDomesticOrders: 0, topFiveDomesticShare: 0, topFiveDomesticShareDenominator: 0,
    });
  });
});

describe('demo largest purchase', () => {
  it('selects the actual largest row, rather than a vendor total or the last purchase', () => {
    const date = new Date('2026-02-01T00:00:00Z');
    expect(demoLargestPurchase([
      { amount: 90, vendor: 'DEMO A', date },
      { amount: 70, vendor: 'DEMO A', date },
      { amount: 120, vendor: 'DEMO B', date },
      { amount: 80, vendor: 'DEMO C', date: new Date('2026-03-01T00:00:00Z') },
    ])).toEqual({ amount: 120, vendor: 'DEMO B', date: date.toISOString() });
  });

  it('has no largest purchase when no rows are present', () => {
    expect(demoLargestPurchase([])).toBeNull();
  });
});
