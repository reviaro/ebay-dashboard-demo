/**
 * eBay Sell Finances `payout` -> one EbayPayout row.
 *
 * Mapped response fields:
 * `payoutId`, `payoutStatus`, `amount {value,currency}` (net paid to the bank),
 * `payoutDate`, `transactionCount`. `rawPayload` keeps the rest (`totalAmount`,
 * `totalFee`, `payoutInstrument`, `bankReference`, ...).
 *
 * Same two-tier strictness as the transaction mapper: `payoutId` (the key),
 * `amount`, and `payoutDate` throw when missing or unparseable, because a wrong
 * value there corrupts the store or the sums silently. `payoutStatus` is
 * classification and may be absent, so it defaults to `'UNKNOWN'` rather than
 * aborting the sync.
 */

import { Decimal } from '@prisma/client/runtime/library';

export class PayoutMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutMappingError';
  }
}

export interface MappedPayout {
  id: string;
  accountId: string;
  payoutDate: Date;
  payoutStatus: string;
  amount: Decimal;
  transactionCount: number;
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
  if (!s) throw new PayoutMappingError(`Payout is missing required field "${field}".`);
  return s;
}

function requiredDate(value: unknown, field: string): Date {
  const parsed = new Date(String(value));
  if (!(value && Number.isFinite(parsed.getTime()))) {
    throw new PayoutMappingError(`Payout has an unusable ${field}: ${JSON.stringify(value)}`);
  }
  return parsed;
}

function requiredAmount(value: unknown): Decimal {
  const raw = asRecord(value).value;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new PayoutMappingError('Payout has no amount.value.');
  }
  try {
    return new Decimal(raw);
  } catch {
    throw new PayoutMappingError(`Payout has an unparseable amount.value: ${JSON.stringify(raw)}`);
  }
}

export function mapPayout(raw: unknown, accountId: string): MappedPayout {
  const record = asRecord(raw);
  const count = Number(record.transactionCount);

  return {
    id: requiredString(record.payoutId, 'payoutId'),
    accountId,
    payoutDate: requiredDate(record.payoutDate, 'payoutDate'),
    payoutStatus: optionalString(record.payoutStatus) ?? 'UNKNOWN',
    amount: requiredAmount(record.amount),
    transactionCount: Number.isFinite(count) ? count : 0,
    rawPayload: JSON.stringify(raw),
  };
}
