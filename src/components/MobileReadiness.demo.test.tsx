import React, { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';
import DemoRouteContent from './DemoRouteContent';

// These are source/SSR and isolated callback contracts, not browser CSS layout,
// ResizeObserver, focus movement, touch interaction, or screenshot tests.
const controls = vi.hoisted(() => ({ pathname: '/', open: false, setOpen: vi.fn() }));
vi.mock('@/components/DemoProvider', () => ({ useDemoMode: () => true }));
vi.mock('@/components/StoreProvider', () => ({ useStore: () => ({ store: { name: 'Northstar Sample Parts' } }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => controls.pathname,
  notFound: () => { throw new Error('Unreviewed route'); },
}));
vi.mock('next/link', () => ({ default: (props: React.ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: () => [controls.open, controls.setOpen] };
});

const routes = ['/', '/market', '/expenses', '/orders', '/inventory', '/traffic',
  '/profitability', '/price-compare', '/upload', '/data', '/tasks', '/sourcing', '/listings', '/settings'];
type Props = { children?: ReactNode; href?: string; onClick?: () => void; 'aria-label'?: string };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function button(tree: ReactNode, label: string) {
  const result = elements(tree).find(node => node.type === 'button' && node.props['aria-label'] === label);
  if (!result) throw new Error(`Missing control: ${label}`);
  return result;
}
function source(relative: string) {
  return readFileSync(path.resolve('src', relative), 'utf8');
}
function parseSource(relative: string) {
  return ts.createSourceFile(relative, source(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function jsxNodes(file: ts.SourceFile, tag: string) {
  const found: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
  function visit(node: ts.Node) {
    if ((ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === tag)
      || (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === tag)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}
function attribute(node: ts.JsxElement | ts.JsxSelfClosingElement, name: string) {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const attr = opening.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText() === name);
  return attr && ts.isJsxAttribute(attr) ? attr.initializer?.getText() : undefined;
}

beforeEach(() => { controls.pathname = '/'; controls.open = false; controls.setOpen.mockClear(); });

describe('shared mobile navigation component contracts', () => {
  it.each(routes)('keeps all 14 destinations and the reviewed %s route', route => {
    controls.pathname = route;
    const html = renderToStaticMarkup(<Sidebar />);
    const dom = parse(html);
    expect(dom.querySelectorAll('nav a').map(link => link.getAttribute('href'))).toEqual(routes);
    expect(dom.querySelector('nav')?.getAttribute('aria-label')).toBe('Primary navigation');
    expect(dom.querySelector('aside')?.classList.contains('hidden')).toBe(true);
    expect(dom.querySelector('aside')?.classList.contains('md:flex')).toBe(true);
    expect(dom.querySelector('aside')?.classList.contains('md:w-56')).toBe(true);
    expect(renderToStaticMarkup(<DemoRouteContent><p>{route}</p></DemoRouteContent>)).toContain(route);
  });

  it('exposes a labeled 44px opening target and calls its open callback', () => {
    const tree = Sidebar();
    const dom = parse(renderToStaticMarkup(tree));
    const trigger = dom.querySelector('button[aria-label="Open navigation"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.classList.contains('h-11')).toBe(true);
    expect(trigger?.classList.contains('w-11')).toBe(true);
    expect(dom.querySelector('button[aria-label="Close navigation overlay"]')).toBeNull();
    button(tree, 'Open navigation').props.onClick?.();
    expect(controls.setOpen).toHaveBeenLastCalledWith(true);
  });

  it('keeps close, backdrop, and every destination wired to close the mobile drawer', () => {
    controls.open = true;
    const tree = Sidebar();
    const dom = parse(renderToStaticMarkup(tree));
    expect(dom.querySelector('button[aria-label="Open navigation"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(dom.querySelector('aside')?.classList.contains('flex')).toBe(true);
    expect(dom.querySelector('nav')?.classList.contains('overflow-y-auto')).toBe(true);
    for (const label of ['Close navigation', 'Close navigation overlay']) {
      button(tree, label).props.onClick?.();
      expect(controls.setOpen).toHaveBeenLastCalledWith(false);
    }
    const links = elements(tree).filter(node => routes.includes(node.props.href ?? ''));
    expect(links).toHaveLength(14);
    for (const link of links) {
      link.props.onClick?.();
      expect(controls.setOpen).toHaveBeenLastCalledWith(false);
    }
    expect(controls.setOpen).toHaveBeenCalledTimes(16);
  });
});

describe('responsive source contracts, without claiming pixel or browser verification', () => {
  it('keeps shrinkable main content, mobile header clearance, and desktop-only fixed height', () => {
    const file = parseSource('app/layout.tsx');
    const main = jsxNodes(file, 'main')[0];
    const classes = attribute(main, 'className');
    for (const token of ['min-w-0', 'overflow-y-auto', 'px-3', 'pt-16', 'md:p-6']) expect(classes).toContain(token);
    expect(source('app/layout.tsx')).toContain('min-h-screen md:h-screen md:overflow-hidden');
  });

  it('keeps the compact banner, focus-visible styling, and reduced-motion support', () => {
    const css = source('app/globals.css');
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/@media\s*\(max-width:640px\)[\s\S]*\.demo-banner\s*\{[^}]*flex-direction:column/);
  });

  it.each([
    ['app/page.tsx', 'w-full md:w-auto', 'setIsChatOpen', 'handleDownloadReport', false],
    ['app/tasks/page.tsx', 'p-1 bg-gray-50', "['all', 'todo', 'in-progress', 'completed']", 'setFilter(f)', false],
    ['app/orders/page.tsx', 'mt-2 w-full', 'setDateFrom', 'setDateTo', true],
    ['app/traffic/page.tsx', 'items-center gap-2', 'WINDOWS.map', 'setDays(w.days)', true],
  ] as const)('%s control row keeps narrow-screen wrapping and its existing handlers', (relative, marker, firstCallback, secondCallback, desktopNowrap) => {
    const file = parseSource(relative);
    const row = jsxNodes(file, 'div').find(node => {
      const classes = attribute(node, 'className');
      return classes?.includes(marker) && node.getText(file).includes(firstCallback) && node.getText(file).includes(secondCallback);
    });
    expect(row).toBeDefined();
    const classes = attribute(row!, 'className');
    expect(classes).toContain('flex-wrap');
    if (desktopNowrap) expect(classes).toContain('md:flex-nowrap');
    else {
      expect(classes).not.toContain('flex-nowrap');
      expect(classes).toContain('max-w-full');
    }
    expect(classes).toContain('gap-2');
    // The row still contains the same controls/read handlers; existing suites
    // exercise their callbacks. No disabled, hidden, reordered, or renamed UI.
    expect(row!.getText(file)).toContain(firstCallback);
    expect(row!.getText(file)).toContain(secondCallback);
  });

  it.each([
    ['app/page.tsx', 'setIsChatOpen', 'justify-between'],
    ['app/tasks/page.tsx', 'setSearchTerm', 'bg-white'],
  ])('%s allows the containing header/filter row to wrap alongside the tablet sidebar', (relative, callback, marker) => {
    const file = parseSource(relative);
    const row = jsxNodes(file, 'div').find(node => {
      const classes = attribute(node, 'className');
      return classes?.includes(marker) && classes.includes('md:flex-row') && node.getText(file).includes(callback);
    });
    expect(row).toBeDefined();
    expect(attribute(row!, 'className')).toContain('flex-wrap');
    // Direction is retained when the content fits. This is not a measured
    // viewport assertion; browser layout at 768px remains a manual check.
    expect(attribute(row!, 'className')).toContain('flex-col md:flex-row');
  });

  it('keeps a shrinkable task search with usable horizontal-row basis', () => {
    const file = parseSource('app/tasks/page.tsx');
    const wrapper = jsxNodes(file, 'div').find(node => attribute(node, 'className')?.includes('relative flex-1')
      && node.getText(file).includes('setSearchTerm'));
    const classes = attribute(wrapper!, 'className');
    expect(classes).toContain('min-w-0');
    expect(classes).toContain('md:basis-48');
  });

  it('scopes the compact category key to narrow demo panels while retaining wide pie labels', () => {
    const css = source('app/globals.css');
    expect(css).toMatch(/\.demo-category-pie\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*demo-category;/);
    expect(css).toMatch(/\.demo-category-pie-key\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/@container demo-category \(max-width: 479px\)\s*\{\s*\.recharts-pie-labels\s*\{\s*display:\s*none;\s*\}\s*\.demo-category-pie-key\s*\{\s*display:\s*block;/);
  });

  it.each(routes)('%s tables retain a local horizontal-scroll wrapper', route => {
    const file = parseSource(`app/${route === '/' ? '' : `${route.slice(1)}/`}page.tsx`);
    for (const table of jsxNodes(file, 'table')) {
      let parent: ts.Node | undefined = table.parent;
      let scrollable = false;
      while (parent) {
        if (ts.isJsxElement(parent) && attribute(parent, 'className')?.includes('overflow-x-auto')) scrollable = true;
        parent = parent.parent;
      }
      expect(scrollable, `Table at source offset ${table.pos} in ${route}`).toBe(true);
    }
  });

  it.each(['app/market/page.tsx', 'app/orders/page.tsx', 'app/traffic/page.tsx',
    'app/profitability/page.tsx', 'app/expenses/page.tsx', 'components/MarketAnalytics.tsx'])
    ('%s charts retain full-width containers with explicit heights', relative => {
      const file = parseSource(relative);
      const charts = jsxNodes(file, 'ResponsiveContainer');
      expect(charts.length).toBeGreaterThan(0);
      for (const chart of charts) {
        expect(attribute(chart, 'width')).toBe('"100%"');
        expect(attribute(chart, 'height')).toBeTruthy();
      }
    });

  it('keeps the Traffic list stacked and bounded on small screens', () => {
    const file = parseSource('app/traffic/page.tsx');
    const classes = jsxNodes(file, 'div').map(node => attribute(node, 'className'));
    expect(classes.some(value => value?.includes('flex-col') && value.includes('lg:flex-row'))).toBe(true);
    expect(classes.some(value => value?.includes('w-full max-h-80') && value.includes('lg:max-h-none lg:w-80'))).toBe(true);
  });

  it('keeps the original 400px full-width map pane and disables wheel zoom', () => {
    const file = parseSource('components/SourcingMap.tsx');
    expect(jsxNodes(file, 'div').some(node => attribute(node, 'className')?.includes('h-[400px] w-full'))).toBe(true);
    expect(attribute(jsxNodes(file, 'MapContainer')[0], 'scrollWheelZoom')).toBe('{false}');
  });
});
