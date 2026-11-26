import { guardDemoRoute } from '@/lib/demo/guard';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/prisma';
import { currentUser } from '@/lib/auth/user-session';
import { verifySameOrigin } from '@/lib/http/request-guard';
import { HttpError, routeError, tokenHash } from '@/lib/stores/route';

async function owner(request: Request) {
  const identity = await currentUser(request);
  if (!identity) throw new HttpError(401, 'Authentication required.');
  if (!identity.user.isOwner) throw new HttpError(403, 'Dashboard owner access required.');
  return identity;
}
export async function GET(request: Request) {
  const demoBlocked = guardDemoRoute('/api/users', 'GET');
  if (demoBlocked) return demoBlocked;
  try {
    await owner(request);
    return NextResponse.json({ users: await adminDb.user.findMany({ select: { id: true, username: true, displayName: true, isOwner: true, disabledAt: true } }) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return routeError(error); }
}
export async function PATCH(request: Request) {
  const demoBlocked = guardDemoRoute('/api/users', 'PATCH');
  if (demoBlocked) return demoBlocked;
  try {
    await owner(request); verifySameOrigin(request.headers);
    const { userId, action } = await request.json();
    if (typeof userId !== 'string' || !['disable', 'enable', 'reset-password'].includes(action)) throw new HttpError(400, 'Invalid user action.');
    const token = randomBytes(32).toString('base64url');
    await adminDb.$transaction(async tx => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.isOwner) throw new HttpError(409, 'Use the owner recovery command for the owner account.');
      await tx.userSession.deleteMany({ where: { userId } });
      if (action === 'reset-password') {
        await tx.userInvitation.deleteMany({ where: { userId } });
        await tx.userInvitation.create({ data: { userId, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 86400000) } });
        await tx.user.update({ where: { id: userId }, data: { passwordHash: null } });
      } else await tx.user.update({ where: { id: userId }, data: { disabledAt: action === 'disable' ? new Date() : null } });
    });
    return NextResponse.json({ ok: true, setupPath: action === 'reset-password' ? `/join#token=${encodeURIComponent(token)}` : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeError(error); }
}
