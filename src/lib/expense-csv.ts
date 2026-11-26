// CSV parsing for inventory-acquisition-cost (COGS) uploads.
//
// Two shapes, auto-detected by header:
//
//  1. Yard-receipt export — one row per part, with `Unit Price` + `Qty` and the
//     receipt-level `Sales Tax` / `Fees` / `Adjustment` / `Total Receipt`
//     repeated on every line of the same `Receipt #`. Each line becomes one
//     InventoryExpense: cost = Unit Price x Qty, plus that line's pro-rata
//     share (by goods value) of the receipt's tax + fees + adjustment.
//
//  2. QuickBooks flat export — `Date` / `Vendor` / `Amount` (or Total/Debit,
//     Payee/Name, Memo/Description). One row = one InventoryExpense. The
//     dedupeKey keeps the legacy `<ISO date>|<vendor>|<amount>|<memo>` shape so
//     re-uploading a previously imported file stays idempotent.

import { normalizeVendor } from './pdf-parser';

export interface InventoryExpenseCsvRow {
  date: Date;
  vendor: string;
  amount: number;
  memo?: string;
  /** Stable per-row identity the caller hashes into `importKey`. */
  dedupeKey: string;
}

export interface ParseResult {
  rows: InventoryExpenseCsvRow[];
  /** Rows recognised but dropped (bad date, no amount, non-positive cost). */
  skipped: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Parse a money-ish string; NaN when absent or unparseable. */
function money(value: string | undefined): number {
  if (value == null || value === '') return NaN;
  return parseFloat(String(value).replace(/[$,()]/g, '').trim());
}

/** Lower-case, trimmed view of a row so header casing / spacing doesn't matter. */
function lower(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(row)) {
    out[key.trim().toLowerCase()] = typeof val === 'string' ? val : String(val ?? '');
  }
  return out;
}

const pick = (row: Record<string, string>, ...keys: string[]): string => {
  for (const key of keys) {
    const v = row[key];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

const isYardSchema = (row: Record<string, string>): boolean => 'unit price' in row;

export function parseInventoryExpenseCsvRows(
  rawRows: Record<string, string>[],
): ParseResult {
  const normalized = rawRows
    .map(lower)
    .filter((r) => Object.values(r).some((v) => v.trim() !== ''));

  if (normalized.length === 0) return { rows: [], skipped: 0 };

  return normalized.some(isYardSchema)
    ? parseYardRows(normalized)
    : parseFlatRows(normalized);
}

function parseYardRows(rows: Record<string, string>[]): ParseResult {
  const out: InventoryExpenseCsvRow[] = [];
  let skipped = 0;

  // Group by receipt so the receipt-level tax/fees can be split across its lines.
  const groups = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    if (!isYardSchema(row)) {
      skipped += 1;
      continue;
    }
    const receiptNo = pick(row, 'receipt #', 'receipt#', 'receipt no', 'receipt');
    const groupKey = receiptNo || `${pick(row, 'date', 'transaction date')}|${pick(row, 'vendor', 'payee', 'name')}`;
    const bucket = groups.get(groupKey);
    if (bucket) bucket.push(row);
    else groups.set(groupKey, [row]);
  }

  for (const [groupKey, lines] of groups) {
    const first = lines[0];
    const tax = money(pick(first, 'sales tax', 'tax')) || 0;
    const fees = money(pick(first, 'fees', 'fee')) || 0;
    const adjustment = money(pick(first, 'adjustment', 'adj')) || 0;
    const extra = tax + fees + adjustment;

    const goodsOf = (line: Record<string, string>): number => {
      const unit = money(pick(line, 'unit price', 'price'));
      const qtyRaw = money(pick(line, 'qty', 'quantity'));
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
      return Number.isFinite(unit) && unit > 0 ? unit * qty : 0;
    };

    const lineGoods = lines.map(goodsOf);
    const totalGoods = lineGoods.reduce((sum, g) => sum + g, 0);

    // Distinguish repeat item names within one receipt so each line gets its
    // own dedupeKey even when the allocated amount collides.
    const seen = new Map<string, number>();

    lines.forEach((line, index) => {
      const dateStr = pick(line, 'date', 'transaction date');
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        skipped += 1;
        return;
      }

      const alloc = totalGoods > 0 ? extra * (lineGoods[index] / totalGoods) : extra / lines.length;
      const amount = round2(lineGoods[index] + alloc);
      if (!Number.isFinite(amount) || amount <= 0) {
        skipped += 1;
        return;
      }

      const vendor = normalizeVendor(pick(line, 'vendor', 'payee', 'name') || 'Unknown');
      const memo = pick(line, 'item', 'notes', 'memo', 'description') || undefined;
      const itemKey = memo ?? '(no item)';
      const occurrence = seen.get(itemKey) ?? 0;
      seen.set(itemKey, occurrence + 1);

      out.push({
        date,
        vendor,
        amount,
        memo,
        dedupeKey: `yard|${groupKey}|${vendor}|${itemKey}|${occurrence}`,
      });
    });
  }

  return { rows: out, skipped };
}

function parseFlatRows(rows: Record<string, string>[]): ParseResult {
  const out: InventoryExpenseCsvRow[] = [];
  let skipped = 0;

  for (const row of rows) {
    const dateStr = pick(row, 'date', 'transaction date');
    const amountStr = pick(row, 'amount', 'total', 'debit');
    if (!dateStr || !amountStr) {
      skipped += 1;
      continue;
    }
    const date = new Date(dateStr);
    const amount = money(amountStr);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(amount) || amount <= 0) {
      skipped += 1;
      continue;
    }
    const vendor = normalizeVendor(pick(row, 'vendor', 'payee', 'name') || 'Unknown');
    const memo = pick(row, 'memo', 'description') || undefined;

    out.push({
      date,
      vendor,
      amount,
      memo,
      dedupeKey: `${date.toISOString()}|${vendor}|${amount}|${memo ?? ''}`,
    });
  }

  return { rows: out, skipped };
}
