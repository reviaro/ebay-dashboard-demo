import { withStore } from '@/lib/stores/route';
import { NextRequest, NextResponse } from "next/server";
import { filterInventory, loadUnifiedInventory } from "@/lib/inventory/store";

async function handleGET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);
  const search = searchParams.get("search") ?? "";
  // active | sold | ended | unknown -- absent means every status.
  const status = searchParams.get("status");

  // CSV uploads and the Active Inventory Report as one list. The API wins on
  // price, quantity and listing status; the CSV supplies title, brand and cost,
  // which the report does not carry. See src/lib/inventory/unified.ts.
  const searched = filterInventory(await loadUnifiedInventory(), search);
  const all = status ? searched.filter((row) => row.status === status) : searched;
  const items = all.slice((page - 1) * limit, page * limit);

  // The breakdown is computed over `searched`, before the status filter, so the
  // filter control's own counts do not move as the operator switches filters.
  // Only listings the report currently shows are really "in stock"; a CSV row
  // the report has never mentioned may have sold months ago.
  const active = searched.filter((row) => row.status === 'active');

  return NextResponse.json({
    items,
    total: all.length,
    page,
    stats: {
      _sum: { quantity: all.reduce((sum, row) => sum + row.quantity, 0) },
      _count: { _all: all.length },
      _avg: { price: all.length ? all.reduce((s, r) => s + r.price, 0) / all.length : 0 },
    },
    listingStatus: {
      active: active.length,
      activeQuantity: active.reduce((sum, row) => sum + row.quantity, 0),
      activeValue: active.reduce((sum, row) => sum + row.price * row.quantity, 0),
      sold: searched.filter((row) => row.status === 'sold').length,
      ended: searched.filter((row) => row.status === 'ended').length,
      unknown: searched.filter((row) => row.status === 'unknown').length,
    },
  });
}

export const GET = withStore('view', handleGET);
