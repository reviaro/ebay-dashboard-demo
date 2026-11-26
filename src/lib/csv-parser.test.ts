import { describe, it, expect } from 'vitest';
import { parseEBayCSV, extractMakeFromTitle, parseTransactionReport, parsePromotedListingReport, parseSalesRows, parseSnapshotDateFromFilename, salesSourceKey } from './csv-parser';

// All report rows, identifiers, and filenames below are synthetic fixtures.

describe('csv-parser', () => {
  it('detects and parses Active Listings reports', async () => {
    const csvContent = `"Item number","Title","Custom label (SKU)","Current price","Available quantity","Sold quantity","Watchers"\n"12345","Item A","SKU-A","$49.99","2","1","10"`;
    const result = await parseEBayCSV(csvContent);
    expect(result.type).toBe('active');
    expect(result.rows[0].itemId).toBe('12345');
    expect(result.rows[0].title).toBe('Item A');
    expect(result.rows[0].sku).toBe('SKU-A');
    expect(result.rows[0].price).toBe(49.99);
    expect(result.rows[0].quantity).toBe(2);
    expect(result.rows[0].views).toBe(0); // not included in active listings export
    expect(result.rows[0].watchers).toBe(10);
  });

  it('detects and parses Traffic reports', async () => {
    const csvContent = `"eBay item ID","Listing title","Total impressions","Click-through rate = Page views from eBay site/Total impressions","Total page views","Sales conversion rate = Quantity sold/Total page views"\n"=""12345""","Item A","1,000","5.0%","50","1.0%"`;
    const result = await parseEBayCSV(csvContent);
    expect(result.type).toBe('traffic');
    expect(result.rows[0].itemId).toBe('12345');
    expect(result.rows[0].impressions).toBe(1000);
    expect(result.rows[0].pageViews).toBe(50);
    expect(result.rows[0].ctr).toBe(5.0);
    expect(result.rows[0].salesConversionRate).toBe(1.0);
  });

  it('detects and parses Sales reports', async () => {
    const csvContent = `"Sale price","Total price","Date sold","Quantity sold","Category","Brand","Ship to city","Ship to state","Ship to country"\n"50.00","55.00","Jan-01-24","1","Parts","BrandX","Example City","VA","United States"`;
    const result = await parseEBayCSV(csvContent);
    expect(result.type).toBe('sales');
    expect(result.rows[0]['Sale price']).toBe('50.00');
  });
});

describe('current eBay export compatibility', () => {
  it('uses the Month-DD-YYYY date embedded in eBay traffic report filenames', () => {
    expect(parseSnapshotDateFromFilename('eBay-ListingsTrafficReport-Jun-12-2024-16_20_30-0700-90000000001.csv')?.toISOString()).toBe('2024-06-12T00:00:00.000Z');
  });

  it('parses eBay Paid & Shipped exports that vary date-header capitalization and spacing', () => {
    const rows = parseSalesRows([{
      'Sales Record Number': '1',
      'Item Title': 'Volvo Demo Shifter',
      ' Sale Date ': 'Jun-12-2024',
      'Item Number': '900000000101',
      'Sold For': '$80.00',
      'Quantity': '1',
    }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].saleDate.toISOString()).toBe('2024-06-12T00:00:00.000Z');
  });

  it('produces the same source key for a legacy row and a re-uploaded order', () => {
    const base = {
      recordNumber: 101,
      orderNumber: '90-10000-00001',
      itemNumber: '900000000102',
      itemTitle: 'Jeep Demo Wheel',
      saleDate: new Date('2024-06-02T00:00:00Z'),
    };
    expect(salesSourceKey(base)).toBe(salesSourceKey({ ...base, recordNumber: null }));
  });

  it('uses Paid On Date when eBay leaves Sale Date blank', () => {
    const rows = parseSalesRows([{
      'Sales Record Number': '1',
      'Item Title': 'Volvo Demo Shifter',
      'Sale Date': '',
      'Paid On Date': 'Jun-12-2024',
      'Item Number': '900000000101',
      'Sold For': '$80.00',
    }]);
    expect(rows[0].saleDate.toISOString()).toBe('2024-06-12T00:00:00.000Z');
  });

  it('skips incomplete eBay rows that have no usable date', () => {
    const rows = parseSalesRows([{
      'Sales Record Number': '1',
      'Item Title': 'Incomplete order',
      'Sale Date': '',
      'Paid On Date': '',
      'Shipped On Date': '',
    }]);
    expect(rows).toHaveLength(0);
  });
});

