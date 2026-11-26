import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '@/app/page';
import OrdersPage from '@/app/orders/page';
import InventoryPage from '@/app/inventory/page';
import PriceComparePage from '@/app/price-compare/page';
import AIChatDrawer from './AIChatDrawer';
import BrandingTemplate from './BrandingTemplate';
import { DEMO_DATE, DEMO_QUESTIONS } from '@/lib/demo/config';
import { demoListings } from '@/lib/demo/data';
import { demoChatResponse } from '@/lib/demo/chat';
import cachedAnswers from '@/lib/demo/answers.json';

type NodeProps = { children?: ReactNode; onClick?: () => void; onChange?: (event: unknown) => void; onSubmit?: (event: unknown) => void; [key: string]: unknown };
const controls = vi.hoisted(() => ({
  demo: true, index: 0, states: [] as unknown[], values: [] as unknown[],
  effects: [] as (() => unknown)[], charts: [] as Record<string, unknown>[],
  loading: false, metrics: {} as Record<string, unknown>, width: 320,
}));
vi.mock('@/components/StoreLink', () => ({ default: 'a' }));
vi.mock('@/components/DemoProvider', () => ({ useDemoMode: () => controls.demo }));
vi.mock('@/hooks/useDashboardMetrics', () => ({ useDashboardMetrics: () => ({ metrics: { metrics: controls.metrics, lastUpdated: '2026-09-30T23:59:59Z' }, isLoading: controls.loading }) }));
vi.mock('@/components/MarketAnalytics', () => ({ default: ({ data }: { data: Record<string, unknown> }) => <div data-original-market={JSON.stringify(data)}>Original MarketAnalytics</div> }));
// Capture the root's state/event callbacks without adding a browser dependency.
// SSR remains real React/Recharts rendering, not browser layout or hydration QA.
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = controls.index++;
      const value = index < controls.states.length ? controls.states[index] : typeof initial === 'function' ? initial() : initial;
      controls.values[index] = value;
      return [value, (next: unknown) => { controls.values[index] = typeof next === 'function' ? next(controls.values[index]) : next; }];
    },
    useEffect: (effect: () => unknown) => { controls.effects.push(effect); },
    useCallback: (callback: unknown) => callback,
    useRef: (value: unknown) => ({ current: value }),
  };
});
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children, height }: { children: ReactElement<Record<string, unknown>>; height: number }) => {
      controls.charts.push(children.props);
      return cloneElement(children, { width: controls.width, height });
    },
  };
});

