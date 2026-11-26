vi.mock('@/lib/stores/route', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/stores/route')>(),
  withStore: (await import('@/test/store-fixture')).withUnitStore,
}));
import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  default: {
    ebayAdReport: { upsert: vi.fn() },
    ebayAdCampaign: { findMany: vi.fn() },
    uploadRecord: { create: vi.fn() },
    promotedListingMetric: { upsert: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
  },
}));

import { POST } from './route';

const adReport = prisma.ebayAdReport as any;
const adCampaign = prisma.ebayAdCampaign as any;
const uploadRecord = prisma.uploadRecord as any;
const legacyMetric = prisma.promotedListingMetric as any;

const SHORT_HEADER =
  'Campaign name,Campaign ID,Item ID,Title,Impressions,Clicks,Sold quantity,Sales,Ad fees,Status,Start date,End date';

const upload = (csv: string, type = 'promoted-listings') => {
  const form = new FormData();
  form.append('type', type);
  form.append('file', new File([csv], 'promoted-listings.csv', { type: 'text/csv' }));
  return POST(new Request('http://localhost/api/upload', { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost' }, body: form }));
};

beforeEach(() => {
  vi.clearAllMocks();
  adCampaign.findMany.mockResolvedValue([{ campaignId: 'CAMP-CPC', fundingModel: 'CPC' }]);
  adReport.upsert.mockResolvedValue({});
  uploadRecord.create.mockResolvedValue({});
});

describe('POST /api/upload — promoted-listings writes EbayAdReport', () => {
  it('upserts one EbayAdReport per row, tagged with the roster funding model', async () => {
    const csv = [
      SHORT_HEADER,
      'Priority CPC,CAMP-CPC,111,Volvo Bumper,1000,25,2,200.00,40.00,ENDED,2026-05-06,2026-08-03',
      'Priority CPC,CAMP-CPC,222,Volvo Grille,500,10,1,90.00,15.00,ENDED,2026-05-06,2026-08-03',
    ].join('\n');

    const res = await upload(csv);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, count: 2 });

    expect(adReport.upsert).toHaveBeenCalledTimes(2);
    expect(legacyMetric.upsert).not.toHaveBeenCalled();
    expect(legacyMetric.createMany).not.toHaveBeenCalled();
    expect(legacyMetric.deleteMany).not.toHaveBeenCalled();

    const first = adReport.upsert.mock.calls[0][0];
    expect(first.where.storeId_reportStart_reportEnd_fundingModel_campaignId_listingId).toMatchObject({
      fundingModel: 'CPC',
      campaignId: 'CAMP-CPC',
      listingId: '111',
    });
    expect(first.create).toMatchObject({
      fundingModel: 'CPC',
      campaignId: 'CAMP-CPC',
      campaignName: 'Priority CPC',
      campaignStatus: 'ENDED',
      listingId: '111',
      title: 'Volvo Bumper',
      impressions: 1000,
      clicks: 25,
      adSpend: 40,
      attributedSales: 200,
      attributedUnits: 2,
    });
    expect(first.create.cpc).toBeCloseTo(40 / 25, 6);
    expect(first.create.ctr).toBeCloseTo(25 / 1000, 6);
    expect(first.create.roas).toBeCloseTo(200 / 40, 6);
    expect(first.create.acos).toBeCloseTo(40 / 200, 6);

    const second = adReport.upsert.mock.calls[1][0];
    expect(second.create.fundingModel).toBe('CPC');
    expect(second.create.listingId).toBe('222');
  });

  it("tags a row whose campaign is not in the roster as fundingModel 'unknown'", async () => {
    const csv = [
      SHORT_HEADER,
      'Mystery,CAMP-XYZ,333,Widget,100,4,0,0,8.00,ENDED,2026-05-06,2026-08-03',
    ].join('\n');

    const res = await upload(csv);
    expect(res.status).toBe(200);
    expect(adReport.upsert).toHaveBeenCalledTimes(1);

    const arg = adReport.upsert.mock.calls[0][0];
    expect(arg.create.fundingModel).toBe('unknown');
    expect(arg.where.storeId_reportStart_reportEnd_fundingModel_campaignId_listingId.fundingModel).toBe('unknown');
    expect(arg.create.acos).toBe(0);
    expect(arg.create.roas).toBe(0);
  });

  it('returns 400 and writes nothing when the CSV parses to zero rows', async () => {
    const res = await upload('Order total,Some other column\n5,6');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(typeof body.error).toBe('string');
    expect(body.error).toMatch(/promoted-listings/i);

    expect(adReport.upsert).not.toHaveBeenCalled();
    expect(legacyMetric.upsert).not.toHaveBeenCalled();
    expect(legacyMetric.createMany).not.toHaveBeenCalled();
    expect(uploadRecord.create).not.toHaveBeenCalled();
  });
});


describe('POST /api/upload — request boundaries', () => {
  const request = (entries: Record<string, string | undefined>) => {
    const headers = new Headers({ host: 'dashboard.example' });
    for (const [name, value] of Object.entries(entries)) {
      if (value !== undefined) headers.set(name, value);
    }
    const form = new FormData();
    form.append('type', 'promoted-listings');
    form.append('file', new File(['untrusted upload'], 'report.csv', { type: 'text/csv' }));
    return new Request('https://dashboard.example/api/upload', {
      method: 'POST', body: form, headers,
    });
  };

  it.each([
    { origin: 'https://attacker.example' },
    { origin: 'https://sibling.dashboard.example', 'sec-fetch-site': 'same-site' },
    { origin: 'null' },
    { origin: 'https://dashboard.example:444' },
    { origin: 'https://dashboard.example.attacker.example' },
    { 'sec-fetch-site': 'same-site' },
    {},
  ])('rejects untrusted multipart requests before parsing or writing: %j', async (headers) => {
    const req = request(headers);
    const parse = vi.spyOn(req, 'formData');
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(adCampaign.findMany).not.toHaveBeenCalled();
    expect(adReport.upsert).not.toHaveBeenCalled();
    expect(uploadRecord.create).not.toHaveBeenCalled();
  });


  it.each([
    { origin: 'https://dashboard.example' },
    { 'sec-fetch-site': 'same-origin' },
    { origin: 'https://public.example', 'x-forwarded-host': 'public.example' },
  ])('continues normal upload validation for an authenticated same-origin request: %j', async (headers) => {
    const req = request(headers);
    const parse = vi.spyOn(req, 'formData');

    // The synthetic file is deliberately not a report; reaching normal format
    // validation proves the security boundary did not block legitimate uploads.
    expect((await POST(req)).status).toBe(400);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
