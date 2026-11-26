import './refuse-demo';
import { withStoreData, runInStore, requireStoreContext } from '../src/lib/stores/context';
/**
 * Runs whichever eBay syncs are due.
 *
 * The systemd timer ticks hourly and this decides what actually runs, so the
 * schedule lives in `EbaySyncSetting` where `/settings` can change it rather
 * than in an OnCalendar line only a shell can edit.
 *
 *   npm run sync                              # everything due
 *   npm run sync -- --force                   # run every enabled domain now
 *   npm run sync -- --domain orders           # one domain only
 *
 * `--days` overrides the domain's stored lookback for this run only, and
 * `--max-requests` lowers the eBay call budget.
 *
 * **Traffic needs no backfill command.** Each run repairs whatever is missing
 * and fetches as much history as the day's remaining eBay allowance permits,
 * so the hourly tick finishes a two-year backfill on its own over about nine
 * days. Nothing needs to be scheduled or remembered by a human.
 *
 * A traffic run that finds the allowance spent is **skipped, not failed** --
 * the same rule as a run refused because another holds the lease. It is the
 * scheduler waiting for the 07:00Z reset, not a fault, and logging it as a
 * failure would leave the dashboard's freshness banner red most of the day.
 *
 * Deliberately does NOT import `src/lib/ebay/server.ts`: that module is marked
 * `server-only` and throws outside a Next request. Config and stores are built
 * from the same non-Next primitives its helpers wrap.
 *
 * Exit codes: 0 on success and when nothing is due, 0 when another run already
 * holds the lease (a tick finding one in progress is normal, not a fault), 1
 * if any domain actually failed -- so `systemctl --failed` means what it looks
 * like it means.
 */

import { PrismaClient } from '@prisma/client';
import { createScopedClient } from '../src/lib/stores/scoped-client';
import { ebayEnvironment, loadEbayConfig } from '../src/lib/ebay/config';
import { createPrismaStores } from '../src/lib/ebay/prisma-stores';
import { createPrismaOrderWriter } from '../src/lib/ebay/sync/prisma-order-writer';
import { createPrismaSyncLog } from '../src/lib/ebay/sync/prisma-sync-log';
import { createPrismaSyncLockStore } from '../src/lib/ebay/prisma-sync-lock';
import { createEbayClient } from '../src/lib/ebay/client';
import { createTokenProvider } from '../src/lib/ebay/access-token';
import { exchangeWithEbay } from '../src/lib/ebay/token-exchange';
import { fetchTrafficBudget, REFRESH_RESERVE } from '../src/lib/ebay/sync/traffic-budget';
import { createPrismaOfferStore } from '../src/lib/ebay/sync/prisma-offer-writer';
import { createPrismaTrafficStore } from '../src/lib/ebay/sync/prisma-traffic-writer';
import { createPrismaChunkStore } from '../src/lib/ebay/sync/prisma-chunk-store';
import { runOrdersSync } from '../src/lib/ebay/sync/run-orders';
import { runInventorySync } from '../src/lib/ebay/sync/run-inventory';
import { describeTrafficRun, runTrafficSync } from '../src/lib/ebay/sync/run-traffic';
import { runFinanceSync } from '../src/lib/ebay/sync/run-finance';
import { runPayoutSync } from '../src/lib/ebay/sync/run-payout';
import { runAdsSync } from '../src/lib/ebay/sync/run-ads';
import { createPrismaFinanceStore } from '../src/lib/ebay/sync/prisma-finance-writer';
import { createPrismaAdCampaignStore } from '../src/lib/ebay/sync/prisma-ad-campaign-writer';
import { SyncLockedError } from '../src/lib/ebay/sync-lock';
import { isDue, nextRunAfter, shouldAttemptStoreSync } from '../src/lib/ebay/sync/schedule';
import { redactString } from '../src/lib/ebay/redact';

