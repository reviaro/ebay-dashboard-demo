import { Decimal } from '@prisma/client/runtime/library';
import prisma from '@/lib/prisma';
import { normalizeBrand } from '@/lib/brand-normalizer';

export interface FinanceMonth {
  month: string;
  grossRevenue: number;
  ebayFees: number;
  refunds: number;
  netRevenue: number;
  finalValueFee: number;
  perOrderFee: number;
  otherFee: number;
}

export interface FinanceBrand {
  brand: string;
  grossRevenue: number;
  ebayFees: number;
  refunds: number;
  netRevenue: number;
  units: number;
}

export interface FinanceSummary {
  coverageStart: Date | null;
  /** Number of distinct finance-ledger sale orders in the requested window. */
  orders: number;
  grossRevenue: number;
  ebayFees: number;
  /**
   * Promoted Listings ad spend — `NON_SALE_CHARGE` rows whose `rawPayload.feeType`
   * is `AD_FEE` or `PREMIUM_AD_FEES`. This is the authoritative ad-spend figure
   * for the finance window; it is NOT part of `ebayFees` (which is the SALE
   * fee breakdown only). Also surfaced as `feeBreakdown.ads`.
   */
  adFees: number;
  /**
   * Deductions for the window, split into the buckets the Profit & Ads
   * "where the money went" chart draws. `finalValue + international +
   * penalties + regulatory + (the SALE share of) other` reconciles to
   * `ebayFees`; `ads`, `shippingLabels` and the `NON_SALE_CHARGE` share of
   * `other` are on top of it.
   */
  feeBreakdown: FeeBreakdown;
  proceedsAfterFees: number;
  refunds: number;
  netRevenue: number;
  byMonth: FinanceMonth[];
  byBrand: FinanceBrand[];
}

export interface FeeBreakdown {
  finalValue: number;
  international: number;
  penalties: number;
  regulatory: number;
  ads: number;
  shippingLabels: number;
  other: number;
}

/** eBay's `rawPayload.feeType` values that are Promoted Listings ad spend. */
const AD_FEE_TYPES = new Set(['AD_FEE', 'PREMIUM_AD_FEES']);

type FeeCategory = 'finalValue' | 'international' | 'penalties' | 'regulatory' | 'other';

/** Which deduction bucket a SALE `feeDetails` entry belongs to. */
function categorizeSaleFee(feeType: string): FeeCategory {
  if (feeType === 'FINAL_VALUE_FEE' || feeType === 'FINAL_VALUE_FEE_FIXED_PER_ORDER') return 'finalValue';
  if (feeType === 'INTERNATIONAL_FEE') return 'international';
  if (/INAD|NOT_AS_DESCRIBED|BELOW_STANDARD|VERY_HIGH/.test(feeType)) return 'penalties';
  if (feeType.includes('REGULATORY')) return 'regulatory';
  return 'other';
}

interface FeeEntry {
  feeType: string;
  amount: string;
}

const dec = (value: unknown): Decimal => new Decimal(value as string);

/** Total of a row's fee breakdown; 0 when absent or unparseable. */
function feesOf(feeDetails: string | null): Decimal {
  if (!feeDetails) return new Decimal(0);
  try {
    const entries = JSON.parse(feeDetails) as FeeEntry[];
    return entries.reduce((sum, entry) => sum.plus(dec(entry.amount)), new Decimal(0));
  } catch {
    return new Decimal(0);
  }
}

type FeeSplit = { finalValue: Decimal; perOrder: Decimal; other: Decimal };

/** Split one row's fees by feeType; zeros when absent or unparseable. */
function splitFees(feeDetails: string | null): FeeSplit {
  const out: FeeSplit = { finalValue: new Decimal(0), perOrder: new Decimal(0), other: new Decimal(0) };
  if (!feeDetails) return out;
  let entries: FeeEntry[];
  try {
    entries = JSON.parse(feeDetails) as FeeEntry[];
  } catch {
    return out;
  }
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const amount = dec(entry.amount);
    if (entry.feeType === 'FINAL_VALUE_FEE') out.finalValue = out.finalValue.plus(amount);
    else if (entry.feeType === 'FINAL_VALUE_FEE_FIXED_PER_ORDER') out.perOrder = out.perOrder.plus(amount);
    else out.other = out.other.plus(amount);
  }
  return out;
}

