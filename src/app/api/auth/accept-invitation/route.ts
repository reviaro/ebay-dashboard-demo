import { guardDemoRoute } from '@/lib/demo/guard';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/prisma';
import { hashPassword, MAXIMUM_PASSWORD_BYTES } from '@/lib/auth/password';
import { loginWorkLimiter } from '@/lib/auth/rate-limit';
import { verifySameOrigin } from '@/lib/http/request-guard';
import { HttpError, routeError, tokenHash } from '@/lib/stores/route';

export async function POST(request: Request) {
  const demoBlocked = guardDemoRoute('/api/auth/accept-invitation', 'POST');
  if (demoBlocked) return demoBlocked;
  try {
    verifySameOrigin(request.headers);
    if (!loginWorkLimiter.take().allowed) throw new HttpError(429, 'Too many attempts. Try again shortly.');
    const { token, password } = await request.json();
    if (typeof token !== 'string' || token.length > 100 || typeof password !== 'string' || password.trim().length < 8 || Buffer.byteLength(password) > MAXIMUM_PASSWORD_BYTES) throw new HttpError(400, 'Provide a valid setup link and a password of at least 8 characters.');
    const hash = tokenHash(token);
    const invite = await adminDb.userInvitation.findUnique({ where: { tokenHash: hash }, include: { user: true } });
    if (!invite || invite.consumedAt || invite.expiresAt <= new Date() || invite.user.disabledAt) throw new HttpError(400, 'This setup link is invalid or expired.');
    const passwordHash = hashPassword(password);
    await adminDb.$transaction(async tx => {
      const consumed = await tx.userInvitation.updateMany({ where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new HttpError(400, 'This setup link is invalid or expired.');
      await tx.user.update({ where: { id: invite.userId }, data: { passwordHash } });
      await tx.userSession.deleteMany({ where: { userId: invite.userId } });
    });
    return NextResponse.json({ username: invite.user.username }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeError(error); }
}