const database = new PrismaClient();
const prisma = createScopedClient(database);
const argv = process.argv.slice(2);
const force = argv.includes('--force');
const only = argv.includes('--domain') ? argv[argv.indexOf('--domain') + 1] : null;
const daysOverride = argv.includes('--days') ? Number(argv[argv.indexOf('--days') + 1]) : null;
const arg = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);

if (daysOverride !== null && (!Number.isInteger(daysOverride) || daysOverride < 1)) {
  console.error(`--days must be a whole number of days, got "${arg('--days')}".`);
  process.exit(1);
}

const maxRequests = argv.includes('--max-requests')
  ? Number(arg('--max-requests'))
  : null;

if (maxRequests !== null && (!Number.isInteger(maxRequests) || maxRequests < 1)) {
  console.error(`--max-requests must be a whole number, got "${arg('--max-requests')}".`);
  process.exit(1);
}

const resolve = () => ({
  config: { ...loadEbayConfig(process.env), marketplaceId: requireStoreContext().marketplaceId! },
  accounts: createPrismaStores(prisma).accounts,
});
const shared = {
  lockStore: createPrismaSyncLockStore(prisma),
  recorder: createPrismaSyncLog(prisma),
  trigger: 'cron',
  resolve,
};

/**
 * Raised when eBay's daily traffic allowance is gone. Not a failure: the run
 * never starts, so nothing writes a `failed` row and freshness stays honest.
 */
class NoAllowanceError extends Error {
  // Written out rather than declared as a constructor parameter property:
  // these scripts run under Node's strip-only TypeScript, which rejects those
  // outright. `tsc --noEmit` accepts them, so it cannot catch this.
  readonly domain: string;

  constructor(domain: string) {
    super(`eBay's daily allowance for ${domain} is spent.`);
    this.name = 'NoAllowanceError';
    this.domain = domain;
  }
}

/** Remaining traffic calls, less a reserve for the next refresh. Null if unknown. */
async function trafficBudget(): Promise<number | null> {
  try {
    const { config, accounts } = resolve();
    const tokens = createTokenProvider({ config, accounts, exchange: exchangeWithEbay });
    const client = createEbayClient({ config, getAccessToken: () => tokens.getAccessToken() });
    const budget = await fetchTrafficBudget(client);
    if (!budget) return null;

    console.log(
      `traffic: ${budget.remaining}/${budget.limit} eBay calls left` +
        `${budget.resetAt ? `, resets ${budget.resetAt.toISOString()}` : ''}`
    );
    // The reserve keeps a refresh possible after a backfill has had its fill;
    // when little is left, spend it on the refresh rather than holding it back.
    return budget.remaining > REFRESH_RESERVE ? budget.remaining - REFRESH_RESERVE : budget.remaining;
  } catch {
    // A diagnostic endpoint must not be able to stop syncing. The run falls
    // back to its own conservative cap.
    return null;
  }
}

async function runDomain(domain: string, lookbackDays: number): Promise<string> {
  if (domain === 'orders') {
    const r = await runOrdersSync({
      ...shared,
      writer: createPrismaOrderWriter(prisma),
      days: lookbackDays,
    });
    return `fetched ${r.fetched}, stored ${r.stored}, skipped ${r.skipped.length}`;
  }

  if (domain === 'inventory') {
    const r = await runInventorySync({ ...shared, offers: createPrismaOfferStore(prisma) });
    return `${r.active} active, ${r.sold} sold, ${r.ended} ended (${r.total} listings)`;
  }

  if (domain === 'traffic') {
    // Ask eBay what is left rather than counting locally: a local tally cannot
    // see calls spent by an earlier tick, a manual run, or anything else using
    // the same credentials.
    const budget = maxRequests ?? (await trafficBudget());
    if (budget !== null && budget < 1) {
      throw new NoAllowanceError('traffic');
    }
    const r = await runTrafficSync({
      ...shared,
      chunks: createPrismaChunkStore(prisma),
      traffic: createPrismaTrafficStore(prisma),
      days: lookbackDays,
      maxRequests: budget ?? undefined,
    });
    const window = `${r.from.toISOString().slice(0, 10)}..${r.to.toISOString().slice(0, 10)}`;
    const note = describeTrafficRun(r);
    return `${r.dayRows} store rows, ${r.listingRows} listing rows over ${window} ` +
      `in ${r.requests} requests${note ? ` — ${note}` : ''}`;
  }

  if (domain === 'finances') {
    const r = await runFinanceSync({
      ...shared,
      chunks: createPrismaChunkStore(prisma),
      finance: createPrismaFinanceStore(prisma),
      days: lookbackDays,
    });
    return `${r.transactionRows} transaction row(s); backfill ${r.backfill.completed} done, ` +
      `${r.backfill.skipped} already covered, ${r.owed} owed`;
  }

  if (domain === 'payouts') {
    const r = await runPayoutSync({
      ...shared,
      finance: createPrismaFinanceStore(prisma),
      days: lookbackDays,
    });
    return `${r.payoutRows} payout row(s)`;
  }

  if (domain === 'advertising') {
    const r = await runAdsSync({ ...shared, adCampaigns: createPrismaAdCampaignStore(prisma) });
    return `${r.campaigns} campaign(s) — ${r.running} running, ${r.ended} ended`;
  }

  throw new Error(`No runner for sync domain "${domain}".`);
}

