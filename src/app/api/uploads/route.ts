import { withStore } from '@/lib/stores/route';
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

async function handleGET() {
  try {
    const uploads = await prisma.uploadRecord.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(uploads);
  } catch (error) {
    console.error("Error fetching uploads:", error);
    return NextResponse.json({ error: "Failed to fetch uploads" }, { status: 500 });
  }
}

async function handleDELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    await prisma.uploadRecord.delete({ where: { id: Number(id) } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting upload:", error);
    return NextResponse.json({ error: "Failed to delete upload record" }, { status: 500 });
  }
}

export const GET = withStore('view', handleGET);

export const DELETE = withStore('admin', handleDELETE);
