/**
 * eBay's Active Inventory Report -> listing rows.
 *
 * This report includes listings created through eBay's web UI, which Sell
 * Inventory does not cover. It supports the same report structure as manual
 * inventory uploads.
 *
 * The file is a ZIP containing one XML document. The archive sets the
 * data-descriptor flag, which zeroes the sizes in the local header, so it
 * cannot be read by walking that header alone -- the central directory is
 * authoritative, which is why this uses a real ZIP reader rather than
 * inflating from a fixed offset.
 *
 * Per listing the report carries only price, quantity and item id (plus a SKU
 * where the seller uses them). Titles, brands and
 * conditions are not in it and must come from elsewhere.
 */

import { unzipSync, strFromU8 } from 'fflate';

export class ReportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportParseError';
  }
}

export interface ReportListing {
  listingId: string;
  price: number;
  currency: string;
  quantity: number;
  sku: string | null;
}

const SKU_DETAILS = /<SKUDetails>([\s\S]*?)<\/SKUDetails>/g;

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block);
  return match ? match[1].trim() : null;
}

function unzipReport(archive: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch (error) {
    throw new ReportParseError(
      `Could not read the report archive: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const entry = Object.keys(files).find((name) => name.toLowerCase().endsWith('.xml'));
  if (!entry) {
    throw new ReportParseError(
      `The report archive holds no XML document (entries: ${Object.keys(files).join(', ') || 'none'}).`
    );
  }
  return strFromU8(files[entry]);
}

export function parseActiveInventoryReport(archive: Uint8Array): ReportListing[] {
  const xml = unzipReport(archive);

  // An unrecognised document must not read as "no active listings": that would
  // mark every listing the seller has as inactive.
  if (!xml.includes('<ActiveInventoryReport')) {
    throw new ReportParseError('The report XML is not an ActiveInventoryReport.');
  }

  const listings: ReportListing[] = [];
  for (const [, block] of xml.matchAll(SKU_DETAILS)) {
    const listingId = tag(block, 'ItemID');
    if (!listingId) {
      throw new ReportParseError('A report row carries no ItemID; refusing to guess which listing it is.');
    }

    const price = Number(tag(block, 'Price') ?? 0);
    const currencyMatch = /<Price[^>]*currencyID="([^"]+)"/.exec(block);

    listings.push({
      listingId,
      price: Number.isFinite(price) ? price : 0,
      currency: currencyMatch?.[1] ?? 'USD',
      // Present and zero is meaningful: an active listing with nothing left.
      quantity: Number(tag(block, 'Quantity') ?? 0) || 0,
      sku: tag(block, 'SKU'),
    });
  }

  return listings;
}
