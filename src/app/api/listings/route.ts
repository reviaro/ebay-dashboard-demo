import { after, NextResponse } from 'next/server';
import prisma, { adminDb } from '@/lib/prisma';
import { withStore, HttpError } from '@/lib/stores/route';
import { requireStoreContext, withStoreData, hasPermission } from '@/lib/stores/context';
import { limitedJson } from '@/lib/http/body';
import { emptyListing, parseListing, ListingInputError } from '@/lib/ebay/listing/model';
import { enqueueListing, processListingOperation, reconcileOperation, refreshDraft, releaseUncertainCreate, validateDraft } from '@/lib/ebay/listing/service';

export const maxDuration = 300;
export const GET = withStore('view', async request => {
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    const draft = await prisma.listingDraft.findUniqueOrThrow({ where: { id } });
    const operations = await prisma.listingOperation.findMany({ where: { draftId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, status: true, error: true, createdAt: true, listingId: true, kind: true } });
    return NextResponse.json({ draft: { ...draft, payload: JSON.parse(draft.payload), validation: draft.validation ? JSON.parse(draft.validation) : null }, operations });
  }
  return NextResponse.json({ drafts: await prisma.listingDraft.findMany({ orderBy: { updatedAt: 'desc' }, take: 200, select: { id: true, title: true, status: true, version: true, listingId: true, updatedAt: true } }) });
});

export const POST = withStore('edit', async request => {
  try {
    const body = await limitedJson(request) as { action?: string; id?: string; version?: number; key?: string; confirmed?: boolean; payload?: unknown; operationId?: string };
    const context = requireStoreContext();
    if (body.action === 'create') {
      const store = await adminDb.store.findUniqueOrThrow({ where: { id: context.storeId } });
      const payload = emptyListing(store.descriptionTemplate);
      const draft = await prisma.listingDraft.create({ data: withStoreData({ title: '', payload: JSON.stringify(payload), createdById: context.actorId }) });
      return NextResponse.json({ id: draft.id }, { status: 201 });
    }
    if (!body.id || !Number.isInteger(body.version)) throw new HttpError(400, 'Draft ID and version required.');
    if (body.action === 'save') {
      const payload = parseListing(body.payload);
      const count = await prisma.listingAsset.count({ where: { id: { in: payload.assetIds } } });
      if (count !== payload.assetIds.length) throw new HttpError(400, 'One or more photos are unavailable in this store.');
      const result = await prisma.listingDraft.updateMany({ where: { id: body.id, version: body.version, status: { notIn: ['queued', 'running', 'unknown'] } }, data: { title: payload.title, payload: JSON.stringify(payload), version: { increment: 1 }, validation: null, status: 'draft' } });
      if (!result.count) throw new HttpError(409, 'The draft changed or is being published. Reload it before saving.');
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'refresh') return NextResponse.json({ draft: await refreshDraft(body.id, body.version!) });
    if (!hasPermission(context.role, 'publish')) throw new HttpError(403, 'A publisher or administrator role is required.');
    if (body.action === 'validate') return NextResponse.json({ validation: await validateDraft(body.id, body.version!) });
    if (body.action === 'publish') {
      if (body.confirmed !== true || !body.key) throw new HttpError(400, 'Confirm the store, listing, and fees before publishing.');
      const job = await enqueueListing(body.id, body.version!, body.key);
      after(async () => { await processListingOperation(job.id); });
      return NextResponse.json({ operationId: job.id, status: job.status }, { status: 202 });
    }
    if (body.action === 'reconcile' && body.operationId) {
      const job = await prisma.listingOperation.findUniqueOrThrow({ where: { id: body.operationId } });
      if (job.draftId !== body.id) throw new HttpError(404, 'Operation not found.');
      await reconcileOperation(body.operationId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'release' && body.operationId) {
      if (body.confirmed !== true) throw new HttpError(400, 'Confirm that Seller Hub shows no listing for this request.');
      const job = await prisma.listingOperation.findUniqueOrThrow({ where: { id: body.operationId } });
      if (job.draftId !== body.id) throw new HttpError(404, 'Operation not found.');
      return NextResponse.json({ ok: true, outcome: await releaseUncertainCreate(body.operationId) });
    }
    throw new HttpError(400, 'Unknown listing action.');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if ((error as { code?: string })?.code) throw error;
    throw new HttpError(error instanceof ListingInputError ? 400 : 409, error instanceof Error ? error.message : 'Unable to update listing.');
  }
});
