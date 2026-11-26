import { withStore } from '@/lib/stores/route';
import { NextRequest, NextResponse } from 'next/server';
import { searchPickAPart, searchRuperts, searchAllYards } from '@/lib/yard-parser';

async function handleGET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const make = searchParams.get('make') || '';
  const model = searchParams.get('model') || '';
  const yard = searchParams.get('yard') || 'all';

  if (!make || !model) {
    return NextResponse.json({ error: 'Make and model are required' }, { status: 400 });
  }

  try {
    let results;
    if (yard === 'pickapart') {
      results = await searchPickAPart(make, model);
    } else if (yard === 'ruperts') {
      results = await searchRuperts(make, model);
    } else {
      results = await searchAllYards(make, model);
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Search API error:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory' }, { status: 500 });
  }
}

export const GET = withStore('view', handleGET);
