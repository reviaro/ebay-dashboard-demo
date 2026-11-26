import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import TrafficPage from './traffic/page';
import ProfitabilityPage from './profitability/page';
import SourcingPage from './sourcing/page';
import { DEMO_AS_OF, DEMO_DATE } from '@/lib/demo/config';
import { demoYards, searchDemoYards } from '@/lib/demo/sourcing';

type Props = Record<string, unknown> & { children?: ReactNode };
type ChartProps = { data?: Record<string, unknown>[]; width?: number; height?: number; children?: ReactNode };
const controls = vi.hoisted(() => ({
  demo: true, direct: false, width: 320, index: 0, states: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[], callbacks: [] as ((...args: never[]) => unknown)[],
  effects: [] as (() => unknown)[], transitions: [] as Promise<unknown>[], charts: [] as ChartProps[],
}));
vi.mock('@/components/DemoProvider', () => ({ useDemoMode: () => controls.demo }));
vi.mock('next/dynamic', () => ({ default: () => () => <div data-map-pane="offline-reviewed-separately" /> }));
vi.mock('@/components/BrandingTemplate', () => ({ default: (props: Record<string, unknown>) => <div data-branding={JSON.stringify(props)}>Original branding component slot</div> }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = controls.index++;
      const value = index < controls.states.length ? controls.states[index] : initial;
      if (!controls.direct) return actual.useState(value);
      const setter = vi.fn(); controls.setters[index] = setter;
      return [value, setter];
    },
    useEffect: (callback: () => unknown, deps: unknown[]) => controls.direct ? void controls.effects.push(callback) : actual.useEffect(callback as () => void, deps),
    useCallback: (callback: (...args: never[]) => unknown, deps: unknown[]) => {
      if (!controls.direct) return actual.useCallback(callback, deps);
      controls.callbacks.push(callback); return callback;
    },
    useMemo: (callback: () => unknown, deps: unknown[]) => controls.direct ? callback() : actual.useMemo(callback, deps),
    useTransition: () => [false, (callback: () => Promise<unknown>) => { controls.transitions.push(callback()); }],
  };
});
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  return { ...actual, ResponsiveContainer: ({ children, height }: { children: ReactElement<ChartProps>; height: number }) => {
    controls.charts.push(children.props);
    return cloneElement(children, { width: controls.width, height });
  } };
});

