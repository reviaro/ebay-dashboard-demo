import { describe, expect, it } from 'vitest';
import { mapPayout, PayoutMappingError } from './payout';

/** Synthetic payout fixture using the eBay response shape. */
const RAW_PAYOUT = {
  payoutId: '1000000004',
  payoutStatus: 'SUCCEEDED',
  amount: { value: '250.0', currency: 'USD' },
  payoutDate: '2025-01-04T12:00:00.000Z',
  lastAttemptedPayoutDate: '2025-01-04T12:05:00.000Z',
  transactionCount: 1,
  payoutInstrument: { instrumentType: 'BANK', nickname: 'Example Demo Bank', accountLastFourDigits: '0000' },
  totalFee: { value: '1.5', currency: 'USD' },
  totalAmount: { value: '251.5', currency: 'USD' },
  totalFeeDetails: [{ feeType: 'EXPRESS_PAYOUT_FEE', amount: { value: '1.5', currency: 'USD' } }],
};

describe('mapPayout', () => {
  it('maps a payout', () => {
    const row = mapPayout(RAW_PAYOUT, 'acct-1');
    expect(row.id).toBe('1000000004');
    expect(row.accountId).toBe('acct-1');
    expect(row.payoutStatus).toBe('SUCCEEDED');
    expect(row.amount.toString()).toBe('250');
    expect(row.payoutDate.toISOString()).toBe('2025-01-04T12:00:00.000Z');
    expect(row.transactionCount).toBe(1);
    expect(JSON.parse(row.rawPayload)).toEqual(RAW_PAYOUT);
  });

  it('defaults a missing transactionCount to 0, not an error', () => {
    const row = mapPayout({ ...RAW_PAYOUT, transactionCount: undefined }, 'acct-1');
    expect(row.transactionCount).toBe(0);
  });

  it('throws on a missing payoutId', () => {
    expect(() => mapPayout({ ...RAW_PAYOUT, payoutId: undefined }, 'acct-1')).toThrow(PayoutMappingError);
  });

  it('defaults a missing payoutStatus to UNKNOWN', () => {
    const row = mapPayout({ ...RAW_PAYOUT, payoutStatus: undefined }, 'acct-1');
    expect(row.payoutStatus).toBe('UNKNOWN');
    expect(row.id).toBe('1000000004');
  });

  it('throws on an unparseable amount', () => {
    expect(() => mapPayout({ ...RAW_PAYOUT, amount: { value: 'nope' } }, 'acct-1')).toThrow(PayoutMappingError);
  });

  it('throws on an unusable payoutDate', () => {
    expect(() => mapPayout({ ...RAW_PAYOUT, payoutDate: 'not-a-date' }, 'acct-1')).toThrow(PayoutMappingError);
  });
});