async function runStore(): Promise<number> {
  const settings = await prisma.ebaySyncSetting.findMany({ orderBy: { domain: 'asc' } });
  const now = new Date();
  let failed = 0;
  let ran = 0;

  for (const setting of settings) {
    if (only && setting.domain !== only) continue;
    if (!force && !isDue(setting, now)) {
      console.log(`${setting.domain}: not due (${setting.frequency}` +
        `${setting.nextRunAt ? `, next ${setting.nextRunAt.toISOString()}` : ''})`);
      continue;
    }
    if (force && !setting.enabled) {
      console.log(`${setting.domain}: disabled`);
      continue;
    }

    ran++;
    try {
      const summary = await runDomain(setting.domain, daysOverride ?? setting.lookbackDays);
      // Advanced only after a run that succeeded, so a failing sync stays due
      // and retries next tick rather than waiting out another interval.
      const at = new Date();
      await prisma.ebaySyncSetting.update({
        where: { storeId_domain: withStoreData({ domain: setting.domain }) },
        data: { lastRunAt: at, nextRunAt: nextRunAfter(setting.frequency, at) },
      });
      console.log(`${setting.domain}: ok — ${summary}`);
    } catch (error) {
      if (error instanceof SyncLockedError) {
        console.log(`${setting.domain}: skipped, ${error.holder ?? 'another run'} holds the lease`);
        continue;
      }
      if (error instanceof NoAllowanceError) {
        // Deliberately not a failure, and `nextRunAt` is left alone so the next
        // tick after the reset picks it straight back up.
        console.log(`${setting.domain}: skipped, eBay's daily allowance is spent`);
        continue;
      }
      failed++;
      console.error(
        `${setting.domain}: FAILED — ${redactString(error instanceof Error ? error.message : String(error))}`
      );
    }
  }

  if (ran === 0) console.log('nothing due');
  return failed > 0 ? 1 : 0;
}

try {
  const selected = arg('--store');
  const stores = await database.store.findMany({ where: { archivedAt: null, ...(selected ? { id: selected } : {}) }, orderBy: { createdAt: 'asc' } });
  if (selected && stores.length === 0) throw new Error('Store not found.');
  let failed = 0;
  for (const store of stores) {
    console.log(`store: ${store.id} (${store.name})`);
    const account = await database.ebayAccount.findFirst({ where: { storeId: store.id, environment: ebayEnvironment() } });
    if (!shouldAttemptStoreSync(account?.status)) { console.log('not connected; skipped'); continue; }
    if (account!.status !== 'connected') console.error(`eBay connection is ${account!.status}; due syncs will fail until the store is reconnected`);
    failed += await runInStore({ storeId: store.id, actorId: 'sync-worker', role: 'admin', marketplaceId: store.marketplaceId }, runStore);
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  await database.$disconnect();
}