const daily = Array.from({ length: 30 }, (_, day) => ({ date: `2026-09-${String(day + 1).padStart(2, '0')}`, impressions: 100 + day, views: 10 + day, ctr: 10 }));
const listings = [
  { listingId: 'DEMO-LIST-0008', title: 'Fictional Honda mirror [DEMO]', noteCount: 1, impressions: 1000, views: 100, ctr: 10, transactions: 0, conversionRate: 0 },
  { listingId: 'DEMO-LIST-0009', title: 'Fictional Volvo switch [DEMO]', noteCount: 0, impressions: 900, views: 90, ctr: 10, transactions: 9, conversionRate: 10 },
];
const sync = { state: 'inferred', lastSyncedAt: DEMO_AS_OF, message: null, earliestSyncedDate: '2025-10-01', windowExceedsData: false, truncatedDays: 0 };
const notes = [{ id: 1, listingId: listings[0].listingId, tags: ['DEMO', 'lower price'], note: 'DEMO sample note kept visible', createdAt: DEMO_AS_OF }];
const detail = { listingId: listings[0].listingId, totals: listings[0], daily };
function trafficStates(selected: string | null = null, overrides: Record<number, unknown> = {}) {
  const values: unknown[] = [listings, daily, sync, 2, 30, '', false, selected, detail, notes, ['lower price'], 'Sample note draft', false];
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return values;
}
const adListing = { itemId: 'DEMO-LIST-0009', title: 'Synthetic listing return', campaignName: 'DEMO Campaign', status: 'RUNNING', fundingModel: 'CPS', impressions: 1000, clicks: 50, sold: 10, sales: 1000, fees: 100, roas: 10, acos: 0.1, ctr: 5, conversionRate: 20 };
const profitability = {
  reportRange: { start: '2026-09-01T00:00:00Z', end: '2026-09-30T00:00:00Z' },
  transactionRange: { start: '2025-10-01T00:00:00Z', end: DEMO_AS_OF }, financeCoverageStart: '2025-10-01',
  financials: { grossRevenue: 800, grossOfFees: 1000, ebayFees: 200, refunds: 50, netRevenue: 750, orderRevenue: 1000, netPayout: 490, totalDeductions: 510, finalValueFees: 180, regulatoryFees: 10, penaltyFees: 0, internationalFees: 10, shippingLabels: 100, adFees: 150, otherFees: 10, feeRate: 51, orders: 10 },
  advertising: { impressions: 1000, clicks: 50, orders: 10, sales: 1000, spend: 150, roas: 1000 / 150, ctr: 5, conversionRate: 20 },
  campaigns: [{ campaignId: 'DEMO-CAMPAIGN-1', name: 'DEMO Campaign', ...adListing }],
  actions: { wasted: [{ ...adListing, itemId: 'DEMO-LIST-0008', title: 'Synthetic wasted spend', sold: 0, sales: 0 }], winners: [adListing] },
};
const yardRows = searchDemoYards('HONDA', 'Civic');
function sourcingStates(overrides: Record<number, unknown> = {}) {
  const values: unknown[] = ['HONDA', 'Civic', 'all', '', '', '', '', 'A', false, null, yardRows, null];
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return values;
}
function reset(states: unknown[], direct = false) {
  controls.states = states; controls.direct = direct; controls.index = 0; controls.setters = [];
  controls.effects = []; controls.callbacks = []; controls.transitions = []; controls.charts = [];
}
function render(Page: () => ReactNode, states: unknown[], width = 320) {
  reset(states); controls.width = width;
  const html = renderToStaticMarkup(<Page />), dom = parse(html);
  return { html, dom, text: dom.textContent };
}
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isValidElement<Props>(node) ? textOf(node.props.children) : '';
}
function button(tree: ReactNode, label: string) {
  const match = elements(tree).find(node => node.type === 'button' && textOf(node.props.children) === label);
  if (!match) throw new Error(`Missing button ${label}`);
  return match;
}
function invoke(element: ReactElement<Props>, handler: string, value?: unknown) {
  return (element.props[handler] as (value?: unknown) => unknown)(value);
}
beforeEach(() => { controls.demo = true; controls.direct = false; vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('original Traffic view in demo (SSR and isolated handlers, not browser QA)', () => {
  it.each([320, 696, 1280])('keeps window filters, listing rows, master chart and original scales at %ipx', width => {
    const { dom, text } = render(TrafficPage, trafficStates(), width);
    for (const title of ['Traffic & Metrics', '7 days', '30 days', '90 days', '1 year', '2 years', 'Store traffic', 'Daily impressions and views']) expect(text).toContain(title);
    for (const listing of listings) expect(text).toContain(listing.title);
    expect(dom.querySelector('input')?.getAttribute('placeholder')).toBe('Search listings…');
    expect(dom.querySelectorAll('.recharts-yAxis')).toHaveLength(1);
    expect(dom.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
    expect(controls.charts[0].data).toHaveLength(30);
  });
  it('keeps listing daily history, cards and existing notes while disabling all note-entry controls', () => {
    const { dom, text } = render(TrafficPage, trafficStates(listings[0].listingId));
    for (const title of ['Impressions', 'Views', 'CTR', 'Conversion', 'Daily trend', 'Notes', notes[0].note, 'Save Note']) expect(text).toContain(title);
    expect(dom.querySelector('textarea')?.hasAttribute('disabled')).toBe(true);
    const formButtons = dom.querySelectorAll('button').filter(node => ['lower price', 'Save Note'].includes(node.textContent));
    expect(formButtons).toHaveLength(2);
    expect(formButtons.every(node => node.hasAttribute('disabled'))).toBe(true);
    expect(text).toContain('Adding or changing notes is disabled');
    expect(text).toContain('9/30/2026, 11:59:59 PM UTC');
  });
  it('freezes freshness to the configured demo date, even with a future wall clock', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2040-01-01T00:00:00Z'));
    const { text } = render(TrafficPage, trafficStates());
    expect(text).toContain(`Synthetic snapshot · ${DEMO_DATE} UTC · recorded just now`);
    expect(text).not.toContain('Synced ');
  });
  it('explains partial sample coverage without suggesting a live backfill', () => {
    const { text } = render(TrafficPage, trafficStates(null, { 2: { ...sync, windowExceedsData: true } }));
    expect(text).toContain('synthetic snapshot starts on 2025-10-01');
    expect(text).toContain('live backfills are disabled');
    expect(text).not.toContain('run a backfill');
  });
  it('keeps search, date-window and listing-selection handlers working', () => {
    reset(trafficStates(), true); const tree = TrafficPage();
    invoke(button(tree, '7 days'), 'onClick'); expect(controls.setters[4]).toHaveBeenCalledWith(7);
    const input = elements(tree).find(node => node.type === 'input')!;
    invoke(input, 'onChange', { target: { value: 'mirror' } }); expect(controls.setters[5]).toHaveBeenCalledWith('mirror');
    const row = elements(tree).find(node => node.type === 'button' && textOf(node.props.children).includes(listings[0].title))!;
    invoke(row, 'onClick'); expect(controls.setters[7]).toHaveBeenCalledWith(listings[0].listingId);
  });
  it('uses GET-only original list/detail/note read contracts, including encoded search', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.method).toBeUndefined();
      return { json: async () => url.includes('/notes?') ? { notes } : url.includes('/traffic?') ? { listings, total: 2, daily, sync } : detail };
    });
    vi.stubGlobal('fetch', fetchMock);
    reset(trafficStates(listings[0].listingId, { 4: 7, 5: 'mirror & trim' }), true); TrafficPage();
    await controls.callbacks[0]();
    await (controls.callbacks[1] as (id: string) => unknown)('DEMO/LIST?1');
    const listUrl = new URL(fetchMock.mock.calls[0][0], 'http://local.test');
    expect(listUrl.searchParams.get('days')).toBe('7'); expect(listUrl.searchParams.get('search')).toBe('mirror & trim');
    expect(fetchMock.mock.calls.map(call => call[0])).toContain('/api/traffic/DEMO%2FLIST%3F1');
    expect(fetchMock.mock.calls.map(call => call[0])).toContain('/api/traffic/notes?listingId=DEMO%2FLIST%3F1');
    expect(controls.setters[8]).toHaveBeenCalledWith(detail); expect(controls.setters[9]).toHaveBeenCalledWith(notes);
  });
  it('rejects direct invocations of demo save/tag handlers before fetch or state writes', () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    reset(trafficStates(listings[0].listingId), true); const tree = TrafficPage();
    invoke(button(tree, 'Save Note'), 'onClick'); invoke(button(tree, 'lower price'), 'onClick');
    expect(fetchMock).not.toHaveBeenCalled(); expect(controls.setters.every(setter => setter.mock.calls.length === 0)).toBe(true);
  });
  it('preserves normal-mode notes, freshness and write handler', async () => {
    controls.demo = false;
    const { dom, text } = render(TrafficPage, trafficStates(listings[0].listingId));
    expect(text).toContain('Synced '); expect(text).not.toContain('Synthetic snapshot');
    expect(dom.querySelector('textarea')?.hasAttribute('disabled')).toBe(false);
    const fetchMock = vi.fn(async () => ({ ok: false })); vi.stubGlobal('fetch', fetchMock);
    reset(trafficStates(listings[0].listingId), true); const tree = TrafficPage();
    invoke(button(tree, 'Save Note'), 'onClick'); await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith('/api/traffic/notes', expect.objectContaining({ method: 'POST', body: JSON.stringify({ listingId: listings[0].listingId, tags: ['lower price'], note: 'Sample note draft' }) }));
  });
});

