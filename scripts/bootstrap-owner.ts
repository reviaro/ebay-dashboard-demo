import './refuse-demo';
/** Bootstrap only an empty user table; never change an existing user's access. */
import { PrismaClient } from '@prisma/client';
import { parseScryptHash } from '../src/lib/auth/password-hash';
import { tokenHash } from '../src/lib/auth/token-hash';
import { isValidUsername, normalizeUsername } from '../src/lib/auth/username';

const db = new PrismaClient();
try {
  const username = normalizeUsername(process.env.DASHBOARD_OWNER_USERNAME || 'owner');
  if (!isValidUsername(username)) throw new Error('Invalid DASHBOARD_OWNER_USERNAME.');
  const passwordHash = process.env.DASHBOARD_PASSWORD_HASH?.trim();
  if (!passwordHash) throw new Error('Set DASHBOARD_PASSWORD_HASH before bootstrapping the owner.');
  parseScryptHash(passwordHash);
  await db.$transaction(async tx => {
    if (await tx.user.count()) { console.log('Users already exist; bootstrap skipped.'); return; }
    const store = await tx.store.findUniqueOrThrow({ where: { id: 'legacy' } });
    const user = await tx.user.create({ data: { username, displayName: 'Owner', passwordHash, isOwner: true } });
    await tx.storeMembership.create({ data: { storeId: store.id, userId: user.id, role: 'admin' } });
    // Preserve existing automation, restricted to the original store. New keys
    // are issued in Store settings; the raw environment value is never stored.
    const token = process.env.EMILY_API_TOKEN?.trim();
    if (token) await tx.agentKey.create({ data: {
      storeId: store.id, name: 'Existing agent', canEditTasks: true,
      tokenHash: tokenHash(token),
    } });
    console.log(`Owner '${username}' created. Sign in with the existing dashboard password.`);
  });
} finally { await db.$disconnect(); }
