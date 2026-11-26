import './refuse-demo';
// One-time backfill: normalize brand values already stored in the database
// (e.g. "VW" → "Volkswagen", "Mercedes" → "Mercedes-Benz", "LAND" → "Land Rover").
// New uploads are normalized on write; this fixes rows imported before that.
//
// Run with: node scripts/backfill-brands.ts
import { PrismaClient } from '@prisma/client';
import { createScopedClient } from '../src/lib/stores/scoped-client';
import { runInStore } from '../src/lib/stores/context';
import { normalizeBrand } from '../src/lib/brand-normalizer';

const database = new PrismaClient();
const prisma = createScopedClient(database);
const storeId = process.argv[process.argv.indexOf('--store') + 1];
if (!process.argv.includes('--store') || !storeId) throw new Error('Pass --store <store-id>.');
if (!await database.store.findUnique({ where: { id: storeId } })) throw new Error('Store not found.');
const context = { storeId, actorId: 'maintenance', role: 'admin' as const };

async function backfillColumn(
  label: string,
  rows: { id: number; value: string | null }[],
  update: (id: number, value: string) => Promise<unknown>,
) {
  let changed = 0;
  for (const row of rows) {
    const normalized = normalizeBrand(row.value);
    if (row.value !== normalized) {
      await update(row.id, normalized);
      changed++;
    }
  }
  console.log(`${label}: ${changed} of ${rows.length} rows updated`);
}

async function main() {
  const inventory = await prisma.inventory.findMany({ select: { id: true, brand: true } });
  await backfillColumn(
    'Inventory.brand',
    inventory.map(r => ({ id: r.id, value: r.brand })),
    (id, brand) => prisma.inventory.update({ where: { id }, data: { brand } }),
  );

  const sales = await prisma.sale.findMany({ select: { id: true, brand: true } });
  await backfillColumn(
    'Sale.brand',
    sales.map(r => ({ id: r.id, value: r.brand })),
    (id, brand) => prisma.sale.update({ where: { id }, data: { brand } }),
  );

  const metrics = await prisma.performanceMetric.findMany({
    select: { id: true, topBrand: true },
    where: { topBrand: { not: null } },
  });
  await backfillColumn(
    'PerformanceMetric.topBrand',
    metrics.map(r => ({ id: r.id, value: r.topBrand })),
    (id, topBrand) => prisma.performanceMetric.update({ where: { id }, data: { topBrand } }),
  );
}

runInStore(context, main)
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => database.$disconnect());
