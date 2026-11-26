import { NextResponse } from 'next/server';
import { withStore, HttpError } from '@/lib/stores/route';
import { listingConnection } from '@/lib/ebay/listing/service';
import { categoryAspects, categorySuggestions } from '@/lib/ebay/listing/taxonomy';
import { loadEbayConfig } from '@/lib/ebay/config';
import { guardDemoRoute } from '@/lib/demo/guard';
import { isDemoMode } from '@/lib/demo/server';

const demoMetadata = withStore('view', async request => {
  const { searchParams } = new URL(request.url);
  switch (searchParams.get('kind')) {
    case 'policies': return NextResponse.json({
      payment: [{ paymentPolicyId: 'sample-payment', name: 'Sample payment' }],
      return: [{ returnPolicyId: 'sample-returns', name: 'Sample 30-day returns' }],
      fulfillment: [{ fulfillmentPolicyId: 'sample-shipping', name: 'Sample ground shipping' }],
    });
    case 'categories': return NextResponse.json({ categorySuggestions: [
      { category: { categoryId: '999001', categoryName: 'Sample auto parts' } },
    ] });
    case 'aspects': return NextResponse.json({ aspects: [
      { localizedAspectName: 'Part Number', aspectConstraint: { aspectRequired: true } },
    ] });
    default: throw new HttpError(400, 'Unknown metadata request.');
  }
});

export async function GET(request: Request) {
  const blocked = guardDemoRoute('/api/listings/metadata', 'GET');
  if (blocked) return blocked;
  return isDemoMode() ? demoMetadata(request) : liveMetadata(request);
}

const liveMetadata = withStore('edit', async request => {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  try {
    if (kind === 'policies') {
      const { config, token } = await listingConnection();
      const policies = ['payment', 'return', 'fulfillment'] as const;
      // Independent lookups: fetched together rather than one after another.
      const lists = await Promise.all(policies.map(async policy => {
        const response = await fetch(`${config.apiBaseUrl}/sell/account/v1/${policy}_policy?marketplace_id=EBAY_US`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000), redirect: 'error', cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load eBay business policies. Reconnect with account read permission and configure policies in Seller Hub.');
        return (await response.json())[`${policy}Policies`] ?? [];
      }));
      return NextResponse.json(Object.fromEntries(policies.map((policy, i) => [policy, lists[i]])));
    }
    if (kind === 'categories') {
      const q = url.searchParams.get('q')?.trim();
      if (!q || q.length > 100) throw new HttpError(400, 'Enter a short part name.');
      return NextResponse.json(await categorySuggestions(loadEbayConfig(), q));
    }
    if (kind === 'aspects') {
      const categoryId = url.searchParams.get('category');
      if (!categoryId || !/^\d+$/.test(categoryId)) throw new HttpError(400, 'Select a category first.');
      return NextResponse.json(await categoryAspects(loadEbayConfig(), categoryId));
    }
    throw new HttpError(400, 'Unknown metadata request.');
  } catch (error) { throw error instanceof HttpError ? error : new HttpError(502, error instanceof Error ? error.message : 'Metadata unavailable.'); }
});
