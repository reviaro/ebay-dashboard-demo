import { describe, expect, it } from 'vitest';
import {
  FREQUENCIES, frequenciesFor, isDue, nextRunAfter, shouldAttemptStoreSync, validateSetting, SettingValidationError,
} from './schedule';

const now = new Date('2026-09-04T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('frequenciesFor', () => {
  // eBay orders are filtered on last-modified over a 90-day window; polling
  // every ten minutes buys nothing and spends rate limit. The plan's full
  // frequency list is for domains that need it, not every domain.
  it('offers orders only the intervals worth spending a rate limit on', () => {
    expect(frequenciesFor('orders')).toEqual(['manual', 'daily', 'weekly']);
  });

  it('refuses a frequency the domain does not offer', () => {
    expect(() => validateSetting({ domain: 'orders', frequency: 'hourly', lookbackDays: 30 }))
      .toThrow(SettingValidationError);
  });

  it('rejects an unknown domain rather than inventing a schedule for it', () => {
    expect(() => frequenciesFor('nonsense')).toThrow(SettingValidationError);
  });
});

describe('validateSetting', () => {
  it('accepts a valid setting', () => {
    expect(validateSetting({ domain: 'orders', frequency: 'weekly', lookbackDays: 30 }))
      .toEqual({ domain: 'orders', frequency: 'weekly', lookbackDays: 30 });
  });

  it('rejects a lookback outside what eBay will serve', () => {
    expect(() => validateSetting({ domain: 'orders', frequency: 'weekly', lookbackDays: 91 }))
      .toThrow(/90/);
    expect(() => validateSetting({ domain: 'orders', frequency: 'weekly', lookbackDays: 0 }))
      .toThrow(SettingValidationError);
  });

  // A weekly sync with a 7-day lookback has no slack: one missed week and
  // those orders are never seen again.
  it('rejects a lookback that cannot cover its own interval', () => {
    expect(() => validateSetting({ domain: 'orders', frequency: 'weekly', lookbackDays: 5 }))
      .toThrow(/lookback/i);
  });
});

describe('nextRunAfter', () => {
  it('schedules a weekly sync a week out', () => {
    expect(nextRunAfter('weekly', now)).toEqual(new Date(now.getTime() + 7 * DAY));
  });

  it('schedules a daily sync a day out', () => {
    expect(nextRunAfter('daily', now)).toEqual(new Date(now.getTime() + DAY));
  });

  it('never schedules a manual sync', () => {
    expect(nextRunAfter('manual', now)).toBeNull();
  });
});

describe('isDue', () => {
  const setting = { enabled: true, frequency: 'weekly', nextRunAt: new Date(now.getTime() - 1000) };

  it('is due once nextRunAt has passed', () => {
    expect(isDue(setting, now)).toBe(true);
  });

  it('is not due before then', () => {
    expect(isDue({ ...setting, nextRunAt: new Date(now.getTime() + HOUR) }, now)).toBe(false);
  });

  it('is not due when disabled, however overdue it looks', () => {
    expect(isDue({ ...setting, enabled: false }, now)).toBe(false);
  });

  it('is never due on a manual schedule', () => {
    expect(isDue({ ...setting, frequency: 'manual' }, now)).toBe(false);
  });

  // A row that has never run has no nextRunAt. Treating that as "not due"
  // would mean a newly enabled domain never starts on its own.
  it('is due when it has never run', () => {
    expect(isDue({ enabled: true, frequency: 'weekly', nextRunAt: null }, now)).toBe(true);
  });
});

describe('FREQUENCIES', () => {
  it('has no interval for manual, so nothing can schedule it by accident', () => {
    expect(FREQUENCIES.manual).toBeNull();
  });
});

// Inventory is fetched as a full snapshot -- the Active Inventory Report is
// everything currently listed -- so there is no date window to look back over.
// The lookback rules that keep orders from missing a week do not apply.
describe('snapshot domains', () => {
  it('offers inventory the same schedules as orders', () => {
    expect(frequenciesFor('inventory')).toEqual(['manual', 'daily', 'weekly']);
  });

  it('accepts a weekly inventory sync without demanding a 7-day lookback', () => {
    expect(() => validateSetting({ domain: 'inventory', frequency: 'weekly', lookbackDays: 1 }))
      .not.toThrow();
  });

  it('still holds orders to a lookback that covers their interval', () => {
    expect(() => validateSetting({ domain: 'orders', frequency: 'weekly', lookbackDays: 1 }))
      .toThrow(/lookback/i);
  });
});

// Finances and payouts backfill two years of history the same way traffic
// does: the runner tiles DOMAIN_WINDOWS.finances/payouts and checkpoints each
// tile, so the stored lookback is only the settling window -- but the ceiling
// still has to allow the full 730 for a deliberate re-backfill.
describe('finance domains', () => {
  it('offers finances and payouts the standard schedules', () => {
    expect(frequenciesFor('finances')).toEqual(['manual', 'daily', 'weekly']);
    expect(frequenciesFor('payouts')).toEqual(['manual', 'daily', 'weekly']);
  });

  it('accepts a lookback up to 730 days and rejects more', () => {
    expect(() => validateSetting({ domain: 'finances', frequency: 'daily', lookbackDays: 730 })).not.toThrow();
    expect(() => validateSetting({ domain: 'finances', frequency: 'daily', lookbackDays: 731 })).toThrow(SettingValidationError);
    expect(() => validateSetting({ domain: 'payouts', frequency: 'daily', lookbackDays: 730 })).not.toThrow();
  });

  it('accepts the 14-day settling window seeded operationally', () => {
    expect(() => validateSetting({ domain: 'finances', frequency: 'daily', lookbackDays: 14 })).not.toThrow();
    expect(() => validateSetting({ domain: 'payouts', frequency: 'daily', lookbackDays: 14 })).not.toThrow();
  });
});

// Advertising is a snapshot domain like inventory: campaigns are fetched as a
// full roster, not over a date window. The "lookback must cover interval"
// rule does not apply to snapshots.
describe('advertising domain', () => {
  it('offers advertising the standard schedules', () => {
    expect(frequenciesFor('advertising')).toEqual(['manual', 'daily', 'weekly']);
  });

  it('accepts daily frequency with 1-day lookback', () => {
    expect(() => validateSetting({ domain: 'advertising', frequency: 'daily', lookbackDays: 1 }))
      .not.toThrow();
  });

  it('accepts weekly frequency with 1-day lookback (snapshot exempts interval rule)', () => {
    expect(() => validateSetting({ domain: 'advertising', frequency: 'weekly', lookbackDays: 1 }))
      .not.toThrow();
  });

  it('rejects a lookback exceeding the max', () => {
    expect(() => validateSetting({ domain: 'advertising', frequency: 'daily', lookbackDays: 2 }))
      .toThrow(/1/);
  });
});

describe('shouldAttemptStoreSync', () => {
  it('skips only stores that were never connected or were deliberately disconnected', () => {
    expect(shouldAttemptStoreSync(undefined)).toBe(false);
    expect(shouldAttemptStoreSync(null)).toBe(false);
    expect(shouldAttemptStoreSync('disconnected')).toBe(false);
    expect(shouldAttemptStoreSync('connected')).toBe(true);
  });

  it('still runs a store whose grant expired, so the failure is recorded and the timer exits non-zero', () => {
    expect(shouldAttemptStoreSync('reauthorization_required')).toBe(true);
  });
});