function prepare(states: unknown[] = []) {
  controls.index = 0;
  controls.states = states;
  controls.values = [];
  controls.effects = [];
  controls.charts = [];
}
function nodes(node: ReactNode, tag: string): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, tag));
  if (!isValidElement<NodeProps>(node)) return [];
  return [...(node.type === tag ? [node] : []), ...nodes(node.props.children, tag)];
}
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isValidElement<NodeProps>(node) ? textOf(node.props.children) : '';
}
function button(tree: ReactNode, text: string) {
  const result = nodes(tree, 'button').find(node => textOf(node.props.children) === text || node.props['aria-label'] === text);
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}
function render(tree: ReactNode) {
  const html = renderToStaticMarkup(tree);
  const dom = parse(html);
  return { html, dom, text: dom.textContent };
}
const listings = demoListings();
const items = listings.slice(0, 2).map(row => ({ key: row.listingId, id: row.index, itemId: row.listingId, sku: row.sku, title: row.title, brand: row.brand, price: row.priceCents / 100, quantity: row.quantity, views: 182 + row.index, watchers: 8 + row.index, condition: 'Used [DEMO]', location: 'Demo warehouse', source: 'api', status: row.status, lastSeenAt: '2026-09-30T23:59:59Z' }));
const catalog = { items, total: 56, page: 1, stats: { _sum: { quantity: 160 }, _count: { _all: 56 }, _avg: { price: 104.95 } }, listingStatus: { active: 56, activeQuantity: 160, activeValue: 15000, sold: 2, ended: 2, unknown: 0 } };
const orders = { orders: [{ key: 'DEMO-ORDER-00001', source: 'api', orderNumber: 'DEMO-ORDER-00001', saleDate: '2026-09-30T23:59:59Z', itemTitle: items[0].title, brand: 'Volvo', itemNumber: items[0].itemId, soldFor: 34.95, shipping: 5.95, eBayTax: 2.66, totalPrice: 43.56, shipToState: 'CA', shipToCountry: 'United States', promoted: true, quantity: 1, lineItemCount: 1, paymentStatus: 'PAID', refunded: false }], total: 1020, page: 1, stats: { _sum: { soldFor: 135000, totalPrice: 160000, eBayTax: 9650, shipping: 13468.87 }, refundTotal: 5959, ebayFees: 20286.1, proceedsAfterFees: 128182.77, _count: { _all: 1020 } }, chartItems: Array.from({ length: 12 }, (_, i) => ({ saleDate: new Date(Date.UTC(2025, 9 + i, 1)).toISOString(), soldFor: 3000 + i * 500, eBayTax: 250, shipping: 300 })) };
const metrics = { revenue: 148468.87, avgOrderValue: 145.56, netRevenue: 128182.77, ebayFees: 20286.1, activeListings: 56, totalOrders: 1020, nicheAuthority: .12, globalReach: .15, bestMonth: 'Sep 2026', profitPerBrand: [{ brand: 'Volvo', grossRevenue: 20000, netRevenue: 17000, units: 160 }], monthlySales: [{ month: '2026-09', label: 'Sep 2026', revenue: 20000, orders: 114 }], salesInsights: ['Synthetic insights'], topStates: [{ state: 'CA', revenue: 20000 }], promotedStats: { promotedOrders: 400, organicOrders: 620, promotedPct: 400 / 1020, promotedRevenue: 50000, organicRevenue: 98468.87 } };

