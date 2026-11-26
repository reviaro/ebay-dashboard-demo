import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseActiveInventoryReport, ReportParseError } from './active-inventory-report';

/** Synthetic inventory fixture using the eBay report structure. */
const REPORT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<BulkDataExchangeResponses xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveInventoryReport>
<SKUDetails>
\t<Price currencyID="USD">125.50</Price>
\t<Quantity>0</Quantity>
\t<ItemID>100000000001</ItemID>
</SKUDetails>
<SKUDetails>
\t<Price currencyID="USD">75.25</Price>
\t<Quantity>2</Quantity>
\t<ItemID>100000000002</ItemID>
</SKUDetails>
</ActiveInventoryReport>
<Ack>Success</Ack></BulkDataExchangeResponses>`;

const zip = (xml: string, name = 'activeinventory-1.xml') =>
  zipSync({ [name]: strToU8(xml) });

describe('parseActiveInventoryReport', () => {
  it('reads every listing out of the zipped report', () => {
    const listings = parseActiveInventoryReport(zip(REPORT_XML));

    expect(listings).toEqual([
      { listingId: '100000000001', price: 125.50, currency: 'USD', quantity: 0, sku: null },
      { listingId: '100000000002', price: 75.25, currency: 'USD', quantity: 2, sku: null },
    ]);
  });

  // SKU elements are optional. Reports that include them must preserve them.
  it('keeps a SKU when the report carries one', () => {
    const xml = REPORT_XML.replace(
      '\t<ItemID>100000000001</ItemID>',
      '\t<SKU>PART-123</SKU>\n\t<ItemID>100000000001</ItemID>'
    );

    expect(parseActiveInventoryReport(zip(xml))[0].sku).toBe('PART-123');
  });

  it('reports zero quantity as zero rather than dropping the listing', () => {
    const listings = parseActiveInventoryReport(zip(REPORT_XML));
    expect(listings.find(l => l.listingId === '100000000001')?.quantity).toBe(0);
  });

  it('handles an empty report', () => {
    const xml = REPORT_XML.replace(/<SKUDetails>[\s\S]*<\/SKUDetails>/, '');
    expect(parseActiveInventoryReport(zip(xml))).toEqual([]);
  });

  // A truncated or unexpected archive must not read as "the seller has no
  // active listings" -- that would mark every listing inactive.
  it('refuses an archive it cannot read rather than returning nothing', () => {
    expect(() => parseActiveInventoryReport(new Uint8Array([1, 2, 3, 4])))
      .toThrow(ReportParseError);
  });

  it('refuses an archive whose contents are not a report', () => {
    expect(() => parseActiveInventoryReport(zip('<html>error page</html>')))
      .toThrow(ReportParseError);
  });

  it('refuses a listing row with no item id', () => {
    const xml = REPORT_XML.replace('\t<ItemID>100000000001</ItemID>\n', '');
    expect(() => parseActiveInventoryReport(zip(xml))).toThrow(ReportParseError);
  });
});
