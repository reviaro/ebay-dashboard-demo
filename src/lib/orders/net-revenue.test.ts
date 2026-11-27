import { describe, expect, it } from 'vitest';
import { orderNetRevenue } from './net-revenue';

describe('orderNetRevenue', () => {
  it('is sale proceeds after eBay fees minus refunds, as on the dashboard', () => {
    expect(orderNetRevenue({ proceedsAfterFees: 41441.42, ebayFees: 6695.28, refundTotal: 2051.6 })).toBeCloseTo(39389.82, 2);
  });

  it('is unknown, not a misleading negative, when no finance rows were synced', () => {
    expect(orderNetRevenue({ proceedsAfterFees: 0, ebayFees: 0, refundTotal: 12.5 })).toBeNull();
    expect(orderNetRevenue(undefined)).toBeNull();
  });
});