beforeEach(() => {
  controls.demo = true;
  controls.loading = false;
  controls.metrics = metrics;
  controls.width = 320;
  prepare();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('original Dashboard and catalog demo views', () => {
  it('preserves the original dashboard layout, cards, original chart and read-only navigation', () => {
    prepare([true, true, false, false, [{ id: 1, title: 'Review a sample listing', status: 'pending', priority: 'high' }], 'all', undefined, undefined, true]);
    const tree = Dashboard();
    const { text, dom } = render(tree);
    for (const title of ['Store Performance', 'Market Momentum', 'Task Matrix', 'Key Insights', 'Top Markets', 'Promoted vs Organic', 'Sales by Brand', 'AI Strategy Partner']) expect(text).toContain(title);
    expect(dom.querySelector('.lg\\:col-span-8')).not.toBeNull();
    expect(dom.querySelector('[data-original-market]')?.getAttribute('data-original-market')).toContain('2026-09');
    expect(text).toContain('Demo Yard North');
    expect(text).toContain(`Synthetic snapshot · ${DEMO_DATE}`);
    expect(text).toContain('synthetic finance records');
    expect(text).not.toMatch(/Last synced|Pick-A-Part VA|Specialist Online|Lifetime revenue/);
    const upload = button(tree, 'Upload CSV');
    expect(upload.props.disabled).toBe(true);
    expect(upload.props.title).toContain('read-only');
    for (const title of ['Reset dashboard data', 'Add task']) expect(button(tree, title).props.disabled).toBe(true);
    expect(button(tree, 'Ask Agent').props.disabled).toBeUndefined();
    expect(button(tree, 'Report').props.disabled).toBeUndefined();
    expect(nodes(tree, 'a').find(node => node.props.href === '/tasks')).toBeDefined();
    expect(nodes(tree, 'a').find(node => node.props.href === '/sourcing')).toBeDefined();
  });

  it('fails closed for reset callbacks even if the modal state is forced open', async () => {
    prepare([false, false, true, false, [], 'all', undefined, undefined, true]);
    const tree = Dashboard();
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    for (const node of nodes(tree, 'button').filter(node => textOf(node.props.children).includes('Clear '))) {
      expect(node.props.disabled).toBe(true);
      await node.props.onClick?.();
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('downloads the original read-only report with a snapshot-date filename', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ title: 'Synthetic report', generatedAt: '2026-09-30T23:59:59.999Z' }) });
    vi.stubGlobal('fetch', request);
    const anchor = { href: '', download: '', click: vi.fn() };
    const document = { createElement: vi.fn(() => anchor), body: { appendChild: vi.fn(), removeChild: vi.fn() } };
    const urls = { createObjectURL: vi.fn(() => 'blob:local-sample-report'), revokeObjectURL: vi.fn() };
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', { URL: urls, location: new URL('http://demo.test/') });
    const tree = Dashboard();
    await button(tree, 'Report').props.onClick?.();
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/reports', { cache: 'no-store' });
    expect(anchor.download).toBe('weekly-strategy-report-2026-09-30.json');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:local-sample-report');
    expect(document.body.removeChild).toHaveBeenCalledWith(anchor);
  });

  it('retains normal-mode controls, source descriptions and original chat', () => {
    controls.demo = false;
    prepare([true, true, false, false, [], 'all', undefined, undefined, true]);
    const tree = Dashboard();
    const { text } = render(tree);
    expect(text).toContain('Pick-A-Part VA');
    expect(text).toContain('Store strategy & sourcing');
    expect(text).toContain('Last synced');
    expect(text).toContain('Lifetime revenue · all uploads');
    expect(text).not.toContain('Cached sample answers');
    expect(nodes(tree, 'a').find(node => node.props.href === '/upload')).toBeDefined();
    expect(button(tree, 'Reset dashboard data').props.disabled).toBe(false);
    expect(button(tree, 'Add task').props.disabled).toBe(false);
  });

  it.each([320, 696, 1280])('renders original Orders summary, monthly chart, source column, search and pagination at %ipx', width => {
    controls.width = width;
    prepare([orders, 1, '', false, '', '', '', false, null]);
    const tree = OrdersPage();
    const { text, dom } = render(tree);
    expect(text).toContain('Orders & Sales');
    expect(text).toContain('Monthly Sales Breakdown');
    expect(text).toContain('fictional store history');
    expect(text).toContain('9/30/2026');
    expect(text).toContain('Page 1 of 21 (1020 orders)');
    expect(dom.querySelectorAll('th')).toHaveLength(11);
    expect(dom.querySelectorAll('.recharts-rectangle')).toHaveLength(36);
    expect(controls.charts[0].data).toHaveLength(12);
    expect(text).not.toMatch(/eBay synced|never synced|CSV uploaded/);
    expect(button(tree, 'Last Month').props.disabled).toBeUndefined();
    button(tree, 'Next').props.onClick?.();
    expect(controls.values[1]).toBe(2);
  });

  it.each([['Last Month', '2026-08-30'], ['Last 3 Months', '2026-06-30'], ['Last Year', '2025-09-30']])('anchors %s to the UTC snapshot rather than the runtime clock', (label, from) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2040-01-01T01:00:00Z'));
    prepare();
    const tree = OrdersPage();
    button(tree, label).props.onClick?.();
    expect(controls.values[4]).toBe(from);
    expect(controls.values[5]).toBe(DEMO_DATE);
    expect(controls.values[1]).toBe(1);
  });

  it('keeps Orders source freshness and live-clock presets in normal mode', () => {
    controls.demo = false;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-09-30T12:00:00Z'));
    prepare([orders, 1, '', false, '', '', '', false, { orders: { state: 'never', lastSyncedAt: null, inferred: false, message: null, orderCount: 0 }, csv: { lastUploadAt: null, filename: null } }]);
    const tree = OrdersPage();
    const { text } = render(tree);
    expect(text).toContain('eBay API and CSV history combined');
    expect(text).toContain('never synced from eBay');
    button(tree, 'Last Month').props.onClick?.();
    expect(controls.values[5]).toBe('2030-09-30');
  });

  it('keeps original Inventory status tabs, all columns, search and page controls', () => {
    prepare([catalog, 1, '', 'active', false]);
    const tree = InventoryPage();
    const { text, dom } = render(tree);
    expect(text).toContain('Active Listings');
    expect(text).toContain('synthetic listing snapshot');
    expect(text).toContain(items[0].title);
    expect(dom.querySelectorAll('th')).toHaveLength(10);
    for (const title of ['Active (56)', 'Sold (2)', 'Ended (2)', 'All']) expect(button(tree, title)).toBeDefined();
    button(tree, 'Sold (2)').props.onClick?.();
    expect(controls.values[3]).toBe('sold');
    expect(controls.values[1]).toBe(1);
    expect(text).not.toMatch(/latest eBay report|past CSV uploads|Sync from eBay/);
  });

  it('keeps Listing Overview cards, original sort choices, table and filters', () => {
    prepare([catalog, '', 'watchers_desc', 'active', false, '', 1]);
    const tree = PriceComparePage();
    const { text, dom } = render(tree);
    expect(text).toContain('Listing Overview');
    expect(text).toContain('Synthetic listings and status history');
    expect(text).toContain(items[0].sku);
    expect(dom.querySelectorAll('th')).toHaveLength(9);
    expect(dom.querySelectorAll('option').map(node => node.textContent)).toEqual(['Price: High → Low', 'Price: Low → High', 'Most Watchers', 'Most Views']);
    button(tree, 'Ended (2)').props.onClick?.();
    expect(controls.values[3]).toBe('ended');
    expect(controls.values[6]).toBe(1);
  });

  it('preserves normal-mode Inventory and Listing Overview descriptions', () => {
    controls.demo = false;
    prepare([catalog, 1, '', 'active', false]);
    expect(render(InventoryPage()).text).toContain('eBay report and CSV listing history');
    prepare([catalog, '', 'watchers_desc', 'active', false, '', 1]);
    expect(render(PriceComparePage()).text).toContain('Live eBay listings and CSV listing history');
  });

  it('keeps search and status filtering as same-origin read requests', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => catalog });
    vi.stubGlobal('fetch', request);
    prepare([catalog, 2, 'Volvo', 'ended', false]);
    InventoryPage();
    await controls.effects[0]();
    expect(request).toHaveBeenCalledWith('/api/inventory?page=2&limit=50&search=Volvo&status=ended', { cache: 'no-store' });
    prepare([orders, 1, 'Volvo', false, '2026-09-01', DEMO_DATE, 'custom', true, null]);
    OrdersPage();
    for (const effect of controls.effects) await effect();
    expect(request).toHaveBeenCalledWith('/api/orders?page=1&limit=50&search=Volvo&dateFrom=2026-09-01&dateTo=2026-09-30', { cache: 'no-store' });
    expect(request.mock.calls.flat().join(' ')).not.toContain('/api/ebay/sync/status');
  });
});

