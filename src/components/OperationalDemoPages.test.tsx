import React, { cloneElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDemoData } from '@/lib/demo/data';
import { DEMO_AS_OF, DEMO_DATE } from '@/lib/demo/config';
import { DEMO_UPLOAD_HISTORY, demoExpenseFeeMonths, type DemoExpenseMetrics } from '@/lib/demo/operational-presentation';
import ExpensesPage from '@/app/expenses/page';
import TasksPage from '@/app/tasks/page';
import UploadPage from '@/app/upload/page';
import DataLibraryPage from '@/app/data/page';
import SettingsPage from '@/app/settings/page';
import EbayConnection from './EbayConnection';
import EbaySync from './EbaySync';
import SyncHealth from './SyncHealth';
import SyncSchedule from './SyncSchedule';

type Props = Record<string, any>;
type Element = ReactElement<Props>;
const controls = vi.hoisted(() => ({
  demo: true, width: 320, index: 0, states: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
  swr: {} as Record<string, unknown>, charts: [] as Props[],
  effects: [] as (() => unknown)[],
}));
vi.mock('@/components/DemoProvider', () => ({ useDemoMode: () => controls.demo }));
vi.mock('@/components/StoreProvider', () => ({ useStore: () => ({ store: { name: 'Northstar Sample Parts', role: 'viewer' } }) }));
vi.mock('swr', () => ({ default: (key: string) => ({ data: controls.swr[key], mutate: vi.fn(), isLoading: false, isValidating: false }) }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = controls.index++;
      const value = index < controls.states.length ? controls.states[index] : typeof initial === 'function' ? initial() : initial;
      const setter = vi.fn(); controls.setters[index] = setter;
      return [value, setter];
    },
    useEffect: (effect: () => unknown) => { controls.effects.push(effect); },
    useCallback: (callback: unknown) => callback,
  };
});
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children, height }: { children: ReactElement<Props>; height: number }) => {
      controls.charts.push(children.props);
      return cloneElement(children, { width: controls.width, height });
    },
  };
});
const seed = buildDemoData();
const date = (value: unknown) => new Date(value as string).toISOString();
const sum = <T,>(rows: T[], value: (row: T) => unknown) => rows.reduce((total, row) => total + Math.round(Number(value(row)) * 100), 0) / 100;
const months = [...new Set(seed.sales.map(row => date(row.saleDate).slice(0, 7)))];
const feeMonths = months.map(month => {
  const rows = seed.finance.filter(row => row.transactionType === 'SALE' && date(row.transactionDate).startsWith(month));
  const splits = rows.flatMap(row => JSON.parse(row.feeDetails as string) as { feeType: string; amount: string }[]);
  return {
    month,
    finalValueFee: sum(splits.filter(row => row.feeType === 'FINAL_VALUE_FEE'), row => row.amount),
    perOrderFee: sum(splits.filter(row => row.feeType === 'FINAL_VALUE_FEE_FIXED_PER_ORDER'), row => row.amount),
    otherFee: sum(splits.filter(row => !['FINAL_VALUE_FEE', 'FINAL_VALUE_FEE_FIXED_PER_ORDER'].includes(row.feeType)), row => row.amount),
  };
});
const metrics: DemoExpenseMetrics = {
  revenue: sum(seed.orders, row => Number(row.totalAmount) - Number(row.tax)),
  totalOrders: seed.orders.length,
  ebayFees: sum(seed.orders, row => row.ebayFees),
  byMonth: feeMonths,
};
const cogs = {
  invByMonth: seed.inventoryExpenses.map(row => ({ month: date(row.date).slice(0, 7), amount: row.amount })),
  invByVendor: [{ vendor: seed.inventoryExpenses[0].vendor, total: sum(seed.inventoryExpenses, row => row.amount) }],
  feesByMonth: seed.fees.map(row => ({ month: row.month, finalValue: row.amount, perOrder: 0, flat: 0, total: row.amount })),
  totalInventoryCost: sum(seed.inventoryExpenses, row => row.amount), totalFees: sum(seed.fees, row => row.amount),
  tripCount: seed.inventoryExpenses.length, hasExpenseData: true, hasFeeData: true,
};
const operating = {
  expenses: seed.generalExpenses,
  total: sum(seed.generalExpenses, row => row.amount),
  byCategory: [...new Set(seed.generalExpenses.map(row => row.category))].map(category => ({ category, total: sum(seed.generalExpenses.filter(row => row.category === category), row => row.amount) })),
  byMonth: months.map(month => ({ month, amount: sum(seed.generalExpenses.filter(row => date(row.date).startsWith(month)), row => row.amount) })),
};
const settings = seed.syncSettings.map(row => ({ ...row, available: ['daily', 'weekly'] }));
const runs = seed.syncLogs.map(row => ({ ...row, startedAt: date(row.startedAt), finishedAt: date(row.finishedAt) }));
const suggestions = [{ title: 'Review synthetic slow-moving listings', description: 'DEMO read-only insight' }];
function configure(states: unknown[] = []) {
  controls.index = 0; controls.states = states; controls.setters = []; controls.effects = []; controls.charts = [];
}
function render(component: () => ReactElement | null, states: unknown[] = []) {
  configure(states);
  const tree = component();
  const html = renderToStaticMarkup(tree);
  const dom = parse(html);
  return { tree, html, dom, text: dom.textContent };
}
function walk(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...walk(node.props.children)];
}
function find(tree: ReactNode, predicate: (node: Element) => boolean) {
  const found = walk(tree).find(predicate);
  if (!found) throw new Error('Expected element not found');
  return found;
}
function textOf(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<Props>(node)) return textOf(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
function button(tree: ReactNode, text: string) {
  return find(tree, node => node.type === 'button' && textOf(node).includes(text));
}
function expenseStates(tab: string, overrides: { cogs?: unknown; operating?: unknown; metrics?: unknown } = {}) {
  return [tab, 'cogs' in overrides ? overrides.cogs : cogs, 'operating' in overrides ? overrides.operating : operating, false, null, 'metrics' in overrides ? overrides.metrics : metrics];
}
const formEvent = { preventDefault: vi.fn() };
beforeEach(() => {
  controls.demo = true; controls.width = 320; controls.swr = { '/api/tasks/suggest': suggestions, '/api/ebay/status': { connected: false, environment: 'demo' } };
  configure();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('operational demo fixture projection', () => {
  it('matches exactly the existing generator without loading the generator in the browser', () => {
    expect(DEMO_UPLOAD_HISTORY).toEqual(seed.uploads.map(({ id, filename, type, rowCount, createdAt }) => ({ id, filename, type, rowCount, createdAt: date(createdAt) })));
    expect(sum(demoExpenseFeeMonths(metrics), row => row.total)).toBe(metrics.ebayFees);
    expect(metrics.revenue).toBe(sum(seed.sales, row => Number(row.soldFor) + Number(row.shipping)));
  });
});

describe('original operational page SSR, not browser/CSS/hydration QA', () => {
  it.each([320, 696, 1280])('retains all Expenses tabs and original populated charts at %ipx', width => {
    controls.width = width;
    for (const tab of ['overview', 'cogs', 'operating', 'fees']) {
      const { dom, text } = render(ExpensesPage, expenseStates(tab));
      expect(dom.querySelectorAll('button').slice(0, 4).map(node => node.textContent)).toEqual(['Overview', 'Cost of Goods', 'Operating Expenses', 'eBay Fees']);
      expect(dom.querySelectorAll('button').slice(0, 4).every(node => !node.hasAttribute('disabled'))).toBe(true);
      expect(text).toContain(DEMO_DATE);
      expect(text).not.toMatch(/40-trip|200 synthetic orders|20000|\$20,000|2024|10\.6%|\$2,120|NaN|Infinity/);
      expect(dom.querySelectorAll('svg.recharts-surface').length).toBeGreaterThan(0);
      expect(controls.charts[0].data).toHaveLength(12);
      if (tab === 'cogs') {
        expect(text).toContain('Recorded purchase entries');
        expect(text).toContain(`${(cogs.totalInventoryCost / cogs.tripCount).toFixed(2)}`);
        expect(text).toContain(`${(cogs.totalInventoryCost / metrics.revenue * 100).toFixed(1)}%`);
      }
      if (tab === 'operating') {
        expect(dom.querySelectorAll('tbody tr')).toHaveLength(36);
        expect(dom.querySelector('fieldset')?.hasAttribute('disabled')).toBe(true);
        expect(dom.querySelectorAll('button[aria-label^="Delete expense"]').every(node => node.hasAttribute('disabled'))).toBe(true);
        expect(dom.querySelector('input[type="date"]')?.getAttribute('value')).toBe(DEMO_DATE);
        expect(dom.querySelector('tbody tr td')?.textContent).toBe('Oct 1, 2025');
      }
      if (tab === 'fees') {
        expect(dom.querySelectorAll('.recharts-rectangle')).toHaveLength(36);
        expect(text).toContain('1,020 recorded orders');
        expect(text).toContain((metrics.ebayFees / metrics.totalOrders).toFixed(2));
        expect(controls.charts[0].data.map((row: Props) => row.total)).toEqual(demoExpenseFeeMonths(metrics).map(row => row.total));
      }
    }
  });
  it('withholds expense totals when any canonical source fails instead of using fabricated fallback data', () => {
    for (const overrides of [{ cogs: null }, { operating: null }, { metrics: null }]) {
      const { text, dom } = render(ExpensesPage, expenseStates('overview', overrides));
      expect(text).toContain('Totals are unavailable');
      expect(dom.querySelectorAll('svg.recharts-surface')).toHaveLength(0);
      expect(text).not.toContain('0 total expenses');
    }
  });
  it('shows true zero/empty expense data without fallback trips, orders, or percentage errors', () => {
    const empty = { ...cogs, tripCount: 0, totalInventoryCost: 0, totalFees: 0, invByMonth: [], invByVendor: [], feesByMonth: [], hasExpenseData: true, hasFeeData: true };
    const emptyMetrics = { ...metrics, revenue: 0, totalOrders: 0, ebayFees: 0, byMonth: [] };
    for (const tab of ['cogs', 'fees']) {
      const { text } = render(ExpensesPage, expenseStates(tab, { cogs: empty, metrics: emptyMetrics }));
      expect(text).not.toMatch(/40-trip|200 synthetic|NaN|Infinity/);
      expect(text).toContain('—');
    }
  });
  it('retains all strategy records, status filters, search, and read-only insight refresh', () => {
    const { dom, text } = render(TasksPage, [seed.tasks, false, false, { title: '', description: '', status: 'todo', priority: 'medium' }, 'all', '']);
    for (const task of seed.tasks) expect(text).toContain(task.title);
    expect(dom.querySelector('input[aria-label="Search strategies"]')?.hasAttribute('disabled')).toBe(false);
    const filters = dom.querySelectorAll('button').filter(node => !node.hasAttribute('aria-label') && ['all', 'todo', 'in-progress', 'completed'].includes(node.textContent));
    expect(filters).toHaveLength(4);
    expect(filters.every(node => !node.hasAttribute('disabled'))).toBe(true);
    expect(dom.querySelectorAll('button[aria-label^="Delete "]')).toHaveLength(6);
    expect(dom.querySelectorAll('button[aria-label^="Delete "]').every(node => node.hasAttribute('disabled'))).toBe(true);
    expect(dom.querySelectorAll('button[aria-label^="Change status"]').every(node => node.hasAttribute('disabled'))).toBe(true);
    expect(dom.querySelector('button[aria-label="Refresh strategy insights"]')?.hasAttribute('disabled')).toBe(false);
    expect(dom.querySelector('[aria-disabled="true"]')?.textContent).toContain(suggestions[0].title);
    const filtered = render(TasksPage, [seed.tasks, false, false, {}, 'completed', 'September']);
    expect(filtered.text).toContain('Reconcile September settlement');
    expect(filtered.text).not.toContain('Restock popular Toyota parts');
  });
  it('retains all seven upload report selectors and disabled file/import controls', () => {
    const { dom, text } = render(UploadPage);
    expect(dom.querySelectorAll('button')).toHaveLength(8);
    expect(dom.querySelectorAll('button').slice(0, 7).every(node => !node.hasAttribute('disabled'))).toBe(true);
    for (const title of ['Paid & Shipped', 'Active Inventory', 'Traffic & Search', 'Transactions', 'Promoted Listings', 'Inventory Expenses', 'eBay Fees']) expect(text).toContain(title);
    expect(dom.querySelector('input[type="file"]')?.hasAttribute('disabled')).toBe(true);
    expect(dom.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    expect(text).toContain('No Files Uploaded');
  });
  it('populates all original import-history cards and rows without requesting the blocked uploads API', async () => {
    const { tree, dom, text } = render(DataLibraryPage);
    for (const row of DEMO_UPLOAD_HISTORY) expect(text).toContain(row.filename);
    expect(dom.querySelectorAll('p.text-3xl').map(node => node.textContent)).toEqual(['1', '1', '1', '1', '1']);
    expect(dom.querySelectorAll('button[aria-label^="Remove "]').every(node => node.hasAttribute('disabled'))).toBe(true);
    expect(dom.querySelector('button[aria-label="Refresh import history"]')?.hasAttribute('disabled')).toBe(false);
    expect(text).toContain('Promoted Listings');
    await find(tree, node => node.props['aria-label'] === 'Refresh import history').props.onClick();
    for (const effect of controls.effects) await effect();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves Settings sections and navigation while explaining the synthetic source', () => {
    const { text, dom } = render(SettingsPage);
    for (const title of ['Settings', 'Store and access', 'Northstar Sample Parts', 'Data Source', 'Supported Reports', 'Quick Navigation']) expect(text).toContain(title);
    expect(dom.querySelectorAll('a').map(node => node.getAttribute('href'))).toEqual(['/upload', '/upload', '/data', '/orders', '/inventory', '/traffic']);
    expect(text).toContain('All records are fictional');
    expect(text).not.toMatch(/Connect to eBay|Disconnect|Agent keys|Add person|Sync now/);
  });
  it('renders all six schedule rows and immutable config, including the fixture manual selection', () => {
    const { dom, text } = render(SyncSchedule, [settings, runs, true, null, null, null, {}, {}]);
    expect(dom.querySelectorAll('button')).toHaveLength(6);
    expect(dom.querySelectorAll('button, input, select').every(node => node.hasAttribute('disabled'))).toBe(true);
    expect(dom.querySelectorAll('select option[selected]').map(node => node.textContent)).toEqual(Array(6).fill('manual'));
    expect(text).toContain('Recent runs');
    expect(text).toContain('No live sync has run');
    expect(text).toContain('just now');
  });
  it('anchors snapshot health and log ages to DEMO_AS_OF even when the wall clock changes', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const status = { orders: { state: 'inferred', lastSyncedAt: DEMO_AS_OF, message: null, orderCount: seed.orders.length } };
    const { text } = render(SyncHealth, [status]);
    expect(text).toContain(`Synthetic data as of ${DEMO_DATE}`);
    expect(text).toContain('No live sync has run');
    expect(render(SyncSchedule, [settings, runs, true, null, null, null, {}, {}]).text).toContain('just now');
  });
});

describe('demo write callbacks cannot dispatch a request even if invoked directly', () => {
  it('blocks upload submission and file selection before storing or sending a user file', async () => {
    const file = new File(['fictional'], 'test.csv');
    const { tree } = render(UploadPage, [file, 'sales', false, null]);
    await find(tree, node => node.type === 'form').props.onSubmit(formEvent);
    find(tree, node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [file] } });
    expect(controls.setters[0]).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks data deletion and clearing before confirmation or request', async () => {
    const { tree } = render(DataLibraryPage);
    await button(tree, 'Clear Traffic').props.onClick();
    for (const node of walk(tree).filter(node => node.props['aria-label']?.startsWith('Remove '))) await node.props.onClick();
    expect(confirm).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks task create, delete, status, and suggestion-to-task actions', async () => {
    const { tree } = render(TasksPage, [seed.tasks, false, false, { title: 'New', description: '', status: 'todo', priority: 'medium' }, 'all', '']);
    await button(tree, 'Create Strategy').props.onClick();
    for (const node of walk(tree).filter(node => /^(Delete |Change status)/.test(node.props['aria-label'] ?? '') || node.props['aria-disabled'])) await node.props.onClick();
    expect(controls.setters[2]).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks expense deletion and form submission including enabled-looking synthetic events', async () => {
    const { tree } = render(ExpensesPage, expenseStates('operating'));
    for (const node of walk(tree).filter(node => node.props['aria-label']?.startsWith('Delete expense'))) await node.props.onClick();
    const formNode = find(tree, node => typeof node.type === 'function' && node.type.name === 'AddExpenseForm');
    configure([{ date: DEMO_DATE, category: 'tools', amount: '50', description: 'test', vendor: 'DEMO' }, false, '']);
    const form = (formNode.type as (props: Props) => Element)(formNode.props);
    await form.props.onSubmit(formEvent);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks OAuth, disconnect, order sync, and every schedule mutation callback', async () => {
    for (const connected of [false, true]) {
      controls.swr['/api/ebay/status'] = { connected, environment: 'demo', marketplaceId: 'EBAY_US' };
      const { tree } = render(EbayConnection);
      const action = button(tree, connected ? 'Disconnect' : 'Connect to eBay');
      expect(action.props.disabled).toBe(true); await action.props.onClick();
    }
    const orderSync = render(EbaySync);
    expect(orderSync.dom.querySelectorAll('button').every(node => node.hasAttribute('disabled'))).toBe(true);
    expect(button(orderSync.tree, 'Sync now').props.disabled).toBe(true);
    await button(orderSync.tree, 'Sync now').props.onClick();
    const schedule = render(SyncSchedule, [settings, runs, true, null, null, null, {}, {}]);
    for (const node of walk(schedule.tree)) {
      if (node.type === 'button') await node.props.onClick();
      if (node.props.onChange) await node.props.onChange({ target: { checked: true, value: 'daily' } });
      if (node.props.onBlur) await node.props.onBlur({ target: { value: '30' } });
    }
    expect(confirm).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe('ordinary mode remains usable', () => {
  beforeEach(() => { controls.demo = false; });
  it('shows only figures computed from real data, with a writable form', () => {
    const cogs = render(ExpensesPage, expenseStates('cogs')).text;
    expect(cogs).toContain('Individual acquisitions');
    expect(cogs).not.toMatch(/sample|synthetic|40-trip/i);
    const fees = render(ExpensesPage, expenseStates('fees')).text;
    expect(fees).toContain('From uploaded fee reports');
    expect(fees).not.toMatch(/\(sample\)|synthetic|Fee Rate|Fees \/ /i);
    const { dom, text } = render(ExpensesPage, expenseStates('operating'));
    expect(dom.querySelector('fieldset')?.hasAttribute('disabled')).toBe(false);
    expect(dom.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false);
    expect(text).not.toContain('read-only demo');
  });
  it('keeps ordinary task actions and suggestion additions enabled', () => {
    const { dom } = render(TasksPage, [seed.tasks, false, true, { title: 'New', description: '', status: 'todo', priority: 'medium' }, 'all', '']);
    expect(dom.querySelector('button[type="submit"]')).not.toBeNull();
    expect(dom.querySelectorAll('button[aria-label^="Delete "]').every(node => !node.hasAttribute('disabled'))).toBe(true);
    expect(dom.querySelector('[aria-disabled]')).toBeNull();
  });
  it('keeps ordinary upload, history, OAuth, sync, and configuration controls enabled', async () => {
    expect(render(UploadPage).dom.querySelector('input[type="file"]')?.hasAttribute('disabled')).toBe(false);
    const library = render(DataLibraryPage, [DEMO_UPLOAD_HISTORY, false, null, false]);
    expect(button(library.tree, 'Clear Traffic').props.disabled).toBe(false);
    await find(library.tree, node => node.props['aria-label'] === 'Refresh import history').props.onClick();
    expect(fetch).toHaveBeenCalledWith('/api/uploads', { cache: 'no-store' });
    expect(button(render(EbayConnection).tree, 'Connect to eBay').props.disabled).toBe(false);
    expect(button(render(EbaySync).tree, 'Sync now').props.disabled).toBe(false);
    expect(render(SyncSchedule, [settings, runs, true, null, null, null, {}, {}]).dom.querySelectorAll('input, select, button').every(node => !node.hasAttribute('disabled'))).toBe(true);
  });
  it('retains an ordinary strategy mutation request', async () => {
    const { tree } = render(TasksPage, [seed.tasks, false, false, {}, 'all', '']);
    await find(tree, node => node.props['aria-label']?.startsWith('Delete ')).props.onClick();
    expect(confirm).toHaveBeenCalledWith('Delete this strategy?');
    expect(fetch).toHaveBeenCalledWith(`/api/tasks?id=${seed.tasks[0].id}`, { method: 'DELETE', cache: 'no-store' });
  });
});