describe('original Profit & advertising view', () => {
  it.each([320, 696, 1280])('keeps all financial sections, deduction chart, campaign table and listing returns at %ipx', width => {
    const { dom, text } = render(ProfitabilityPage, [profitability, false, ''], width);
    for (const heading of ['Profit & advertising', 'Cash realization', 'Where the money went', 'Deduction ledger', 'Promoted Listings', 'Campaign scorecard', 'Spend without attributed sales', 'Best listing-level returns']) expect(text).toContain(heading);
    expect(dom.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(dom.querySelectorAll('.recharts-rectangle')).toHaveLength(6);
    expect(text).toContain(adListing.title); expect(text).toContain('Synthetic wasted spend');
    expect(text).toContain('Synthetic transaction deductions');
    expect(dom.querySelector('button')?.hasAttribute('disabled')).toBe(true);
    expect(dom.querySelector('a[href="/upload"]')).toBeNull();
  });
  it('maps historical grossRevenue to proceeds and grossOfFees to actual gross without relabeling sample data as CSV-era', () => {
    const { dom, text } = render(ProfitabilityPage, [profitability, false, '']);
    const cards = dom.querySelectorAll('.bg-slate-900.p-5');
    const card = (label: string) => cards.find(node => node.querySelector('p')?.textContent === label)?.textContent;
    expect(card('Gross revenue')).toBe('Gross revenue$1,000.00');
    expect(card('Proceeds after fees')).toBe('Proceeds after fees$800.00');
    expect(card('Net (proceeds − refunds)')).toBe('Net (proceeds − refunds)$750.00');
    expect(card('Order revenue (snapshot)')).toBe('Order revenue (snapshot)$1,000.00');
    expect(card('Deductions (incl. refunds)')).toBe('Deductions (incl. refunds)$510.00');
    expect(text).not.toContain('CSV era'); expect(text).not.toContain('Actual eBay');
    expect(text).toContain('Oct 1, 2025'); expect(text).toContain('Sep 30, 2026');
  });
  it('preserves original ordinary-mode import link and legacy labels', () => {
    controls.demo = false;
    const { dom, text } = render(ProfitabilityPage, [profitability, false, '']);
    expect(dom.querySelector('a[href="/upload"]')).not.toBeNull();
    expect(text).toContain('Actual eBay transaction deductions'); expect(text).toContain('Order revenue (CSV era)');
    expect(text).toContain('Deductions (CSV era)'); expect(text).not.toContain('Synthetic transaction');
  });
  it('keeps an empty demo view truthful without suggesting imports or a live sync', () => {
    const empty = { ...profitability, reportRange: null, financials: { ...profitability.financials, grossRevenue: 0, refunds: 0, orders: 0 } };
    const { text } = render(ProfitabilityPage, [empty, false, '']);
    expect(text).toContain('No synthetic profitability records are available');
    expect(text).not.toContain('wait for the finances sync');
  });
  it('retains original loading and error views', () => {
    expect(render(ProfitabilityPage, [null, true, '']).text).toContain('Building profitability view');
    expect(render(ProfitabilityPage, [null, false, 'Unable to load analysis']).text).toContain('Unable to load analysis');
  });
});

describe('original Sourcing form, results and generator slot', () => {
  it('preserves original sections and form controls with fictional demo yards', () => {
    const { dom, text } = render(SourcingPage, sourcingStates());
    for (const label of ['Sourcing Intelligence', 'Yard Locations', 'Inventory Search & Data Capture', 'Make', 'Model', 'Year', 'Yard Selection', 'Search Inventory', 'International Shipping Ready (eIS)', 'Generate Brand HTML']) expect(text).toContain(label);
    for (const yard of demoYards) expect(text).toContain(yard.name);
    expect(text).not.toContain('Pick-A-Part'); expect(text).not.toContain("Rupert's");
    expect(text).toContain('no yard websites are contacted');
    expect(dom.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(dom.querySelector('[data-map-pane]')).not.toBeNull();
  });
  it('keeps Volvo category, system, component and grade controls', () => {
    const { dom, text } = render(SourcingPage, sourcingStates({ 0: 'VOLVO', 4: 'xc90', 5: 'elec', 6: 'Audio Amplifier' }));
    for (const label of ['Model Series', 'System', 'Specific Component', 'Target Grade', 'Audio Amplifier', 'Climate Control Module']) expect(text).toContain(label);
    expect(dom.querySelectorAll('select')).toHaveLength(4);
  });
  it('keeps year filtering and selected fictional make metadata in the generator', () => {
    const selected = yardRows[0];
    const { dom } = render(SourcingPage, sourcingStates({ 3: selected.year, 9: selected }));
    expect(dom.querySelectorAll('tbody tr')).toHaveLength(yardRows.filter(row => row.year === selected.year).length);
    const props = JSON.parse(dom.querySelector('[data-branding]')!.getAttribute('data-branding')!);
    expect(props.brand).toBe('HONDA'); expect(props.partName).toContain(`${selected.year} HONDA Civic`);
    expect(props.mpn).toBe('DEMO-PLACEHOLDER-NOT-A-REAL-MPN');
    expect(props.fitment).toEqual([{ year: selected.year, model: 'Civic' }]);
    expect(props.countryOfOrigin).toContain('Fictional sample'); expect(props.weight).toContain('not measured');
  });
  it('searches the local fixture with exact fictional yard names and preserves model lookup', async () => {
    const fetchMock = vi.fn(async (url: string) => { expect(url).toContain('/api/sourcing/search?'); return { ok: true, json: async () => ({ results: yardRows }) }; }); vi.stubGlobal('fetch', fetchMock);
    reset(sourcingStates({ 0: 'VOLVO', 2: demoYards[1].name, 4: 'xc90' }), true); const tree = SourcingPage();
    const preventDefault = vi.fn(); const form = elements(tree).find(node => node.type === 'form')!;
    await invoke(form, 'onSubmit', { preventDefault }); await Promise.all(controls.transitions);
    expect(preventDefault).toHaveBeenCalledOnce(); expect(fetchMock).not.toHaveBeenCalled();
    expect(controls.setters[10]).toHaveBeenCalledWith(searchDemoYards('VOLVO', 'XC90', demoYards[1].name));
  });
  it('retains result-selection, close and repeated category-change reset handlers', () => {
    const scrollTo = vi.fn(); vi.stubGlobal('window', { scrollTo });
    reset(sourcingStates({ 9: yardRows[0] }), true); const tree = SourcingPage();
    const generate = elements(tree).find(node => node.type === 'button' && textOf(node.props.children) === 'Generate Brand HTML')!;
    invoke(generate, 'onClick'); expect(controls.setters[9]).toHaveBeenCalledWith(yardRows[0]);
    invoke(button(tree, 'Close Generator'), 'onClick'); expect(controls.setters[9]).toHaveBeenLastCalledWith(null);
    expect(scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'smooth' });
    reset(sourcingStates({ 0: 'VOLVO', 4: 'xc90', 5: 'elec', 6: 'Audio Amplifier' }), true);
    const volvoTree = SourcingPage(); const series = elements(volvoTree).find(node => node.type === 'select' && node.props.value === 'xc90')!;
    invoke(series, 'onChange', { target: { value: 'xc60' } }); invoke(series, 'onChange', { target: { value: 'xc90' } });
    expect(controls.setters[4]).toHaveBeenLastCalledWith('xc90'); expect(controls.setters[5]).toHaveBeenCalledTimes(2); expect(controls.setters[6]).toHaveBeenCalledTimes(2);
    expect(controls.setters[5]).toHaveBeenLastCalledWith(''); expect(controls.setters[6]).toHaveBeenLastCalledWith('');
  });
  it('keeps the production yard options, copy and branding defaults in ordinary mode', () => {
    controls.demo = false;
    const { text, dom } = render(SourcingPage, sourcingStates({ 9: yardRows[0] }));
    expect(text).toContain('real-time inventory'); expect(text).toContain('Pick-A-Part VA'); expect(text).toContain("Rupert's U-Pull It");
    const props = JSON.parse(dom.querySelector('[data-branding]')!.getAttribute('data-branding')!);
    expect(props.brand).toBeUndefined(); expect(props.mpn).toBe('OE-VOLVO-REPLACEMENT'); expect(props.countryOfOrigin).toBe('Sweden');
  });
  it('does not bundle yard scraper imports or introduce external media in the page', () => {
    const source = readFileSync(new URL('./sourcing/page.tsx', import.meta.url), 'utf8');
    expect(source).toContain("import type { YardResult } from '@/lib/yard-parser'");
    expect(source).not.toMatch(/<img|https?:\/\//);
  });
});
