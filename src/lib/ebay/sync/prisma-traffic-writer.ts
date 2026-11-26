import { withStoreData } from '@/lib/stores/context';
/**
 * Persists traffic rows, and answers the one question the listing pass needs
 * before it spends a request.
 *
 * Both tables are keyed on the day, so a re-fetch of a settling window
 * overwrites rather than duplicating -- which is the whole point of asking for
 * the last few days again on every run.
 *
 * Writes are batched into transactions because multi-year per-listing
 * backfills can be large. SQLite syncs to disk per statement, so a transaction
 * per batch avoids a separate disk sync for each row.
 */

import type { PrismaClient } from '@prisma/client';
import type { TrafficDayRow, TrafficListingRow } from '../mappers/traffic-report';
import type { DateRange } from '../ranges';

export interface TrafficStore {
  saveDays(rows: TrafficDayRow[], syncedAt: Date): Promise<number>;
  saveListings(rows: TrafficListingRow[], syncedAt: Date): Promise<number>;
  /**
   * Marketplaces that recorded impressions on a given day, from the store-wide
   * rows the same run has just written.
   *
   * This is what decides where per-listing detail is worth a request. Asking
   * every marketplace can waste requests on empty results when listings and
   * purchases are reported in different marketplaces.
   * Deriving it from the day's own totals rather than hardcoding "Motors only"
   * means a store that later does list on another marketplace starts being
   * asked, instead of quietly reporting nothing.
   */
  marketplacesWithImpressions(date: Date): Promise<string[]>;
  /**
   * Which store-wide days are already stored, per marketplace. The repair pass
   * diffs this against the calendar to find windows worth re-requesting.
   */
  storedDayDates(range: DateRange): Promise<{ marketplaceId: string; date: Date }[]>;
  /**
   * Days the store-wide report says had impressions. These, and only these,
   * can owe per-listing detail -- a day with no traffic produces no listing
   * rows however often it is fetched, and would otherwise look outstanding
   * forever.
   */
  daysWithImpressions(range: DateRange): Promise<Date[]>;
  /** Days that already carry per-listing rows. */
  storedListingDates(range: DateRange): Promise<Date[]>;
}

/** Bounded so one transaction cannot hold the single SQLite writer too long. */
const BATCH_SIZE = 250;

function batches<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) out.push(rows.slice(i, i + BATCH_SIZE));
  return out;
}

export function createPrismaTrafficStore(prisma: PrismaClient): TrafficStore {
  return {
    async saveDays(rows: TrafficDayRow[], syncedAt: Date): Promise<number> {
      for (const batch of batches(rows)) {
        await prisma.$transaction(
          batch.map((row) => {
            const { date, marketplaceId, ...metrics } = row;
            return prisma.ebayTrafficDay.upsert({
              where: { storeId_date_marketplaceId: withStoreData({ date, marketplaceId }) },
              create: withStoreData({ date, marketplaceId, ...metrics, syncedAt }),
              update: { ...metrics, syncedAt },
            });
          })
        );
      }
      return rows.length;
    },

    async saveListings(rows: TrafficListingRow[], syncedAt: Date): Promise<number> {
      for (const batch of batches(rows)) {
        await prisma.$transaction(
          batch.map((row) => {
            const { date, marketplaceId, listingId, ...metrics } = row;
            return prisma.ebayTrafficListing.upsert({
              where: { storeId_date_marketplaceId_listingId: withStoreData({ date, marketplaceId, listingId }) },
              create: withStoreData({ date, marketplaceId, listingId, ...metrics, syncedAt }),
              update: { ...metrics, syncedAt },
            });
          })
        );
      }
      return rows.length;
    },

    async storedDayDates(range: DateRange): Promise<{ marketplaceId: string; date: Date }[]> {
      return prisma.ebayTrafficDay.findMany({
        where: { date: { gte: range.from, lte: range.to } },
        select: { marketplaceId: true, date: true },
      });
    },

    async daysWithImpressions(range: DateRange): Promise<Date[]> {
      const rows = await prisma.ebayTrafficDay.findMany({
        where: { date: { gte: range.from, lte: range.to }, impressionsTotal: { gt: 0 } },
        select: { date: true },
        distinct: ['date'],
      });
      return rows.map((row) => row.date);
    },

    async storedListingDates(range: DateRange): Promise<Date[]> {
      const rows = await prisma.ebayTrafficListing.findMany({
        where: { date: { gte: range.from, lte: range.to } },
        select: { date: true },
        distinct: ['date'],
      });
      return rows.map((row) => row.date);
    },

    async marketplacesWithImpressions(date: Date): Promise<string[]> {
      const rows = await prisma.ebayTrafficDay.findMany({
        where: { date, impressionsTotal: { gt: 0 } },
        select: { marketplaceId: true },
      });
      return rows.map((row) => row.marketplaceId);
    },
  };
}
