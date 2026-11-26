import { describe, it, expect } from 'vitest';
import { parseInventoryExpenseCsvRows } from './expense-csv';

/** Synthetic rows using the header-keyed shape returned by papaparse. */
const rows = (...objs: Record<string, string>[]) => objs;

describe('parseInventoryExpenseCsvRows — yard-receipt schema (has "Unit Price")', () => {
  const yardLine = (over: Record<string, string> = {}) => ({
    date: '2024-01-10',
    Vendor: 'Demo Yard A',
    Category: 'eBay Expenses / Parts',
    'Receipt #': 'DEMO-RECEIPT-001',
    Item: 'A Part',
    Qty: '1',
    'Unit Price': '10.00',
    'Sales Tax': '0',
    Fees: '0',
    Adjustment: '0',
    'Total Receipt': '10.00',
    Notes: 'Synthetic receipt',
    ...over,
  });

  it('makes one row per line item, cost = Unit Price x Qty + pro-rata receipt tax/fees', () => {
    const { rows: out, skipped } = parseInventoryExpenseCsvRows(rows(
      yardLine({ Item: 'Demo Control Module', Qty: '2', 'Unit Price': '21.50', 'Sales Tax': '6.00', Fees: '4.00' }),
      yardLine({ Item: 'Demo Trim Panel', Qty: '1', 'Unit Price': '17.00', 'Sales Tax': '6.00', Fees: '4.00' }),
    ));

    expect(skipped).toBe(0);
    expect(out).toHaveLength(2);
    // goods: 43 + 17 = 60 ; extra: 6 + 4 = 10
    expect(out[0].amount).toBeCloseTo(50.17, 2); // 43 + 10 * 43/60
    expect(out[1].amount).toBeCloseTo(19.83, 2); // 17 + 10 * 17/60
    expect(out[0].amount + out[1].amount).toBeCloseTo(70, 2); // goods + extra
    expect(out[0].memo).toBe('Demo Control Module');
    expect(out[0].vendor).toBe('Demo Yard A');
    expect(out[0].date).toEqual(new Date('2024-01-10'));
  });

  it('treats a missing or blank Qty as 1', () => {
    const { rows: out } = parseInventoryExpenseCsvRows(rows(
      yardLine({ Qty: '', 'Unit Price': '30.00', 'Sales Tax': '0', Fees: '0' }),
    ));
    expect(out[0].amount).toBeCloseTo(30, 2);
  });

  it('splits receipt tax/fees evenly when no line has positive goods', () => {
    const { rows: out } = parseInventoryExpenseCsvRows(rows(
      yardLine({ Item: 'X', 'Unit Price': '0', 'Sales Tax': '4', Fees: '0' }),
      yardLine({ Item: 'Y', 'Unit Price': '0', 'Sales Tax': '4', Fees: '0' }),
    ));
    expect(out.map(r => r.amount)).toEqual([2, 2]);
  });

  it('gives duplicate item names on one receipt distinct dedupeKeys', () => {
    const { rows: out } = parseInventoryExpenseCsvRows(rows(
      yardLine({ Item: 'Instrument Bezel', 'Unit Price': '15' }),
      yardLine({ Item: 'Instrument Bezel', 'Unit Price': '15' }),
    ));
    expect(out).toHaveLength(2);
    expect(out[0].dedupeKey).not.toBe(out[1].dedupeKey);
  });

  it('is idempotent: re-parsing the same rows yields the same dedupeKeys', () => {
    const input = rows(
      yardLine({ Item: 'Demo Control Module', Qty: '2', 'Unit Price': '21.50', 'Sales Tax': '6.00', Fees: '4.00' }),
      yardLine({ Item: 'Demo Trim Panel', 'Unit Price': '17.00', 'Sales Tax': '6.00', Fees: '4.00' }),
    );
    const a = parseInventoryExpenseCsvRows(input).rows.map(r => r.dedupeKey);
    const b = parseInventoryExpenseCsvRows(input).rows.map(r => r.dedupeKey);
    expect(a).toEqual(b);
  });

  it('folds Adjustment into the allocated extra (can be negative)', () => {
    const { rows: out } = parseInventoryExpenseCsvRows(rows(
      yardLine({ Item: 'X', 'Unit Price': '100', 'Sales Tax': '0', Fees: '0', Adjustment: '-10' }),
    ));
    expect(out[0].amount).toBeCloseTo(90, 2);
  });

  it('parses currency-formatted numbers ($, commas)', () => {
    const { rows: out } = parseInventoryExpenseCsvRows(rows(
      yardLine({ Item: 'Big', 'Unit Price': '$1,234.56', 'Sales Tax': '0', Fees: '0' }),
    ));
    expect(out[0].amount).toBeCloseTo(1234.56, 2);
  });

  it('skips a line with an unparseable date and counts it', () => {
    const { rows: out, skipped } = parseInventoryExpenseCsvRows(rows(
      yardLine({ date: 'not-a-date' }),
      yardLine({ Item: 'Good', 'Unit Price': '5' }),
    ));
    expect(out).toHaveLength(1);
    expect(out[0].memo).toBe('Good');
    expect(skipped).toBe(1);
  });

  it('uses Notes as the memo when Item is blank', () => {
    const { rows: out } = parseInventoryExpenseCsvRows(rows(
      yardLine({ Item: '', Notes: 'misc hardware', 'Unit Price': '5' }),
    ));
    expect(out[0].memo).toBe('misc hardware');
  });

  it('normalizes vendor aliases to the app’s canonical names', () => {
    const norm = (v: string) => parseInventoryExpenseCsvRows(rows(
      { date: '2025-01-02', Vendor: v, 'Receipt #': '1', Item: 'p', Qty: '1', 'Unit Price': '5', 'Sales Tax': '0', Fees: '0' },
    )).rows[0].vendor;
    expect(norm('PICK A PART')).toBe('Pick a Part');
    expect(norm("rupert's u pull it")).toBe("Rupert's U-Pull It");
    expect(norm('Harrys U Pull It')).toBe('Harrys U Pull It');
  });
});

