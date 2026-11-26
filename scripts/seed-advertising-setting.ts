import './refuse-demo';
import { withStoreData } from '../src/lib/stores/context';
import { PrismaClient } from '@prisma/client';
import { createScopedClient } from '../src/lib/stores/scoped-client';
import { runInStore } from '../src/lib/stores/context';

const database = new PrismaClient();
const prisma = createScopedClient(database);
const storeId = process.argv[process.argv.indexOf('--store') + 1];
if (!process.argv.includes('--store') || !storeId) throw new Error('Pass --store <store-id>.');
if (!await database.store.findUnique({ where: { id: storeId } })) throw new Error('Store not found.');
const context = { storeId, actorId: 'maintenance', role: 'admin' as const };

await runInStore(context, () => prisma.ebaySyncSetting.upsert({
  where: { storeId_domain: withStoreData({ domain: 'advertising' }) },
  create: withStoreData({ domain: 'advertising', frequency: 'daily', lookbackDays: 1, enabled: true }),
  update: {},
}));

console.log('advertising sync setting ensured');
await database.$disconnect();
