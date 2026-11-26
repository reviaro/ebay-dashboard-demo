import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDemoAnswers, verifyDemoDatabase } from '../../../scripts/build-demo-answers';
import { buildDemoData } from './data';
import { DEMO_QUESTIONS } from './config';
import { DEMO_PROJECT_ROOT, validateDemoManifest } from './seed-safety';
import cached from './answers.json';

const fixtures = buildDemoData();
const snapshot = JSON.parse(JSON.stringify({ inventory: fixtures.inventory, sales: fixtures.sales, orders: fixtures.orders, finance: fixtures.finance,
  payouts: fixtures.payouts, ads: fixtures.adReports, days: fixtures.trafficDays, listings: fixtures.trafficListings, fees: fixtures.fees,
  transactions: fixtures.transactions, accounts: [], oauth: [], locks: [], chunks: [], settings: fixtures.syncSettings }));

describe('database-derived cached answers', () => {
  it('contains precisely the five UI question strings and provenance', () => {
    expect(cached.questions.map(row => row.question)).toEqual([...DEMO_QUESTIONS]);
    expect(cached.synthetic).toBe(true);
    expect(cached.asOf).toBe('2026-09-30');
    expect(cached.questions.every(row => row.provenance.tables.length > 0 && row.answer.startsWith('Fictional demo data'))).toBe(true);
  });
  it('matches recalculation from deterministic fixtures and is stable', () => {
    expect(buildDemoAnswers(snapshot)).toEqual(cached);
    expect(buildDemoAnswers(snapshot)).toEqual(buildDemoAnswers(snapshot));
  });
  it.skipIf(!existsSync(resolve(DEMO_PROJECT_ROOT, 'prisma/demo.db')))('checks the seeded SQLite file, money, full coverage and immutable manifest', () => {
    const path = resolve(DEMO_PROJECT_ROOT, 'prisma/demo.db');
    const result = verifyDemoDatabase(path);
    expect(result.verified).toBe(true);
    expect(result.gross).toBe(148468.87);
    expect(result.payouts).toBe(108216.14);
    expect(validateDemoManifest(path).synthetic).toBe(true);
    expect(statSync(path).mode & 0o222).toBe(0);
  });
});
