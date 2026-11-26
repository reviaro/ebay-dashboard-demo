import { demoLargestPurchase } from '@/lib/demo/market-aggregates';
import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

async function handleGET() {
  try {
    const [expenses, fees] = await Promise.all([
      prisma.inventoryExpense.findMany({ orderBy: { date: 'asc' } }),
      prisma.ebayFee.findMany({ orderBy: { month: 'asc' } }),
    ]);

    // Aggregate inventory expenses by month
    const invMonthMap: Record<string, { month: string; amount: number }> = {};
    for (const e of expenses) {
      const key = e.date.toISOString().substring(0, 7);
      if (!invMonthMap[key]) invMonthMap[key] = { month: key, amount: 0 };
      invMonthMap[key].amount += e.amount;
    }
    const invByMonth = Object.values(invMonthMap).sort((a, b) => a.month.localeCompare(b.month));

    // Aggregate inventory expenses by vendor
    const vendorMap: Record<string, number> = {};
    for (const e of expenses) {
      vendorMap[e.vendor] = (vendorMap[e.vendor] || 0) + e.amount;
    }
    const invByVendor = Object.entries(vendorMap)
      .map(([vendor, total]) => ({ vendor, total }))
      .sort((a, b) => b.total - a.total);

    // Aggregate fees by month
    const feeMonthMap: Record<string, { month: string; finalValue: number; perOrder: number; flat: number; total: number }> = {};
    for (const f of fees) {
      if (!feeMonthMap[f.month]) feeMonthMap[f.month] = { month: f.month, finalValue: 0, perOrder: 0, flat: 0, total: 0 };
      if (f.feeType === 'final-value') feeMonthMap[f.month].finalValue += f.amount;
      else if (f.feeType === 'per-order') feeMonthMap[f.month].perOrder += f.amount;
      else feeMonthMap[f.month].flat += f.amount;
      feeMonthMap[f.month].total += f.amount;
    }
    const feesByMonth = Object.values(feeMonthMap).sort((a, b) => a.month.localeCompare(b.month));

    const totalInventoryCost = expenses.reduce((s, e) => s + e.amount, 0);
    const totalFees = fees.reduce((s, f) => s + f.amount, 0);

    return NextResponse.json({
      invByMonth,
      invByVendor,
      feesByMonth,
      totalInventoryCost,
      totalFees,
      tripCount: expenses.length,
      largestPurchase: demoLargestPurchase(expenses),
      hasExpenseData: expenses.length > 0,
      hasFeeData: fees.length > 0,
    });
  } catch (error) {
    console.error('Expenses API error:', error);
    return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 });
  }
}

export const GET = withStore('view', handleGET);
