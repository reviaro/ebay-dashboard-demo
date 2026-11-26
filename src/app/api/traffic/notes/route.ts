import { withStore } from '@/lib/stores/route';
import { withStoreData } from '@/lib/stores/context';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const VALID_TAGS = [
  "needs better title",
  "lower price",
  "bad photos",
  "seasonal",
  "restock",
  "good performer",
] as const;

async function handleGET(req: NextRequest) {
  const listingId = req.nextUrl.searchParams.get("listingId");
  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 });

  const notes = await prisma.listingNote.findMany({
    where: { listingId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    notes: notes.map((n) => ({
      id: n.id,
      listingId: n.listingId,
      tags: JSON.parse(n.tags) as string[],
      note: n.note,
      createdAt: n.createdAt.toISOString(),
    })),
  });
}

async function handlePOST(req: NextRequest) {
  const body = await req.json() as { listingId?: string; tags?: string[]; note?: string };
  const { listingId, tags = [], note } = body;

  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 });
  if (tags.length === 0 && !note?.trim()) {
    return NextResponse.json({ error: "Provide at least one tag or a note" }, { status: 400 });
  }

  const cleanTags = tags.filter((t) => (VALID_TAGS as readonly string[]).includes(t));

  const created = await prisma.listingNote.create({
    data: withStoreData({
      listingId,
      tags: JSON.stringify(cleanTags),
      note: note?.trim() || null,
    }),
  });

  return NextResponse.json({
    note: {
      id: created.id,
      listingId: created.listingId,
      tags: cleanTags,
      note: created.note,
      createdAt: created.createdAt.toISOString(),
    },
  });
}

export const GET = withStore('view', handleGET);

export const POST = withStore('edit', handlePOST);
