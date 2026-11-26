import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fallbackStoreId, publishKey } from './browser';

afterEach(() => vi.unstubAllGlobals());

describe('store selection', () => {
  it('reopens the tab’s last store when the URL names none, instead of the first store', () => {
    expect(fallbackStoreId(['legacy', 'second'], 'second')).toBe('second');
    expect(fallbackStoreId(['legacy', 'second'], null)).toBe('legacy');
    expect(fallbackStoreId(['legacy', 'second'], 'revoked-store')).toBe('legacy');
    expect(fallbackStoreId([], 'second')).toBeUndefined();
  });

  // A raw <a href="/..."> or next/link drops ?store=, and the provider then
  // picks a store for the user: an upload or reset can land in the wrong one.
  it('has no internal link that drops the selected store', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? files(join(dir, entry.name)) : /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [join(dir, entry.name)] : []);
    // Pages reached without a store, and the provider's own "choose a store" recovery link.
    const exempt = ['src/app/login/page.tsx', 'src/app/join/page.tsx', 'src/components/StoreProvider.tsx', 'src/components/StoreLink.tsx'];
    const offenders = files('src').filter(file => !exempt.includes(file)).flatMap(file => {
      const source = readFileSync(file, 'utf8');
      const rawAnchor = /<a\s[^>]*href=["'{`]+\//.test(source);
      const rawLink = /from 'next\/link'/.test(source);
      return rawAnchor || rawLink ? [file] : [];
    });
    expect(offenders).toEqual([]);
  });
});

describe('publishKey', () => {
  it('produces a 32-hex request identifier without crypto.randomUUID (plain-HTTP origins)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.forEach((_, i) => { bytes[i] = (i * 37 + 5) % 256; }); return bytes; } });
    expect(publishKey()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not repeat', () => {
    expect(publishKey()).not.toBe(publishKey());
  });
});
