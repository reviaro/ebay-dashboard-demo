import { NextResponse } from 'next/server';
import { withStore, HttpError } from '@/lib/stores/route';
import { limitedBytes } from '@/lib/http/body';
import { readImage, saveImage } from '@/lib/ebay/listing/assets';

export const GET = withStore('view', async request => {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) throw new HttpError(400, 'Photo ID required.');
  return new Response(new Uint8Array(await readImage(id)), { headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' } });
});
export const POST = withStore('edit', async request => {
  try { return NextResponse.json({ asset: await saveImage(await limitedBytes(request, 20_000_000), request.headers.get('x-filename') ?? 'Photo') }, { status: 201 }); }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Unable to save photo.'); }
});
