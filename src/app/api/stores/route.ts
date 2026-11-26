import { DEMO_STORE } from '@/lib/demo/store';
import { isDemoMode } from '@/lib/demo/server';
import { guardDemoRoute } from '@/lib/demo/guard';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/prisma';
import { currentUser } from '@/lib/auth/user-session';
import { verifySameOrigin } from '@/lib/http/request-guard';
import { HttpError, routeError, withStore } from '@/lib/stores/route';
import { requireStoreContext } from '@/lib/stores/context';

export async function GET(request: Request) {
  const demoBlocked = guardDemoRoute('/api/stores', 'GET');
  if (demoBlocked) return demoBlocked;
  if (isDemoMode()) return NextResponse.json({ stores: [DEMO_STORE], isOwner: false }, { headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const identity = await currentUser(request);
    if (!identity) throw new HttpError(401, 'Authentication required.');
    const memberships = await adminDb.storeMembership.findMany({
      where: { userId: identity.user.id, store: { archivedAt: null } }, include: { store: true }, orderBy: { store: { createdAt: 'asc' } },
    });
    return NextResponse.json({ stores: memberships.map(m => ({ ...m.store, role: m.role })), isOwner: identity.user.isOwner }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  const demoBlocked = guardDemoRoute('/api/stores', 'POST');
  if (demoBlocked) return demoBlocked;
  try {
    const identity = await currentUser(request);
    if (!identity) throw new HttpError(401, 'Authentication required.');
    if (!identity.user.isOwner) throw new HttpError(403, 'Only the dashboard owner can add stores.');
    verifySameOrigin(request.headers);
    const body = await request.json();
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) throw new HttpError(400, 'Enter a store name of up to 100 characters.');
    const store = await adminDb.$transaction(async tx => {
      const store = await tx.store.create({ data: { name: body.name.trim(), memberships: { create: { userId: identity.user.id, role: 'admin' } } } });
      await tx.ebaySyncSetting.createMany({ data: ['orders', 'inventory', 'traffic', 'finances', 'payouts', 'advertising'].map(domain => ({
        storeId: store.id, domain, enabled: true, frequency: 'manual', lookbackDays: ['inventory', 'advertising'].includes(domain) ? 1 : 30,
      })) });
      return store;
    });
    return NextResponse.json({ store }, { status: 201 });
  } catch (error) { return routeError(error); }
}

export const PATCH = withStore('admin', async (request: NextRequest) => {
  const { storeId, actorId } = requireStoreContext();
  const body = await request.json();
  const data: { name?: string; writeEnabled?: boolean; descriptionTemplate?: string } = {};
  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) throw new HttpError(400, 'Enter a store name of up to 100 characters.');
    data.name = body.name.trim();
  }
  if ('writeEnabled' in body) {
    if (typeof body.writeEnabled !== 'boolean') throw new HttpError(400, 'Invalid write setting.');
    data.writeEnabled = body.writeEnabled;
  }
  if ('descriptionTemplate' in body) {
    if (typeof body.descriptionTemplate !== 'string' || body.descriptionTemplate.length > 20000) throw new HttpError(400, 'Template is too long.');
    data.descriptionTemplate = body.descriptionTemplate;
  }
  const store = await adminDb.$transaction(async tx => {
    const store = await tx.store.update({ where: { id: storeId }, data });
    await tx.auditEvent.create({ data: { storeId, actorId, action: 'store.settings', detail: JSON.stringify(data) } });
    return store;
  });
  return NextResponse.json({ store });
});
