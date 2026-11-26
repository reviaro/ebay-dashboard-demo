'use client';

export function storeUrl(path: string): string {
  if (typeof window === 'undefined' || !path.startsWith('/') || path.startsWith('//')) return path;
  const url = new URL(path, window.location.origin);
  const storeId = new URL(window.location.href).searchParams.get('store');
  if (storeId) url.searchParams.set('store', storeId);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * 32 hex characters for a publishing request. `crypto.randomUUID` exists only
 * in secure contexts, and the dashboard may also be served over plain HTTP on
 * private-network addresses; `getRandomValues` works in both.
 */
export function publishKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Store to open when the URL names none: this tab's last store if still available, else the first. */
export function fallbackStoreId(storeIds: string[], remembered: string | null): string | undefined {
  return remembered && storeIds.includes(remembered) ? remembered : storeIds[0];
}

export async function storeFetch(path: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(storeUrl(path), { ...options, cache: 'no-store' });
  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    window.location.href = '/login';
    throw new Error('Please sign in again.');
  }
  return response;
}

export async function storeJson<T = Record<string, unknown>>(path: string, options?: RequestInit): Promise<T> {
  const response = await storeFetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}