const monthKey = (d: Date): string => d.toISOString().slice(0, 7);

export async function loadFinanceSummary(opts: { from?: Date; to?: Date }): Promise<FinanceSummary> {
  const where = (opts.from || opts.to)
    ? {
        transactionDate: {
          ...(opts.from ? { gte: opts.from } : {}),
          ...(opts.to ? { lte: opts.to } : {}),
        },
      }
    : {};

  const [rows, earliest] = await Promise.all([
    prisma.ebayFinanceTransaction.findMany({
      where,
      select: { transactionType: true, transactionDate: true, amount: true, feeDetails: true, orderId: true, rawPayload: true },
    }),
    prisma.ebayFinanceTransaction.findFirst({
      orderBy: { transactionDate: 'asc' },
      select: { transactionDate: true },
    }),
  ]);

  const sales = rows.filter((r) => r.transactionType === 'SALE');
  // A finance SALE row is normally one order, but use eBay's order id when it
  // is present so split ledger rows cannot inflate the count.  Keep rows with
  // no order id visible rather than silently dropping them.
  const financeOrderKeys = new Set(sales.map((row, index) => row.orderId || `unkeyed-sale-${index}`));
  const refundRows = rows.filter((r) => r.transactionType === 'REFUND');

  // Promoted Listings ad spend rides on NON_SALE_CHARGE rows, tagged only in the
  // raw eBay payload (there is no `feeType` column). Unparseable payload → skip.
  const adFeesDec = rows.reduce((total, r) => {
    if (r.transactionType !== 'NON_SALE_CHARGE' || !r.rawPayload) return total;
    let feeType: string | undefined;
    try {
      feeType = (JSON.parse(r.rawPayload) as { feeType?: string }).feeType;
    } catch {
      return total;
    }
    return feeType && AD_FEE_TYPES.has(feeType) ? total.plus(dec(r.amount)) : total;
  }, new Decimal(0));

  // Deduction breakdown for the Profit & Ads chart.
  const bd: Record<FeeCategory, Decimal> = {
    finalValue: new Decimal(0), international: new Decimal(0),
    penalties: new Decimal(0), regulatory: new Decimal(0), other: new Decimal(0),
  };
  for (const r of sales) {
    if (!r.feeDetails) continue;
    let entries: FeeEntry[];
    try {
      entries = JSON.parse(r.feeDetails) as FeeEntry[];
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const cat = categorizeSaleFee(entry.feeType);
      bd[cat] = bd[cat].plus(dec(entry.amount));
    }
  }
  const shippingLabelsDec = rows
    .filter((r) => r.transactionType === 'SHIPPING_LABEL')
    .reduce((s, r) => s.plus(dec(r.amount)), new Decimal(0));
  // NON_SALE_CHARGE rows that are not ad fees are "other" deductions.
  const nscOtherDec = rows.reduce((total, r) => {
    if (r.transactionType !== 'NON_SALE_CHARGE') return total;
    let feeType: string | undefined;
    try {
      feeType = r.rawPayload ? (JSON.parse(r.rawPayload) as { feeType?: string }).feeType : undefined;
    } catch {
      return total;
    }
    return feeType && AD_FEE_TYPES.has(feeType) ? total : total.plus(dec(r.amount));
  }, new Decimal(0));

  const proceedsAfterFeesDec = sales.reduce((s, r) => s.plus(dec(r.amount)), new Decimal(0));
  const ebayFeesDec = sales.reduce((s, r) => s.plus(feesOf(r.feeDetails)), new Decimal(0));
  const grossRevenueDec = proceedsAfterFeesDec.plus(ebayFeesDec);
  const refundsDec = refundRows.reduce((s, r) => s.plus(dec(r.amount)), new Decimal(0));
  const netRevenueDec = proceedsAfterFeesDec.minus(refundsDec);

  interface MonthAcc {
    gross: Decimal; fees: Decimal; refunds: Decimal;
    finalValue: Decimal; perOrder: Decimal; other: Decimal;
  }
  const monthMap = new Map<string, MonthAcc>();
  const monthAcc = (key: string): MonthAcc => {
    let acc = monthMap.get(key);
    if (!acc) {
      acc = { gross: new Decimal(0), fees: new Decimal(0), refunds: new Decimal(0),
        finalValue: new Decimal(0), perOrder: new Decimal(0), other: new Decimal(0) };
      monthMap.set(key, acc);
    }
    return acc;
  };

  for (const r of sales) {
    const acc = monthAcc(monthKey(r.transactionDate));
    const split = splitFees(r.feeDetails);
    const rowFees = split.finalValue.plus(split.perOrder).plus(split.other);
    acc.fees = acc.fees.plus(rowFees);
    acc.gross = acc.gross.plus(dec(r.amount)).plus(rowFees);
    acc.finalValue = acc.finalValue.plus(split.finalValue);
    acc.perOrder = acc.perOrder.plus(split.perOrder);
    acc.other = acc.other.plus(split.other);
  }
  for (const r of refundRows) {
    monthAcc(monthKey(r.transactionDate)).refunds = monthAcc(monthKey(r.transactionDate)).refunds.plus(dec(r.amount));
  }

  const byMonth: FinanceMonth[] = [...monthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({
      month,
      grossRevenue: v.gross.toNumber(),
      ebayFees: v.fees.toNumber(),
      refunds: v.refunds.toNumber(),
      netRevenue: v.gross.minus(v.fees).minus(v.refunds).toNumber(),
      finalValueFee: v.finalValue.toNumber(),
      perOrderFee: v.perOrder.toNumber(),
      otherFee: v.other.toNumber(),
    }));

  const orderIds = [...new Set(rows.map((r) => r.orderId).filter((id): id is string => !!id))];
  const saleBrands = orderIds.length
    ? await prisma.sale.findMany({
        where: { orderNumber: { in: orderIds } },
        select: { orderNumber: true, brand: true },
      })
    : [];
  const brandByOrder = new Map<string, string>();
  for (const s of saleBrands) {
    if (s.orderNumber) brandByOrder.set(s.orderNumber, normalizeBrand(s.brand));
  }

  interface BrandAcc { gross: Decimal; fees: Decimal; refunds: Decimal; units: number }
  const brandMap = new Map<string, BrandAcc>();
  const brandAcc = (name: string): BrandAcc => {
    let acc = brandMap.get(name);
    if (!acc) {
      acc = { gross: new Decimal(0), fees: new Decimal(0), refunds: new Decimal(0), units: 0 };
      brandMap.set(name, acc);
    }
    return acc;
  };
  const brandOf = (orderId: string | null): string =>
    (orderId && brandByOrder.get(orderId)) || 'Unknown';

  for (const r of sales) {
    const acc = brandAcc(brandOf(r.orderId));
    const rowFees = feesOf(r.feeDetails);
    acc.fees = acc.fees.plus(rowFees);
    acc.gross = acc.gross.plus(dec(r.amount)).plus(rowFees);
    acc.units += 1;
  }
  for (const r of refundRows) {
    const acc = brandAcc(brandOf(r.orderId));
    acc.refunds = acc.refunds.plus(dec(r.amount));
  }

  const byBrand: FinanceBrand[] = [...brandMap.entries()]
    .map(([brand, v]) => ({
      brand,
      grossRevenue: v.gross.toNumber(),
      ebayFees: v.fees.toNumber(),
      refunds: v.refunds.toNumber(),
      netRevenue: v.gross.minus(v.fees).minus(v.refunds).toNumber(),
      units: v.units,
    }))
    .sort((a, b) => b.grossRevenue - a.grossRevenue);

  return {
    coverageStart: earliest?.transactionDate ?? null,
    orders: financeOrderKeys.size,
    grossRevenue: grossRevenueDec.toNumber(),
    ebayFees: ebayFeesDec.toNumber(),
    adFees: adFeesDec.toNumber(),
    feeBreakdown: {
      finalValue: bd.finalValue.toNumber(),
      international: bd.international.toNumber(),
      penalties: bd.penalties.toNumber(),
      regulatory: bd.regulatory.toNumber(),
      ads: adFeesDec.toNumber(),
      shippingLabels: shippingLabelsDec.toNumber(),
      other: bd.other.plus(nscOtherDec).toNumber(),
    },
    proceedsAfterFees: proceedsAfterFeesDec.toNumber(),
    refunds: refundsDec.toNumber(),
    netRevenue: netRevenueDec.toNumber(),
    byMonth,
    byBrand,
  };
}
