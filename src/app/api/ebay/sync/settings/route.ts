import { withStore } from '@/lib/stores/route';
import { withStoreData } from '@/lib/stores/context';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { errorResponse, guardOrigin } from '@/lib/ebay/route-helpers';
import {
  frequenciesFor, nextRunAfter, validateSetting, SettingValidationError,
} from '@/lib/ebay/sync/schedule';

export const dynamic = 'force-dynamic';

/**
 * Domains this route will write. Kept in step with `DOMAIN_FREQUENCIES` in
 * `sync/schedule.ts` -- a domain missing here has a row and a runner but no
 * way to change its schedule, which is how `inventory` shipped with no UI.
 */
const DOMAINS = ['orders', 'inventory', 'traffic', 'finances', 'payouts'];

async function handleGET() {

  try {
    const rows = await prisma.ebaySyncSetting.findMany({ orderBy: { domain: 'asc' } });

    return NextResponse.json({
      settings: rows.map((row) => ({
        domain: row.domain,
        enabled: row.enabled,
        frequency: row.frequency,
        lookbackDays: row.lookbackDays,
        lastRunAt: row.lastRunAt,
        nextRunAt: row.nextRunAt,
        // Sent with the row so the UI never has to hardcode the list, and
        // cannot offer a choice the server would reject.
        available: frequenciesFor(row.domain),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Updates one domain's schedule. */
async function handlePUT(request: Request) {

  const blocked = guardOrigin(request);
  if (blocked) return blocked;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const domain = String(body.domain ?? '');
    if (!DOMAINS.includes(domain)) {
      return NextResponse.json(
        { error: `Unknown domain "${domain}".`, code: 'bad_request' },
        { status: 400 }
      );
    }

    const existing = await prisma.ebaySyncSetting.findUnique({ where: { storeId_domain: withStoreData({ domain: domain }) } });
    const enabled = body.enabled === undefined ? (existing?.enabled ?? true) : Boolean(body.enabled);
    const validated = validateSetting({
      domain,
      frequency: String(body.frequency ?? existing?.frequency ?? 'weekly'),
      lookbackDays: Number(body.lookbackDays ?? existing?.lookbackDays ?? 30),
    });

    // Rescheduled from now rather than from the last run: changing a weekly
    // sync to daily should take effect today, not next week.
    const nextRunAt = enabled ? nextRunAfter(validated.frequency, new Date()) : null;

    const saved = await prisma.ebaySyncSetting.upsert({
      where: { storeId_domain: withStoreData({ domain: domain }) },
      create: withStoreData({ ...validated, enabled, nextRunAt }),
      update: { ...validated, enabled, nextRunAt },
    });

    return NextResponse.json({
      setting: {
        domain: saved.domain,
        enabled: saved.enabled,
        frequency: saved.frequency,
        lookbackDays: saved.lookbackDays,
        lastRunAt: saved.lastRunAt,
        nextRunAt: saved.nextRunAt,
        available: frequenciesFor(saved.domain),
      },
    });
  } catch (error) {
    if (error instanceof SettingValidationError) {
      return NextResponse.json({ error: error.message, code: 'bad_request' }, { status: 400 });
    }
    return errorResponse(error);
  }
}

export const GET = withStore('view', handleGET);

export const PUT = withStore('admin', handlePUT);