describe('parseInventoryExpenseCsvRows — QuickBooks flat schema (no "Unit Price")', () => {
  it('reads Date / Vendor / Amount and keeps the legacy dedupeKey shape', () => {
    const { rows: out, skipped } = parseInventoryExpenseCsvRows(rows(
      { Date: '01/15/2024', Vendor: 'Demo Yard B', Amount: '$120.50', Memo: 'demo spare part' },
    ));
    expect(skipped).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBeCloseTo(120.50, 2);
    expect(out[0].vendor).toBe('Demo Yard B');
    expect(out[0].memo).toBe('demo spare part');
    expect(out[0].dedupeKey).toBe(`${new Date('01/15/2024').toISOString()}|Demo Yard B|120.5|demo spare part`);
  });

  it('accepts Total / Debit / Payee column aliases', () => {
    const { rows: out } = parseInventoryExpenseCsvRows(rows(
      { 'Transaction Date': '2025-02-01', Payee: 'Ruperts', Total: '40.00' },
    ));
    expect(out[0].vendor).toBe("Rupert's U-Pull It");
    expect(out[0].amount).toBeCloseTo(40, 2);
  });

  it('skips a row with no amount and counts it', () => {
    const { rows: out, skipped } = parseInventoryExpenseCsvRows(rows(
      { Date: '2025-02-01', Vendor: 'X' },
      { Date: '2025-02-02', Vendor: 'Y', Amount: '10' },
    ));
    expect(out).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('skips a zero / negative amount', () => {
    const { rows: out, skipped } = parseInventoryExpenseCsvRows(rows(
      { Date: '2025-02-01', Vendor: 'X', Amount: '0' },
      { Date: '2025-02-01', Vendor: 'Y', Amount: '-5' },
    ));
    expect(out).toHaveLength(0);
    expect(skipped).toBe(2);
  });
});

describe('parseInventoryExpenseCsvRows — no usable rows', () => {
  it('returns empty for an empty array', () => {
    expect(parseInventoryExpenseCsvRows([])).toEqual({ rows: [], skipped: 0 });
  });

  it('returns empty (all skipped) for rows with no recognizable columns', () => {
    const res = parseInventoryExpenseCsvRows(rows({ foo: 'bar', baz: 'qux' }));
    expect(res.rows).toHaveLength(0);
  });
});
