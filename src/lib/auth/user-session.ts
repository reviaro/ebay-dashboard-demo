import { randomBytes } from 'node:crypto';
import { adminDb } from '../prisma';
import { authenticateRequest } from './guard';
import { buildSessionPayload, signSession } from './session';
import type { AuthConfig } from './config';

export async function createUserSession(userId: string, config: AuthConfig) {
  const id = randomBytes(32).toString('hex');
  await adminDb.userSession.create({ data: {
    id, userId, expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1000),
  } });
  return signSession(config.sessionSecret, {
    ...buildSessionPayload(userId, config.sessionTtlSeconds), sid: id,
  });
}

export async function currentUser(request: Request) {
  const auth = await authenticateRequest(request);
  if (auth.status !== 'ok' || !auth.session.sid) return null;
  const session = await adminDb.userSession.findUnique({
    where: { id: auth.session.sid }, include: { user: true },
  });
  if (!session || session.userId !== auth.session.sub || session.expiresAt <= new Date() || session.user.disabledAt) return null;
  return { user: session.user, sessionId: session.id };
}
