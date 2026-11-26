'use client';

import { Settings, Upload, Database, BarChart2, ShoppingBag, TrendingUp } from 'lucide-react';
import Link from '@/components/StoreLink';
import StoreSettings from '@/components/StoreSettings';
import { useStore } from '@/components/StoreProvider';
import EbayConnection from '@/components/EbayConnection';
import EbaySync from '@/components/EbaySync';
import SyncHealth from '@/components/SyncHealth';
import SyncSchedule from '@/components/SyncSchedule';
import { useDemoMode } from '@/components/DemoProvider';

const LINKS = [
  { href: '/upload', icon: Upload, label: 'Data Intake', desc: 'Import eBay reports and cost data' },
  { href: '/data', icon: Database, label: 'Data Library', desc: 'View import history and clear traffic snapshots' },
  { href: '/orders', icon: ShoppingBag, label: 'Orders & Sales', desc: 'Browse and filter your sales history' },
  { href: '/inventory', icon: BarChart2, label: 'Inventory', desc: 'Active listings with engagement metrics' },
  { href: '/traffic', icon: TrendingUp, label: 'Traffic', desc: 'Listing impressions, views, and CTR' },
];

export default function SettingsPage() {
  const state = useStore();
  const demo = useDemoMode();
  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <Settings size={22} className="text-blue-400" />
        <h1 className="text-xl font-semibold text-white">Settings</h1>
      </div>

      {demo ? <section className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-5">
        <h2 className="text-sm font-semibold text-white">Store and access</h2>
        <p className="mt-2 text-sm text-slate-400">{state?.store.name} · Viewer access</p>
      </section> : <StoreSettings />}
      <SyncHealth />
      {state?.store.role === 'admin' && <><EbayConnection /><EbaySync /><SyncSchedule /></>}

      {/* Data source info */}
      <section className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-5">
        <h2 className="text-sm font-semibold text-white mb-2">Data Source</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          {demo ? 'All records are fictional and belong to a fixed synthetic snapshot. Imports and live integrations are disabled. Explore the supported reports in ' : 'Manually uploaded Seller Hub exports remain the historical record and the fallback whenever the API cannot reach back far enough. Upload reports from '}
          <Link href="/upload" className="text-blue-400 hover:text-blue-300 underline">Data Intake</Link>.
        </p>
      </section>

      {/* CSV types */}
      <section className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-5">
        <h2 className="text-sm font-semibold text-white mb-3">Supported Reports</h2>
        <div className="space-y-3">
          {[
            { type: 'Sales', source: 'Seller Hub → Orders → Paid & Shipped', fields: 'Sale Date, Item Title, Sold For, Shipping, Tax' },
            { type: 'Active Listings', source: 'Seller Hub → Listings → Active', fields: 'Item number, Title, Price, Watchers, Quantity' },
            { type: 'Traffic', source: 'Seller Hub → Marketing → Traffic report', fields: 'Listing ID, Impressions, Page views, CTR' },
            { type: 'Transactions', source: 'Seller Hub → Payments → Reports', fields: 'Type, amount, fees, net amount' },
            { type: 'Promoted Listings', source: 'Seller Hub → Advertising dashboard', fields: 'Campaign, impressions, clicks, sales, ad fees' },
            { type: 'Costs & fees', source: 'Your inventory-cost or fee export', fields: 'CSV/XLSX or supported PDF statements' },
          ].map((r) => (
            <div key={r.type} className="flex gap-3">
              <span className="text-xs font-semibold text-blue-400 w-28 shrink-0 pt-0.5">{r.type}</span>
              <div>
                <p className="text-xs text-slate-300">{r.source}</p>
                <p className="text-xs text-slate-500 mt-0.5">{r.fields}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Quick nav */}
      <section className="bg-slate-800 rounded-xl border border-slate-700 p-5">
        <h2 className="text-sm font-semibold text-white mb-3">Quick Navigation</h2>
        <div className="space-y-2">
          {LINKS.map(({ href, icon: Icon, label, desc }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-700/50 transition-colors group"
            >
              <Icon size={16} className="text-blue-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-white group-hover:text-blue-300 transition-colors">{label}</p>
                <p className="text-xs text-slate-500">{desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
