import { assertLiveIntegrationAllowed } from '../../demo/server';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import prisma from '../../prisma';
import { requireStoreId, withStoreData } from '../../stores/context';
import type { EbayConfig } from '../config';
import { assertListingWrite } from './write-access';

function assetPath(id: string) {
  const storeId = requireStoreId();
  if (!/^[a-zA-Z0-9_-]+$/.test(storeId) || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid asset identifier.');
  return path.join(process.env.LISTING_ASSET_DIR || path.join(process.cwd(), '.data/listing-assets'), storeId, `${id}.jpg`);
}
export async function saveImage(bytes: Uint8Array, filename: string) {
  assertLiveIntegrationAllowed();
  if (!bytes.length || bytes.length > 20_000_000) throw new Error('Choose a photo smaller than 20 MB.');
  const source = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
  const meta = await source.metadata();
  if (!['jpeg', 'png', 'webp', 'heif', 'tiff'].includes(meta.format ?? '') || Math.max(meta.width ?? 0, meta.height ?? 0) < 500) throw new Error('Choose a JPEG, PNG, WebP, HEIC, or TIFF photo at least 500 pixels on its longest side.');
  const output = await source.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const id = randomUUID(); const file = assetPath(id);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, output, { mode: 0o600, flag: 'wx' });
  try { return await prisma.listingAsset.create({ data: withStoreData({ id, filename: filename.replace(/[^\w. -]/g, '').slice(0, 100) || 'Photo', mimeType: 'image/jpeg', size: output.length }) }); }
  catch (error) { await unlink(file); throw error; }
}
export async function readImage(id: string) {
  assertLiveIntegrationAllowed();
  await prisma.listingAsset.findUniqueOrThrow({ where: { id } });
  return readFile(assetPath(id));
}
export async function uploadPhotos(config: EbayConfig, token: string, accountId: string, ids: string[]): Promise<string[]> {
  assertLiveIntegrationAllowed();
  const urls: string[] = [];
  for (const id of ids) {
    const asset = await prisma.listingAsset.findUniqueOrThrow({ where: { id } });
    if (asset.ebayUrl && asset.ebayExpiresAt && asset.ebayExpiresAt.getTime() > Date.now() + 86400000) { urls.push(asset.ebayUrl); continue; }
    await assertListingWrite(accountId);
    const data = new FormData();
    data.append('image', new Blob([new Uint8Array(await readImage(id))], { type: 'image/jpeg' }), `${id}.jpg`);
    const host = config.environment === 'production' ? 'https://apim.ebay.com' : 'https://apim.sandbox.ebay.com';
    const response = await fetch(`${host}/commerce/media/v1_beta/image/create_image_from_file`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data, redirect: 'error', signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`eBay could not upload this photo (${response.status}). Check that this store was reconnected with photo-upload permission.`);
    const body = await response.json();
    const url = body.maxDimensionImageUrl || body.imageUrl;
    if (typeof url !== 'string' || !/^https:\/\/[^/]*ebayimg\.com\//.test(url)) throw new Error('eBay did not return a valid photo URL.');
    const expiration = new Date(body.expirationDate);
    if (!Number.isFinite(expiration.getTime())) throw new Error('eBay did not return the photo expiration date.');
    await prisma.listingAsset.update({ where: { id }, data: { ebayUrl: url, ebayExpiresAt: expiration } });
    urls.push(url);
  }
  return urls;
}
