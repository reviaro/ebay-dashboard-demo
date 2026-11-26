/**
 * eBay Sell Finances `transaction` -> one EbayFinanceTransaction row.
 *
 * Response-shape details handled by this mapper:
 *
 *   - `amount` is always POSITIVE; direction is in `bookingEntry`
 *     (CREDIT = money to the seller, DEBIT = money out). A REFUND is a positive
 *     amount with `bookingEntry: "DEBIT"`, not a negative number.
 *   - `payoutId` is not a reliable top-level field. It appears there only once a
 *     transaction's status is PAID; before that the payout link (on the payout
 *     transaction itself) is in `references[]` as `referenceType: "PAYOUT_ID"`.
 *     This reads the top-level field first, then falls back to references[].
 *   - fee breakdown is `orderLineItems[].marketplaceFees[]` = `{ feeType,
 *     amount: {value,currency} }`.
 *   - Two tiers of strictness. Identity and money -- `transactionId`, `amount`,
 *     `transactionDate` -- still throw when missing or unparseable: a wrong
 *     value there corrupts the upsert key or the sums silently. Classification
 *     -- `transactionType`, `bookingEntry` -- defaults to `'UNKNOWN'` instead:
 *     eBay's feed includes fee/adjustment records that legitimately omit them
 *     (a top-level `feeType` in their place), and one such record must not
 *     abort a 700-day backfill. `'UNKNOWN'` is visibly unclassified and
 *     queryable; the full record is in `rawPayload`.
 *     Types seen: SALE, REFUND, CREDIT, SHIPPING_LABEL, WITHDRAWAL,
 *     NON_SALE_CHARGE.
 */

import { Decimal } from '@prisma/client/runtime/library';

export class FinanceMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceMappingError';
  }
}

export interface MappedFinanceTransaction {
  accountId: string;
  transactionId: string;
  transactionDate: Date;
  bookingEntry: string;
  transactionType: string;
  amount: Decimal;
  feeDetails: string | null;
  orderId: string | null;
  payoutId: string | null;
  salesRecordRef: string | null;
  marketplaceId: string;
  rawPayload: string;
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function requiredString(value: unknown, field: string): string {
  const s = optionalString(value);
  if (!s) throw new FinanceMappingError(`Transaction is missing required field "${field}".`);
  return s;
}

function requiredDate(value: unknown, field: string): Date {
  const parsed = new Date(String(value));
  if (!(value && Number.isFinite(parsed.getTime()))) {
    throw new FinanceMappingError(`Transaction has an unusable ${field}: ${JSON.stringify(value)}`);
  }
  return parsed;
}

/** eBay sends money as `{ value: "12.34", currency: "USD" }`. */
function requiredAmount(value: unknown, field: string): Decimal {
  const raw = asRecord(value).value;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new FinanceMappingError(`Transaction has no ${field}.value.`);
  }
  try {
    return new Decimal(raw);
  } catch {
    throw new FinanceMappingError(`Transaction has an unparseable ${field}.value: ${JSON.stringify(raw)}`);
  }
}

interface FeeEntry {
  feeType: string;
  amount: string;
}

/** Flattens every line item's marketplaceFees into one array, JSON-stored. */
function feeDetailsOf(raw: Json): string | null {
  const lineItems = Array.isArray(raw.orderLineItems) ? raw.orderLineItems : [];
  const fees: FeeEntry[] = [];

  for (const item of lineItems) {
    const record = asRecord(item);
    const marketplaceFees = Array.isArray(record.marketplaceFees) ? record.marketplaceFees : [];
    for (const fee of marketplaceFees) {
      const feeRecord = asRecord(fee);
      const feeType = optionalString(feeRecord.feeType);
      const amountValue = asRecord(feeRecord.amount).value;
      if (feeType && (typeof amountValue === 'string' || typeof amountValue === 'number')) {
        fees.push({ feeType, amount: String(amountValue) });
      }
    }
  }

  return fees.length > 0 ? JSON.stringify(fees) : null;
}

/** Top-level `payoutId` if eBay supplied one, else a PAYOUT_ID from references[]. */
function payoutIdOf(raw: Json): string | null {
  const explicit = optionalString(raw.payoutId);
  if (explicit) return explicit;

  const references = Array.isArray(raw.references) ? raw.references : [];
  for (const ref of references) {
    const record = asRecord(ref);
    if (record.referenceType === 'PAYOUT_ID') {
      const id = optionalString(record.referenceId);
      if (id) return id;
    }
  }
  return null;
}

export function mapFinanceTransaction(
  raw: unknown,
  accountId: string,
  marketplaceId: string
): MappedFinanceTransaction {
  const record = asRecord(raw);

  return {
    accountId,
    transactionId: requiredString(record.transactionId, 'transactionId'),
    transactionDate: requiredDate(record.transactionDate, 'transactionDate'),
    bookingEntry: optionalString(record.bookingEntry) ?? 'UNKNOWN',
    transactionType: optionalString(record.transactionType) ?? 'UNKNOWN',
    amount: requiredAmount(record.amount, 'amount'),
    feeDetails: feeDetailsOf(record),
    orderId: optionalString(record.orderId),
    payoutId: payoutIdOf(record),
    salesRecordRef: optionalString(record.salesRecordReference),
    marketplaceId,
    rawPayload: JSON.stringify(raw),
  };
}