describe('original cached demo chat and local description preview', () => {
  it('shows exactly the five cached questions inside the original drawer', () => {
    const { text, dom } = render(AIChatDrawer({ isOpen: true, onClose: vi.fn() }));
    expect(text).toContain('AI Strategy Partner');
    expect(text).toContain('Cached sample answers');
    for (const question of DEMO_QUESTIONS) expect(text).toContain(question);
    expect(dom.querySelectorAll('[aria-label="Sample questions"] button')).toHaveLength(5);
    expect(dom.querySelector('form input')).not.toBeNull();
    expect(text).not.toContain('Specialist Online');
  });

  it.each(DEMO_QUESTIONS)('selects cached content with the original API contract: %s', async question => {
    const request = vi.fn().mockImplementation((_url: string, init: RequestInit) => demoChatResponse(new Request('http://demo.local/api/chat', init)));
    const answer = cachedAnswers.questions.find(entry => entry.question === question)!.answer;
    vi.stubGlobal('fetch', request);
    const tree = AIChatDrawer({ isOpen: true, onClose: vi.fn() });
    button(tree, question).props.onClick?.();
    await vi.waitFor(() => expect((controls.values[0] as { content: string }[]).at(-1)?.content).toBe(answer));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }), cache: 'no-store' });
    expect(controls.values[2]).toBe(false);
  });

  it('keeps closed chat unmounted and blocks repeat submits while loading', () => {
    expect(AIChatDrawer({ isOpen: false, onClose: vi.fn() })).toBeNull();
    prepare([[{ role: 'assistant', content: 'Cached answer' }], DEMO_QUESTIONS[0], true]);
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const tree = AIChatDrawer({ isOpen: true, onClose: vi.fn() });
    expect(button(tree, 'Send message').props.disabled).toBe(true);
    for (const question of DEMO_QUESTIONS) {
      expect(button(tree, question).props.disabled).toBe(true);
      button(tree, question).props.onClick?.();
    }
    nodes(tree, 'form')[0].props.onSubmit?.({ preventDefault: vi.fn() });
    expect(request).not.toHaveBeenCalled();
  });

  it('shows a cached-service error rather than claiming live AI connectivity', async () => {
    const request = vi.fn().mockResolvedValue({ json: async () => ({ error: 'Cache unavailable' }) });
    vi.stubGlobal('fetch', request);
    const tree = AIChatDrawer({ isOpen: true, onClose: vi.fn() });
    button(tree, DEMO_QUESTIONS[0]).props.onClick?.();
    await vi.waitFor(() => expect((controls.values[0] as { content: string }[]).at(-1)?.content).toBe('The cached sample answer could not be loaded. Please try again.'));
    expect(controls.values[2]).toBe(false);
  });

  it('retains ordinary-mode chat messages payload and close behavior', async () => {
    controls.demo = false;
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: 'Ordinary answer' }) });
    vi.stubGlobal('fetch', request);
    const history = [{ role: 'assistant', content: 'Hello' }];
    prepare([history, 'Question', false, { providers: [{ id: 'gemini', configured: true }] }, 'gemini', '']);
    const close = vi.fn();
    const tree = AIChatDrawer({ isOpen: true, onClose: close });
    button(tree, 'Close chat').props.onClick?.();
    expect(close).toHaveBeenCalledOnce();
    nodes(tree, 'form')[0].props.onSubmit?.({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect((controls.values[0] as { content: string }[]).at(-1)?.content).toBe('Ordinary answer'));
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ provider: 'gemini', messages: [...history, { role: 'user', content: 'Question' }] });
  });

  it('preserves safe local HTML copy with explicitly fictional vehicle details', () => {
    const copy = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
    const tree = BrandingTemplate({ brand: 'Honda', partName: '2013 Honda Accord Sample Window Switch', mpn: 'DEMO-PLACEHOLDER-NOT-A-REAL-MPN', fitment: [{ year: '2013', model: 'Accord' }], condition: 'Fictional example', isInternationalReady: true, countryOfOrigin: 'Demo placeholder' });
    const { text } = render(tree);
    expect(text).toContain('Fictional preview');
    expect(text).toContain('Honda Fictional Preview');
    expect(text).toContain('not verified fitment information');
    expect(text).not.toContain('Tested OEM Volvo Specialist');
    expect(button(tree, 'Copy HTML Template').props.disabled).toBeUndefined();
    button(tree, 'Copy HTML Template').props.onClick?.();
    expect(copy).toHaveBeenCalledOnce();
    expect(copy.mock.calls[0][0]).toContain('Honda Fictional Preview');
    expect(copy.mock.calls[0][0]).not.toContain('Fully eligible');
  });

  it('keeps the original description generator unchanged in normal mode', () => {
    controls.demo = false;
    const { text } = render(BrandingTemplate({ partName: 'Window Switch', mpn: 'OEM-123', fitment: [{ year: '2010', model: 'XC90' }], condition: 'Used', isInternationalReady: true }));
    expect(text).toContain('Tested OEM Volvo Specialist');
    expect(text).toContain('Specializing in 2003-2016 Models');
    expect(text).toContain('eIS Ready');
    expect(text).not.toContain('Fictional preview');
  });

  it('never embeds external images, links, model SDKs or storage in the restored views', () => {
    for (const relative of ['../app/page.tsx', '../app/orders/page.tsx', '../app/inventory/page.tsx', '../app/price-compare/page.tsx', './AIChatDrawer.tsx', './SuccessDashboard.tsx', './BrandingTemplate.tsx']) {
      const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
      expect(source).not.toMatch(/(?:href|src)=["']https?:|fetch\(["']https?:|@google\/generative-ai|localStorage|sessionStorage/);
    }
  });
});
