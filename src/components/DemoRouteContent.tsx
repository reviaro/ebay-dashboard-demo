'use client';

import type { ReactNode } from 'react';
import { notFound, usePathname } from 'next/navigation';
import StoreLink from './StoreLink';

const REVIEWED_PAGES = new Set([
  '/', '/market', '/orders', '/inventory', '/price-compare', '/traffic',
  '/profitability', '/expenses', '/tasks', '/upload', '/data', '/settings', '/sourcing',
  '/listings', '/join',
]);

/**
 * Restore the actual application's views only after their read contracts and
 * controls have been reviewed for demo mode. This is presentation routing, not
 * an authorization boundary: proxy, handlers and Prisma enforce read-only mode.
 */
export default function DemoRouteContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (!pathname || !REVIEWED_PAGES.has(pathname)) notFound();
  if (pathname === '/join') return (
    <section className="space-y-3 text-slate-100">
      <h1 className="text-2xl font-semibold">Store invitations</h1>
      <p>Invitations are disabled in this read-only demo.</p>
      <StoreLink className="text-blue-300 underline" href="/">Explore the demo store</StoreLink>
    </section>
  );
  return children;
}