describe('new eBay financial reports', () => {
  it('parses transaction reports after metadata rows', () => {
    const csv = `Notes,,,,\nTransaction creation date,Type,Order number,Item ID,Transaction ID,Item title,Quantity,Item subtotal,Shipping and handling,Seller collected tax,eBay collected tax,Final Value Fee - fixed,Final Value Fee - variable,Regulatory operating fee,International fee,Gross transaction amount,Net amount,Payout currency,Description\n4-Jun-24,Order,90-10000-00002,900000000103,90000000000001,Volvo Demo Shifter,1,120.00,8.00,--,6.40,-0.40,-12.00,-2.00,--,128.00,113.60,USD,--`;
    const rows = parseTransactionReport(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].itemSubtotal).toBe(120);
    expect(rows[0].finalValueFeeVariable).toBe(-12);
    expect(rows[0].netAmount).toBe(113.6);
  });

  it('parses promoted listing performance and percentages', () => {
    const csv = `A note\n"Start date","End date","Campaign name","Campaign ID","Status  ","Item ID","Title","Price (Current or Last Price)","Quantity available","Promoted Listings Impressions (via eBay Placements)","Total Promoted Listings Clicks","Total Promoted Listings Sold quantity","Organic Sold Quantity","Total Quantity Sold","Promoted Listings Conversion rate (Promoted Listings Sold quantity/Promoted Listings Clicks)","Promoted Listings Contribution (Promoted Listings Sold quantity/Total Quantity Sold)","Total Promoted Listings Sales (in billing currency)","Ad fees (in billing currency)","Return on Ad spend (Sales/Ad fees)","Organic Clicks","Organic Impressions"\n"May 01, 2024","Jun 01, 2024","Main","123","Active","456","Volvo Part","$ 99.99","1","1,000","10","2","1","3","20.00%","66.67%","$ 200.00","$ 20.00","10.00","5","500"`;
    const rows = parsePromotedListingReport(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].promotedImpressions).toBe(1000);
    expect(rows[0].conversionRate).toBe(20);
    expect(rows[0].roas).toBe(10);
  });
});

