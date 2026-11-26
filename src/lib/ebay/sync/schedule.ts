/**
 * When a domain is next due, and which schedules it may be put on.
 *
 * Pure on purpose. This drives an hourly timer, so a mistake here fires
 * twenty-four times a day rather than once a week -- it is worth having the
 * whole decision testable without a database or a clock.
 */

export class SettingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingValidationError';
  }
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Interval per frequency; `null` means it is never scheduled. */
export const FREQUENCIES: Record<string, number | null> = {
  manual: null,
  daily: DAY,
  weekly: 7 * DAY,
};

/**
 * What each domain may be set to.
 *
 * The plan lists frequencies down to ten minutes, which suits a domain whose
 * data changes by the minute. Orders are filtered on last-modified across a
 * 90-day window, so polling faster than daily buys nothing and spends rate
 * limit that Phases 4-7 will need.
 */
const DOMAIN_FREQUENCIES: Record<string, string[]> = {
  orders: ['manual', 'daily', 'weekly'],
  inventory: ['manual', 'daily', 'weekly'],
  // Traffic is daily data, and eBay keeps revising the last few days after
  // publishing them, so a daily run is the one that both adds a day and
  // corrects the ones before it.
  traffic: ['manual', 'daily', 'weekly'],
  // Financial postings lag order creation, so like traffic a daily run both
  // adds new transactions and re-settles recent ones. Payouts post on their
  // own cadence and are fetched independently.
  finances: ['manual', 'daily', 'weekly'],
  payouts: ['manual', 'daily', 'weekly'],
  advertising: ['manual', 'daily', 'weekly'],
};

/**
 * Domains fetched as a full snapshot rather than over a date window.
 *
 * The Active Inventory Report is everything currently listed, so there is no
 * range to look back over and the "lookback must cover the interval" rule --
 * which exists to stop orders missing a week -- has nothing to say about it.
 */
const SNAPSHOT_DOMAINS: ReadonlySet<string> = new Set(['inventory', 'advertising']);

/** Longest window eBay will serve for a domain's filtered discovery. */
const DOMAIN_MAX_LOOKBACK: Record<string, number> = {
  orders: 90,
  // Unused: a snapshot has no window. Kept at 1 so the stored value is
  // obviously not a range someone should try to widen.
  inventory: 1,
  // Two years of history, chunked into the 90 days a single request accepts.
  // Setting this to the maximum is how a backfill is asked for: the run tiles
  // the window and checkpoints each tile, so it survives being interrupted.
  traffic: 730,
  // Same 730-day retention as traffic. Note the operationally-seeded value is
  // the small settling window (~14d), not this ceiling -- the backfill horizon
  // is DOMAIN_WINDOWS.finances/payouts in ranges.ts, not the stored lookback.
  finances: 730,
  payouts: 730,
  advertising: 1,
};

export function frequenciesFor(domain: string): string[] {
  const allowed = DOMAIN_FREQUENCIES[domain];
  if (!allowed) {
    throw new SettingValidationError(
      `Unknown sync domain "${domain}". Known domains: ${Object.keys(DOMAIN_FREQUENCIES).join(', ')}.`
    );
  }
  return allowed;
}

export interface SettingInput {
  domain: string;
  frequency: string;
  lookbackDays: number;
}

export function validateSetting(input: SettingInput): SettingInput {
  const allowed = frequenciesFor(input.domain);
  if (!allowed.includes(input.frequency)) {
    throw new SettingValidationError(
      `"${input.frequency}" is not available for ${input.domain}. Choose one of: ${allowed.join(', ')}.`
    );
  }

  const max = DOMAIN_MAX_LOOKBACK[input.domain];
  if (!Number.isInteger(input.lookbackDays) || input.lookbackDays < 1 || input.lookbackDays > max) {
    throw new SettingValidationError(
      `Lookback must be a whole number of days between 1 and ${max} for ${input.domain}.`
    );
  }

  // A schedule whose lookback is shorter than its own interval has no slack:
  // miss one run and the orders in that gap are never picked up, because the
  // next run's window starts after they were last modified.
  const interval = FREQUENCIES[input.frequency];
  if (!SNAPSHOT_DOMAINS.has(input.domain) && interval !== null && input.lookbackDays * DAY < interval) {
    throw new SettingValidationError(
      `A ${input.frequency} sync needs a lookback of at least ${Math.ceil(interval / DAY)} days, ` +
        `or a missed run is never recovered.`
    );
  }

  return { domain: input.domain, frequency: input.frequency, lookbackDays: input.lookbackDays };
}

export function nextRunAfter(frequency: string, from: Date): Date | null {
  const interval = FREQUENCIES[frequency];
  return interval === null || interval === undefined ? null : new Date(from.getTime() + interval);
}

export interface DueCheck {
  enabled: boolean;
  frequency: string;
  nextRunAt: Date | null;
}

export function isDue(setting: DueCheck, now: Date): boolean {
  if (!setting.enabled) return false;
  if (FREQUENCIES[setting.frequency] === null) return false;
  // Never run: due immediately, or a newly enabled domain would wait forever
  // for a `nextRunAt` that only a completed run would set.
  if (!setting.nextRunAt) return true;
  return setting.nextRunAt.getTime() <= now.getTime();
}

/**
 * Whether the scheduler should attempt a store, given its eBay account status.
 *
 * Only a store that was never connected, or was deliberately disconnected, is
 * skipped quietly. `reauthorization_required` (an expired or revoked grant)
 * must still run so each due domain records a failed sync and the timer exits
 * non-zero; skipping it would leave data going stale behind a green unit.
 */
export function shouldAttemptStoreSync(accountStatus: string | null | undefined): boolean {
  return accountStatus != null && accountStatus !== 'disconnected';
}
