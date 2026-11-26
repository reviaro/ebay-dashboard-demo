import { withStore } from '@/lib/stores/route';
import { withStoreData } from '@/lib/stores/context';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

async function handleGET() {
  try {
    const expenses = await prisma.generalExpense.findMany({ orderBy: { date: 'desc' } });

    // Aggregate by category
    const catMap: Record<string, number> = {};
    for (const e of expenses) {
      catMap[e.category] = (catMap[e.category] || 0) + e.amount;
    }
    const byCategory = Object.entries(catMap)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    // Aggregate by month
    const monthMap: Record<string, { month: string; amount: number }> = {};
    for (const e of expenses) {
      const key = e.date.toISOString().substring(0, 7);
      if (!monthMap[key]) monthMap[key] = { month: key, amount: 0 };
      monthMap[key].amount += e.amount;
    }
    const byMonth = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({
      expenses,
      byCategory,
      byMonth,
      total: expenses.reduce((s, e) => s + e.amount, 0),
    });
  } catch (error) {
    console.error('General expenses GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 });
  }
}

async function handlePOST(request: Request) {
  try {
    const body = await request.json();
    const { date, category, amount, description, vendor } = body;
    if (!date || !category || !amount) {
      return NextResponse.json({ error: 'date, category, and amount are required' }, { status: 400 });
    }
    const expense = await prisma.generalExpense.create({
      data: withStoreData({
        date: new Date(date),
        category,
        amount: parseFloat(amount),
        description: description || null,
        vendor: vendor || null,
      }),
    });
    return NextResponse.json(expense, { status: 201 });
  } catch (error) {
    console.error('General expenses POST error:', error);
    return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 });
  }
}

async function handleDELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await prisma.generalExpense.delete({ where: { id: parseInt(id) } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('General expenses DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 });
  }
}

export const GET = withStore('view', handleGET);

export const POST = withStore('edit', handlePOST);

export const DELETE = withStore('edit', handleDELETE);
