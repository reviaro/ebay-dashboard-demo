import { isDemoMode } from '@/lib/demo/server';
import { withStore } from '@/lib/stores/route';
import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "@prisma/client/runtime/library";
import prisma from "@/lib/prisma";
import { loadUnifiedOrders } from "@/lib/orders/store";
import { filterOrders } from "@/lib/orders/unified";

async function handleGET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);
  const search = searchParams.get("search") ?? "";
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  // CSV sales and API orders as one list. Where both sources hold an order the
  // API row wins, so the totals here reflect eBay rather than the export --
  // see src/lib/orders/unified.ts.
  const all = filterOrders(await loadUnifiedOrders(), {
    search,
    ...(dateFrom ? { dateFrom: new Date(dateFrom) } : {}),
    ...(dateTo ? { dateTo: new Date(dateTo + "T23:59:59" + (isDemoMode() ? "Z" : "")) } : {}),
  });

  const orders = all.slice((page - 1) * limit, page * limit);

  // Refunds, eBay fees and proceeds all come from the finance sync
  // (EbayFinanceTransaction), not the order feed -- an order's `refunded` badge
  // is fulfillment state, not a dollar figure, and the order feed carries no
  // fee total. A SALE `amount` is already net of eBay fees; `feeDetails` is the
  // fee breakdown, and amount + Σ feeDetails == the gross Seller Hub reports.
  // Summed in JS Decimal, never a raw SQL SUM on a money column. Both queries
  // share the same date window as the order list.
  const financeWindow = (dateFrom || dateTo) ? {
    transactionDate: {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo + "T23:59:59.999" + (isDemoMode() ? "Z" : "")) } : {}),
    },
  } : {};
  const [refundRows, saleRows] = await Promise.all([
    prisma.ebayFinanceTransaction.findMany({
      where: { transactionType: "REFUND", ...financeWindow },
      select: { amount: true },
    }),
    prisma.ebayFinanceTransaction.findMany({
      where: { transactionType: "SALE", ...financeWindow },
      select: { amount: true, feeDetails: true },
    }),
  ]);
  const refundTotal = refundRows
    .reduce((total, row) => total.plus(new Decimal(row.amount as Decimal | string)), new Decimal(0))
    .toNumber();
  const proceedsAfterFeesDec = saleRows
    .reduce((total, row) => total.plus(new Decimal(row.amount as Decimal | string)), new Decimal(0));
  const ebayFeesDec = saleRows.reduce((total, row) => {
    const entries: { amount: string }[] = row.feeDetails ? JSON.parse(row.feeDetails) : [];
    return entries.reduce((running, entry) => running.plus(new Decimal(entry.amount)), total);
  }, new Decimal(0));

  const stats = {
    _sum: {
      soldFor: all.reduce((s, r) => s + r.soldFor, 0),
      totalPrice: all.reduce((s, r) => s + r.totalPrice, 0),
      eBayTax: all.reduce((s, r) => s + r.eBayTax, 0),
      shipping: all.reduce((s, r) => s + r.shipping, 0),
    },
    // Absolute values, positive numbers; the page renders fees/refunds as deductions.
    refundTotal,
    ebayFees: ebayFeesDec.toNumber(),
    proceedsAfterFees: proceedsAfterFeesDec.toNumber(),
    _count: { _all: all.length },
  };

  const chartItems = [...all]
    .sort((a, b) => a.saleDate.getTime() - b.saleDate.getTime())
    .map(r => ({ saleDate: r.saleDate, soldFor: r.soldFor, eBayTax: r.eBayTax, shipping: r.shipping }));

  return NextResponse.json({ orders, total: all.length, page, stats, chartItems });
}

export const GET = withStore('view', handleGET);
