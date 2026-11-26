/** Explicit local fixture writer. Never imports app runtime, credentials or external clients. */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmodSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { buildDemoData, DEMO_AS_OF, DEMO_START, DEMO_INSTANT } from '../src/lib/demo/data';
import { assertDemoDatabasePath, DEMO_PROJECT_ROOT, writeDemoManifest } from '../src/lib/demo/seed-safety';
import { verifyDemoDatabase } from './build-demo-answers';
import { DEMO_STORE_ID, DEMO_STORE_NAME } from '../src/lib/demo/config';
import { emptyListing } from '../src/lib/ebay/listing/model';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => {
  prepare(sql: string): { all(): { migration_name: string }[]; run(...values: string[]): void };
  exec(sql: string): void;
  close(): void;
} };

function stabilizeMigrationHistory(path: string) {
  // The migration chain creates this metadata with random UUIDs and wall-clock
  // timestamps. Keep its application order, migration names and SQL checksums.
  const db = new DatabaseSync(path);
  try {
    const rows = db.prepare('SELECT migration_name FROM _prisma_migrations ORDER BY rowid').all();
    const update = db.prepare('UPDATE _prisma_migrations SET id = ?, started_at = ?, finished_at = ? WHERE migration_name = ?');
    for (const { migration_name } of rows) {
      const id = createHash('sha256').update(migration_name).digest('hex');
      const date = DEMO_INSTANT.toISOString();
      update.run(`${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`, date, date, migration_name);
    }
    // Strip discarded pages that can retain the original migration timestamps.
    db.exec('VACUUM');
  } finally { db.close(); }
}

async function seedSnapshot(path: string) {
  const result = spawnSync(process.execPath, [resolve(DEMO_PROJECT_ROOT, 'node_modules/prisma/build/index.js'),
    'migrate', 'deploy', '--schema', resolve(DEMO_PROJECT_ROOT, 'prisma/schema.prisma')], {
    cwd: DEMO_PROJECT_ROOT, env: { ...process.env, DATABASE_URL: `file:${path}` }, encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`Demo migration setup failed: ${result.stderr || result.stdout || result.error}`);
  const db = new PrismaClient({ datasourceUrl: `file:${path}` });
  const data = buildDemoData();
  try {
    await db.$transaction(async tx => {
      // The store ownership migration creates a placeholder on an empty DB.
      // The demo contains exactly one store, even when queried outside the app.
      await tx.ebaySyncSetting.deleteMany({ where: { storeId: 'legacy' } });
      await tx.store.deleteMany();
      const timestamps = { createdAt: DEMO_INSTANT, updatedAt: DEMO_INSTANT };
      await tx.store.create({ data: { id: DEMO_STORE_ID, name: DEMO_STORE_NAME, writeEnabled: false, ...timestamps } });
      const batch = async <T>(rows: T[], insert: (rows: (T & { storeId: string })[]) => Promise<unknown>) => {
        for (let offset = 0; offset < rows.length; offset += 200) {
          await insert(rows.slice(offset, offset + 200).map(row => ({ ...row, storeId: DEMO_STORE_ID })));
        }
      };
      const drafts = data.inventory.slice(0, 3).map((row, index) => ({
        id: `sample-draft-${index + 1}`,
        createdById: 'demo:viewer',
        title: row.title,
        payload: JSON.stringify({
          ...emptyListing(), title: row.title, sku: row.sku, price: row.price.toFixed(2), quantity: 1,
          description: 'Sample used auto part. Inspect the part number and confirm vehicle fitment before purchase.',
          conditionDescription: 'Sample part with light cosmetic wear.',
          categoryId: '999001', specifics: [{ name: 'Part Number', value: row.sku }],
        }),
        ...timestamps,
      }));
      await batch(drafts, rows => tx.listingDraft.createMany({ data: rows }));
      await batch(data.inventory, rows => tx.inventory.createMany({ data: rows }));
      await batch(data.offers, rows => tx.ebayOffer.createMany({ data: rows }));
      await batch(data.sales, rows => tx.sale.createMany({ data: rows }));
      await batch(data.orders, rows => tx.ebayOrder.createMany({ data: rows }));
      await batch(data.transactions, rows => tx.ebayTransaction.createMany({ data: rows }));
      await batch(data.finance, rows => tx.ebayFinanceTransaction.createMany({ data: rows }));
      await batch(data.payouts, rows => tx.ebayPayout.createMany({ data: rows }));
      await batch(data.campaigns, rows => tx.ebayAdCampaign.createMany({ data: rows }));
      await batch(data.adReports, rows => tx.ebayAdReport.createMany({ data: rows }));
      await batch(data.legacyAds, rows => tx.promotedListingMetric.createMany({ data: rows }));
      await batch(data.inventoryExpenses, rows => tx.inventoryExpense.createMany({ data: rows }));
      await batch(data.generalExpenses, rows => tx.generalExpense.createMany({ data: rows }));
      await batch(data.fees, rows => tx.ebayFee.createMany({ data: rows }));
      await batch(data.trafficDays, rows => tx.ebayTrafficDay.createMany({ data: rows }));
      await batch(data.trafficListings, rows => tx.ebayTrafficListing.createMany({ data: rows }));
      await batch(data.performance, rows => tx.performanceMetric.createMany({ data: rows }));
      await batch(data.comparisons, rows => tx.ebayPriceComparison.createMany({ data: rows }));
      await batch(data.notes, rows => tx.listingNote.createMany({ data: rows }));
      await batch(data.tasks, rows => tx.task.createMany({ data: rows }));
      await batch(data.uploads, rows => tx.uploadRecord.createMany({ data: rows }));
      await batch(data.syncSettings, rows => tx.ebaySyncSetting.createMany({ data: rows }));
      await batch(data.syncLogs, rows => tx.ebaySyncLog.createMany({ data: rows }));
    }, { timeout: 180_000 });
  } finally { await db.$disconnect(); }
  stabilizeMigrationHistory(path);
}

async function main() {
  const destination = assertDemoDatabasePath({ allowMissing: true, requireManifestWhenExists: true, rejectSidecars: true });
  const staging = mkdtempSync(resolve(dirname(destination), '.demo-seed-'));
  const snapshot = resolve(staging, 'demo.db');
  try {
    await seedSnapshot(snapshot);
    const verification = verifyDemoDatabase(snapshot);
    const manifest = writeDemoManifest(snapshot);
    chmodSync(snapshot, 0o444);
    // Recheck the destination after building. A changed or unrelated database
    // must never be overwritten. A partial install fails provenance validation.
    assertDemoDatabasePath({ allowMissing: true, requireManifestWhenExists: true, rejectSidecars: true });
    renameSync(snapshot, destination);
    renameSync(resolve(staging, 'demo-manifest.json'), resolve(dirname(destination), 'demo-manifest.json'));
    console.log(JSON.stringify({ store: DEMO_STORE_NAME, synthetic: true, window: [DEMO_START, DEMO_AS_OF], database: 'prisma/demo.db', sha256: manifest.sha256, ...verification }, null, 2));
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
