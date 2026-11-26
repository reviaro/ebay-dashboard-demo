import { isValidUsername, normalizeUsername } from '@/lib/auth/username';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/prisma';
import { withStore, HttpError, tokenHash } from '@/lib/stores/route';
import { requireStoreContext } from '@/lib/stores/context';

export const GET = withStore('admin', async () => {
  const rows = await adminDb.storeMembership.findMany({ where: { storeId: requireStoreContext().storeId }, include: { user: { select: { id: true, username: true, displayName: true, disabledAt: true, isOwner: true } } } });
  return NextResponse.json({ members: rows.map(r => ({ ...r.user, role: r.role })) });
});

export const POST = withStore('admin', async request => {
  const { storeId, actorId } = requireStoreContext();
  const { username: raw, role } = await request.json();
  const username = normalizeUsername(raw);
  if (!isValidUsername(username) || !['admin', 'publisher', 'editor', 'viewer'].includes(role)) throw new HttpError(400, 'Choose a valid username and role.');
  const token = randomBytes(32).toString('base64url');
  const result = await adminDb.$transaction(async tx => {
    let user = await tx.user.findUnique({ where: { username } });
    const isNew = !user;
    if (!user) user = await tx.user.create({ data: { username, displayName: username } });
    if (user.disabledAt) throw new HttpError(409, 'This user is disabled. Ask the dashboard owner to restore access.');
    // Existing accounts retain their password; store admins cannot reset a
    // person's identity and thereby obtain access to their other stores.
    await tx.storeMembership.create({ data: { storeId, userId: user.id, role } });
    if (isNew) await tx.userInvitation.create({ data: { userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 86400000) } });
    await tx.auditEvent.create({ data: { storeId, actorId, action: 'member.add', entityId: user.id, detail: role } });
    return { isNew, username };
  });
  return NextResponse.json({ username, setupPath: result.isNew ? `/join#token=${encodeURIComponent(token)}` : null }, { status: 201 });
});

export const PATCH = withStore('admin', async request => {
  const { storeId, actorId } = requireStoreContext();
  const { userId, role } = await request.json();
  if (typeof userId !== 'string' || !['admin', 'publisher', 'editor', 'viewer', 'remove'].includes(role)) throw new HttpError(400, 'Invalid member update.');
  await adminDb.$transaction(async tx => {
    const member = await tx.storeMembership.findUnique({ where: { storeId_userId: { storeId, userId } }, include: { user: true } });
    if (!member) throw new HttpError(404, 'Member not found.');
    if (member.user.isOwner && role !== 'admin') throw new HttpError(409, 'The dashboard owner retains administration access.');
    if (member.role === 'admin' && role !== 'admin') {
      const admins = await tx.storeMembership.count({ where: { storeId, role: 'admin', user: { disabledAt: null } } });
      if (admins <= 1) throw new HttpError(409, 'Keep at least one active store administrator.');
    }
    if (role === 'remove') await tx.storeMembership.delete({ where: { storeId_userId: { storeId, userId } } });
    else await tx.storeMembership.update({ where: { storeId_userId: { storeId, userId } }, data: { role } });
    await tx.auditEvent.create({ data: { storeId, actorId, action: 'member.change', entityId: userId, detail: role } });
  });
  return NextResponse.json({ ok: true });
});
