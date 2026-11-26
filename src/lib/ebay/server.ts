/**
 * Server-side wiring for the eBay routes.
 *
 * Never import from client components: this reads the client secret and the
 * token-encryption key.
 */

import 'server-only';
import prisma from '@/lib/prisma';
import { loadEbayConfig, type EbayConfig } from './config';
import { createPrismaStores } from './prisma-stores';
import { requireStoreContext } from '../stores/context';

let cached: EbayConfig | null = null;

/**
 * Loads config once per process. Throws EbayConfigError with an actionable
 * message when the environment is incomplete; routes turn that into a 503 so a
 * misconfiguration reads as "not configured", not "broken".
 */
export function getEbayConfig(): EbayConfig {
  if (!cached) cached = loadEbayConfig();
  return { ...cached, marketplaceId: requireStoreContext().marketplaceId ?? cached.marketplaceId };
}

export function getEbayStores() {
  return createPrismaStores(prisma);
}
