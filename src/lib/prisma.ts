import { PrismaClient } from '@prisma/client'
import { createScopedClient } from './stores/scoped-client';
import { assertDemoReadOperation, demoDatabaseUrl } from './demo/database';
import { isDemoMode } from './demo/server';

const globalForPrisma = global as unknown as { prisma: PrismaClient }

const base =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    ...(isDemoMode() ? { datasourceUrl: demoDatabaseUrl() } : {}),
  })

globalForPrisma.prisma = base;

export const adminDb = base.$extends({
  name: 'demo-read-only',
  query: {
    $allOperations({ model, operation, args, query }) {
      if (isDemoMode()) assertDemoReadOperation(model, operation);
      return query(args);
    },
  },
}) as unknown as PrismaClient;

// All business-data imports fail closed unless an authorized route or worker
// established a store context. adminDb is reserved for identity/administration.
export default createScopedClient(base);
