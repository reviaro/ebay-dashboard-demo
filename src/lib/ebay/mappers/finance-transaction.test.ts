import { describe, expect, it } from 'vitest';
import { FinanceMappingError, mapFinanceTransaction } from './finance-transaction';

/** Synthetic transaction fixtures using the eBay response shape. */
const SALE_TRANSACTION = {
  transactionId: '00-00000-00001',
  orderId: '00-00000-00001',
  salesRecordReference: '0',
  buyer: { username: 'demo_buyer_01' },
  transactionType: 'SALE',
  amount: { value: '42.50', currency: 'USD' },
  totalFeeBasisAmount: { value: '50.00', currency: 'USD' },
  totalFeeAmount: { value: '7.50', currency: 'USD' },
  orderLineItems: [
    {
      lineItemId: '10000000000001',
      feeBasisAmount: { value: '50.00', currency: 'USD' },
      marketplaceFees: [
        { feeType: 'FINAL_VALUE_FEE', amount: { value: '4.50', currency: 'USD' } },
        { feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: { value: '0.4', currency: 'USD' } },
        { feeType: 'HIGH_ITEM_NOT_AS_DESCRIBED_FEE', amount: { value: '2.60', currency: 'USD' } },
      ],
    },
  ],
  bookingEntry: 'CREDIT',
  transactionDate: '2025-01-03T12:00:00.000Z',
  transactionStatus: 'FUNDS_AVAILABLE_FOR_PAYOUT',
};

/** A refund: amount is POSITIVE; direction is in bookingEntry. */
const REFUND_TRANSACTION = {
  transactionId: 'RRP-1000000002-CCM_CHARGE',
  orderId: '00-00000-00002',
  transactionType: 'REFUND',
  amount: { value: '80.25', currency: 'USD' },
  bookingEntry: 'DEBIT',
  transactionDate: '2025-01-02T12:00:00.000Z',
  references: [{ referenceId: '1000000003', referenceType: 'RETURN_ID' }],
};

/** The payout transaction itself carries its payout id in references[]. */
const WITHDRAWAL_TRANSACTION = {
  transactionId: '1000000004',
  transactionType: 'WITHDRAWAL',
  amount: { value: '251.5', currency: 'USD' },
  bookingEntry: 'DEBIT',
  transactionDate: '2025-01-04T12:00:00.000Z',
  references: [{ referenceId: '1000000004', referenceType: 'PAYOUT_ID' }],
};

describe('mapFinanceTransaction', () => {
  it('maps a SALE transaction, including its fee breakdown as JSON', () => {
    const row = mapFinanceTransaction(SALE_TRANSACTION, 'acct-1', 'EBAY_US');

    expect(row.transactionId).toBe('00-00000-00001');
    expect(row.transactionDate.toISOString()).toBe('2025-01-03T12:00:00.000Z');
    expect(row.transactionType).toBe('SALE');
    expect(row.bookingEntry).toBe('CREDIT');
    expect(row.amount.toString()).toBe('42.5');
    expect(row.orderId).toBe('00-00000-00001');
    expect(row.salesRecordRef).toBe('0');
    expect(row.accountId).toBe('acct-1');
    expect(row.marketplaceId).toBe('EBAY_US');
    expect(row.payoutId).toBeNull();

    const fees = JSON.parse(row.feeDetails!);
    expect(fees).toEqual([
      { feeType: 'FINAL_VALUE_FEE', amount: '4.50' },
      { feeType: 'FINAL_VALUE_FEE_FIXED_PER_ORDER', amount: '0.4' },
      { feeType: 'HIGH_ITEM_NOT_AS_DESCRIBED_FEE', amount: '2.60' },
    ]);
  });

  it('maps a REFUND with a positive amount and a DEBIT booking entry', () => {
    const row = mapFinanceTransaction(REFUND_TRANSACTION, 'acct-1', 'EBAY_US');
    expect(row.transactionType).toBe('REFUND');
    expect(row.amount.toString()).toBe('80.25');
    expect(row.bookingEntry).toBe('DEBIT');
    expect(row.feeDetails).toBeNull();
    expect(row.payoutId).toBeNull();
  });

  it('reads payoutId out of references[] when referenceType is PAYOUT_ID', () => {
    const row = mapFinanceTransaction(WITHDRAWAL_TRANSACTION, 'acct-1', 'EBAY_US');
    expect(row.payoutId).toBe('1000000004');
    expect(row.orderId).toBeNull();
  });

  it('prefers an explicit top-level payoutId (present once a txn is PAID)', () => {
    const row = mapFinanceTransaction(
      { ...SALE_TRANSACTION, payoutId: '9999999999' },
      'acct-1',
      'EBAY_US'
    );
    expect(row.payoutId).toBe('9999999999');
  });

  it('leaves orderId/payoutId null when eBay omits them', () => {
    const row = mapFinanceTransaction(
      { ...SALE_TRANSACTION, orderId: undefined },
      'acct-1',
      'EBAY_US'
    );
    expect(row.orderId).toBeNull();
    expect(row.payoutId).toBeNull();
  });

  it('maps a fee record with no transactionType to UNKNOWN rather than throwing', () => {
    const feeRecord = {
      transactionId: 'FEE-100000000005',
      amount: { value: '2.0', currency: 'USD' },
      bookingEntry: 'DEBIT',
      transactionDate: '2025-01-05T12:00:00.000Z',
      references: [{ referenceId: '100000000006', referenceType: 'ITEM_ID' }],
      feeType: 'INSERTION_FEE',
    };
    const row = mapFinanceTransaction(feeRecord, 'acct-1', 'EBAY_US');
    expect(row.transactionType).toBe('UNKNOWN');
    expect(row.amount.toString()).toBe('2');
    expect(row.orderId).toBeNull();
  });

  it('defaults a missing bookingEntry to UNKNOWN too', () => {
    const row = mapFinanceTransaction({ ...SALE_TRANSACTION, bookingEntry: undefined }, 'acct-1', 'EBAY_US');
    expect(row.bookingEntry).toBe('UNKNOWN');
    expect(row.transactionType).toBe('SALE');
  });

  it('keeps the whole raw payload for audit', () => {
    const row = mapFinanceTransaction(SALE_TRANSACTION, 'acct-1', 'EBAY_US');
    expect(JSON.parse(row.rawPayload)).toEqual(SALE_TRANSACTION);
  });

  it('throws rather than defaulting to zero on an unparseable amount', () => {
    expect(() =>
      mapFinanceTransaction({ ...SALE_TRANSACTION, amount: { value: 'not-a-number' } }, 'acct-1', 'EBAY_US')
    ).toThrow(FinanceMappingError);
  });

  it('throws on a missing amount object', () => {
    expect(() =>
      mapFinanceTransaction({ ...SALE_TRANSACTION, amount: undefined }, 'acct-1', 'EBAY_US')
    ).toThrow(FinanceMappingError);
  });

  it('throws on a missing transactionId', () => {
    expect(() =>
      mapFinanceTransaction({ ...SALE_TRANSACTION, transactionId: undefined }, 'acct-1', 'EBAY_US')
    ).toThrow(FinanceMappingError);
  });

  it('throws on an unusable transactionDate', () => {
    expect(() =>
      mapFinanceTransaction({ ...SALE_TRANSACTION, transactionDate: 'not-a-date' }, 'acct-1', 'EBAY_US')
    ).toThrow(FinanceMappingError);
  });
});
