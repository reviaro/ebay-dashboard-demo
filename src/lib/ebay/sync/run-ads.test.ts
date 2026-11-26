import { describe, expect, it, vi } from 'vitest';
import { runAdsSync, type RunAdsSyncResult } from './run-ads';
import type { SyncLockStore } from '../sync-lock';
import type { SyncRunRecorder } from './run-log';
import type { AdCampaignStore } from './prisma-ad-campaign-writer';
import type { MappedAdCampaign } from './ad-campaign';

function freeLock(): SyncLockStore {
  let row: { owner: string; acquiredAt: Date; expiresAt: Date } | null = null;
  return {
    async takeOverExpired() {
      return 0;
    },
    async insert(_n, owner, at, expiresAt) {
      if (row) return false;
      row = { owner, acquiredAt: at, expiresAt };
      return true;
    },
    async release() {
      row = null;
    },
    async find() {
      return row;
    },
  };
}

function heldLock(): SyncLockStore {
  const row = { owner: 'someone:999@other', acquiredAt: new Date(), expiresAt: new Date(Date.now() + 60000) };
  return {
    async takeOverExpired() {
      return 0;
    },
    async insert() {
      return false;
    },
    async release() {
      // no-op
    },
    async find() {
      return row;
    },
  };
}

function recorder() {
  const finished: { status: string; count: number; message: string | null }[] = [];
  const rec: SyncRunRecorder = {
    async start() {
      return 1;
    },
    async finish(_id, u) {
      finished.push({ status: u.status, count: u.count, message: u.message });
    },
  };
  return { rec, finished };
}

function adCampaignStub() {
  const saved: { rows: MappedAdCampaign[]; seenAt: Date }[] = [];
  const store: AdCampaignStore = {
    async saveCampaigns(rows: MappedAdCampaign[], seenAt: Date) {
      saved.push({ rows, seenAt });
      return rows.length;
    },
    async fundingModelByCampaign() {
      return new Map();
    },
  };
  return { store, saved };
}

describe('runAdsSync', () => {
  it('fetches campaigns, saves them, and returns counts', async () => {
    const { rec, finished } = recorder();
    const { store, saved } = adCampaignStub();

    const fakeRows: MappedAdCampaign[] = [
      {
        campaignId: '1',
        campaignName: 'Campaign 1',
        fundingModel: 'CPS',
        campaignStatus: 'RUNNING',
        channels: null,
        targetingType: null,
        dailyBudget: null,
        budgetCurrency: null,
        bidPercentage: null,
        startDate: null,
        endDate: null,
      },
      {
        campaignId: '2',
        campaignName: 'Campaign 2',
        fundingModel: 'CPC',
        campaignStatus: 'RUNNING',
        channels: null,
        targetingType: null,
        dailyBudget: null,
        budgetCurrency: null,
        bidPercentage: null,
        startDate: null,
        endDate: null,
      },
      {
        campaignId: '3',
        campaignName: 'Campaign 3',
        fundingModel: 'CPS',
        campaignStatus: 'ENDED',
        channels: null,
        targetingType: null,
        dailyBudget: null,
        budgetCurrency: null,
        bidPercentage: null,
        startDate: null,
        endDate: null,
      },
    ];

    const fetchCampaigns = vi.fn(async () => fakeRows);
    const now = () => new Date('2026-09-10T12:00:00Z');

    const result: RunAdsSyncResult = await runAdsSync({
      lockStore: freeLock(),
      recorder: rec,
      adCampaigns: store,
      trigger: 'test',
      resolve: () => ({ config: {} as never, accounts: {} as never }),
      fetchCampaigns,
      now,
    });

    expect(result).toEqual({ campaigns: 3, running: 2, ended: 1 });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.rows).toEqual(fakeRows);
    expect(saved[0]!.seenAt).toEqual(now());
    expect(finished).toEqual([{ status: 'ok', count: 3, message: null }]);
  });

  it('logs a failed run when fetchCampaigns throws', async () => {
    const { rec, finished } = recorder();
    const { store, saved } = adCampaignStub();

    const fetchCampaigns = vi.fn(async () => {
      throw new Error('eBay 500');
    });

    await expect(
      runAdsSync({
        lockStore: freeLock(),
        recorder: rec,
        adCampaigns: store,
        trigger: 'test',
        resolve: () => ({ config: {} as never, accounts: {} as never }),
        fetchCampaigns,
      })
    ).rejects.toThrow('eBay 500');

    expect(saved).toHaveLength(0);
    expect(finished).toEqual([expect.objectContaining({ status: 'failed' })]);
  });

  it('throws SyncLockedError and writes no run row when lease is held', async () => {
    const { rec, finished } = recorder();
    const { store, saved } = adCampaignStub();

    const fetchCampaigns = vi.fn(async () => []);

    const { SyncLockedError } = await import('../sync-lock');
    await expect(
      runAdsSync({
        lockStore: heldLock(),
        recorder: rec,
        adCampaigns: store,
        trigger: 'test',
        resolve: () => ({ config: {} as never, accounts: {} as never }),
        fetchCampaigns,
      })
    ).rejects.toThrow(SyncLockedError);

    expect(saved).toHaveLength(0);
    expect(finished).toHaveLength(0);
  });
});
