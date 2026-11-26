/**
 * How many traffic calls eBay will still accept today.
 *
 * eBay allows **100 `getTrafficReport` calls per day**, resetting at 07:00Z,
 * and there is no listing-by-day request — so per-listing history costs one
 * call per day of history and a backfill is inherently spread over days. The
 * allowance is the scheduler's real constraint, and it is worth asking about
 * rather than counting locally: a local tally cannot see calls spent by a
 * manual run, an earlier tick, or anything else using the same credentials.
 *
 * The probe itself is charged to a different, far larger allowance (5,000/day
 * for the developer Analytics API), so checking is close to free.
 *
 * A run that stops because the allowance is spent is **not a failed sync** --
 * it is the scheduler waiting, exactly like a run refused because another
 * holds the lease. Callers use this to decline before starting, so nothing
 * writes a `failed` row and the freshness banner keeps telling the truth.
 */

import type { EbayClient } from '../client';

const RATE_LIMIT_PATH = '/developer/analytics/v1_beta/rate_limit/';
const TRAFFIC_RESOURCE = 'sell.analytics.traffic_report';

export interface TrafficBudget {
  limit: number;
  remaining: number;
  resetAt: Date | null;
}

interface RawRate {
  limit?: number;
  remaining?: number;
  reset?: string;
}

interface RawResponse {
  rateLimits?: { resources?: { name?: string; rates?: RawRate[] }[] }[];
}

/**
 * Returns null when eBay does not report the resource.
 *
 * Deliberately not an error: this is a diagnostic endpoint, and a syncing
 * integration should not stop working because the shape of a quota report
 * changed. The caller falls back to its own conservative cap, which is what
 * kept requests inside the allowance before this existed.
 */
export async function fetchTrafficBudget(client: EbayClient): Promise<TrafficBudget | null> {
  const response = (await client.get(RATE_LIMIT_PATH)) as RawResponse;

  for (const api of response.rateLimits ?? []) {
    for (const resource of api.resources ?? []) {
      if (resource.name !== TRAFFIC_RESOURCE) continue;

      const rate = resource.rates?.[0];
      if (!rate || typeof rate.remaining !== 'number') continue;

      return {
        limit: typeof rate.limit === 'number' ? rate.limit : 0,
        remaining: rate.remaining,
        resetAt: rate.reset ? new Date(rate.reset) : null,
      };
    }
  }

  return null;
}

/**
 * Calls held back from a backfill so the next scheduled refresh can still run.
 *
 * A refresh of a week costs about nine. Without a reserve, a backfill would
 * take the last of the allowance and the days everyone actually looks at would
 * go stale until the reset.
 */
export const REFRESH_RESERVE = 15;
