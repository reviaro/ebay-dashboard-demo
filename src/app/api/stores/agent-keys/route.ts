import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/prisma';
import { requireStoreContext } from '@/lib/stores/context';
import { withStore, HttpError, tokenHash } from '@/lib/stores/route';

export const GET = withStore('admin', async () => NextResponse.json({ keys: await adminDb.agentKey.findMany({
  where: { storeId: requireStoreContext().storeId }, select: { id: true, name: true, canEditTasks: true, revokedAt: true, createdAt: true },
}) }));
export const POST = withStore('admin', async request => {
  const { name, canEditTasks } = await request.json();
  if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new HttpError(400, 'Enter a key name.');
  const token = randomBytes(32).toString('base64url');
  const key = await adminDb.agentKey.create({ data: { storeId: requireStoreContext().storeId, name: name.trim(), canEditTasks: canEditTasks === true, tokenHash: tokenHash(token) } });
  return NextResponse.json({ id: key.id, token }, { status: 201 });
});
export const DELETE = withStore('admin', async request => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) throw new HttpError(400, 'Key ID required.');
  await adminDb.agentKey.updateMany({ where: { id, storeId: requireStoreContext().storeId }, data: { revokedAt: new Date() } });
  return NextResponse.json({ ok: true });
});