describe('parsePromotedListingReport — hardened header handling', () => {
  const SHORT_HEADER =
    'Campaign name,Campaign ID,Item ID,Title,Impressions,Clicks,Sold quantity,Sales,Ad fees,Status,Start date,End date';

  it('parses a report whose columns use the short Seller-Hub header variants', () => {
    const csv = `${SHORT_HEADER}\nPriority CPC,CAMP-1,456789,Volvo Demo Bumper,1000,25,3,300.00,45.00,Running,2024-05-01,2024-06-01`;
    const rows = parsePromotedListingReport(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].campaignName).toBe('Priority CPC');
    expect(rows[0].campaignId).toBe('CAMP-1');
    expect(rows[0].campaignStatus).toBe('Running');
    expect(rows[0].itemId).toBe('456789');
    expect(rows[0].title).toBe('Volvo Demo Bumper');
    expect(rows[0].promotedImpressions).toBe(1000);
    expect(rows[0].promotedClicks).toBe(25);
    expect(rows[0].promotedSoldQuantity).toBe(3);
    expect(rows[0].attributedSales).toBe(300);
    expect(rows[0].adFees).toBe(45);
    expect(rows[0].reportStart.toISOString()).toBe('2024-05-01T00:00:00.000Z');
    expect(rows[0].reportEnd.toISOString()).toBe('2024-06-01T00:00:00.000Z');
  });

  it('looks up field columns trim- and case-insensitively (marker column exact-cased)', () => {
    const header =
      'Campaign name, CAMPAIGN ID ,ITEM ID,Title, Impressions ,CLICKS,Sold Quantity,SALES, Ad Fees ,STATUS,Start Date,END DATE';
    const csv = `${header}\nPriority CPC,CAMP-2,111,Grille,800,20,2,150.00,30.00,Ended,2024-05-01,2024-06-01`;
    const rows = parsePromotedListingReport(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].campaignId).toBe('CAMP-2');
    expect(rows[0].itemId).toBe('111');
    expect(rows[0].promotedImpressions).toBe(800);
    expect(rows[0].promotedClicks).toBe(20);
    expect(rows[0].promotedSoldQuantity).toBe(2);
    expect(rows[0].attributedSales).toBe(150);
    expect(rows[0].adFees).toBe(30);
    expect(rows[0].campaignStatus).toBe('Ended');
  });

  it('matches the header row even when the marker column itself is re-cased', () => {
    const csv =
      'CAMPAIGN NAME,CAMPAIGN ID,ITEM ID,TITLE,IMPRESSIONS,CLICKS,SOLD QUANTITY,SALES,AD FEES,STATUS,START DATE,END DATE\n' +
      'Priority CPC,CAMP-3,222,Hood,400,8,1,60.00,12.00,Ended,2024-05-01,2024-06-01';
    const rows = parsePromotedListingReport(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].campaignId).toBe('CAMP-3');
    expect(rows[0].promotedImpressions).toBe(400);
  });

  it('returns [] for a CSV that has none of the expected columns', () => {
    expect(parsePromotedListingReport('Order total,Some other column\n5,6')).toEqual([]);
  });

  it('still parses the long Seller-Hub header form', () => {
    const csv = `A note\n"Start date","End date","Campaign name","Campaign ID","Status  ","Item ID","Title","Price (Current or Last Price)","Quantity available","Promoted Listings Impressions (via eBay Placements)","Total Promoted Listings Clicks","Total Promoted Listings Sold quantity","Organic Sold Quantity","Total Quantity Sold","Promoted Listings Conversion rate (Promoted Listings Sold quantity/Promoted Listings Clicks)","Promoted Listings Contribution (Promoted Listings Sold quantity/Total Quantity Sold)","Total Promoted Listings Sales (in billing currency)","Ad fees (in billing currency)","Return on Ad spend (Sales/Ad fees)","Organic Clicks","Organic Impressions"\n"May 01, 2024","Jun 01, 2024","Main","123","Active","456","Volvo Part","$ 99.99","1","1,000","10","2","1","3","20.00%","66.67%","$ 200.00","$ 20.00","10.00","5","500"`;
    const rows = parsePromotedListingReport(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].promotedImpressions).toBe(1000);
    expect(rows[0].attributedSales).toBe(200);
    expect(rows[0].adFees).toBe(20);
    expect(rows[0].roas).toBe(10);
  });
});

describe('extractMakeFromTitle', () => {
  it('extracts and normalizes a known make', () => {
    expect(extractMakeFromTitle('2000-2002 Ford Demo Hood Latch')).toBe('Ford');
    expect(extractMakeFromTitle('2000-2002 VW Demo Steering Switch')).toBe('Volkswagen');
  });

  it('extracts Land Rover from two-word make titles', () => {
    expect(extractMakeFromTitle('2000-2002 Land Rover Demo Tail Light')).toBe('Land Rover');
  });

  it('returns Unknown instead of a garbage fallback brand', () => {
    expect(extractMakeFromTitle('✅ Universal Bumper Bracket Pair')).toBe('Unknown');
    expect(extractMakeFromTitle('95 Custom Gauge Cluster Bezel')).toBe('Unknown');
    expect(extractMakeFromTitle('')).toBe('Unknown');
  });
});
