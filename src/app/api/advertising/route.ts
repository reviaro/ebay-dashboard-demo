import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import { loadAdSummary } from '@/lib/ads/summary';

// Cookie-gated like the other /market data routes (e.g. /api/expenses): no
// per-handler session check. Serves the Advertising tab and any dated query.
async function handleGET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    return NextResponse.json(
      await loadAdSummary({
        from: from ? new Date(`${from}T00:00:00`) : undefined,
        to: to ? new Date(`${to}T23:59:59.999`) : undefined,
      }),
    );
  } catch (error) {
    console.error('Advertising analytics error:', error);
    return NextResponse.json({ error: 'Failed to load advertising analytics' }, { status: 500 });
  }
}

export const GET = withStore('view', handleGET);
