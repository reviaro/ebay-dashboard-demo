import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import DemoRouteContent from './DemoRouteContent';

const route = vi.hoisted(() => ({ pathname: '/market' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname, notFound: () => { throw new Error('NEXT_HTTP_ERROR_FALLBACK;404'); } }));

describe('reviewed original demo routes', () => {
  it.each(['/', '/market', '/orders', '/expenses', '/inventory', '/traffic', '/profitability', '/price-compare', '/tasks', '/data', '/upload', '/settings', '/sourcing', '/listings'])
    ('renders the original %s route instead of a replacement design', pathname => {
      route.pathname = pathname;
      expect(renderToStaticMarkup(<DemoRouteContent><p>Original page {pathname}</p></DemoRouteContent>)).toContain(`Original page ${pathname}`);
    });

  it.each(['/login', '/market/unknown', '/new-unreviewed-page'])
    ('keeps the unreviewed original %s route unmounted with a genuine 404', pathname => {
      route.pathname = pathname;
      function UnreviewedPage(): never { throw new Error('Unreviewed original UI mounted'); }
      expect(() => renderToStaticMarkup(<DemoRouteContent><UnreviewedPage /></DemoRouteContent>)).toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    });
});
