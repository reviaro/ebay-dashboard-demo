import { withStore } from '@/lib/stores/route';
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

async function handleDELETE(req: Request) {

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // 'sales', 'inventory', or 'all'

  try {
    if (type === 'sales' || type === 'all') {
      await prisma.sale.deleteMany({});
      await prisma.performanceMetric.deleteMany({});
      await prisma.uploadRecord.deleteMany({ where: { type: 'sales' } });
    }
    if (type === 'inventory' || type === 'all') {
      await prisma.inventory.deleteMany({});
      await prisma.uploadRecord.deleteMany({ where: { type: 'active' } });
      await prisma.inventoryExpense.deleteMany({});
      await prisma.uploadRecord.deleteMany({ where: { type: 'inventory-expenses' } });
    }
    if (type === 'fees' || type === 'all') {
      await prisma.ebayFee.deleteMany({});
      await prisma.uploadRecord.deleteMany({ where: { type: 'ebay-fees' } });
    }
    if (type === 'all') {
      await prisma.ebayTransaction.deleteMany({});
      await prisma.promotedListingMetric.deleteMany({});
      await prisma.uploadRecord.deleteMany({ where: { type: { in: ['transactions', 'promoted-listings'] } } });
    }
    return NextResponse.json({ success: true, cleared: type });
  } catch (error) {
    console.error("Reset error:", error);
    return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  }
}

export const DELETE = withStore('admin', handleDELETE);
