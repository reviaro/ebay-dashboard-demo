'use client';

import { storeFetch } from '@/lib/stores/browser';

import { useState, useEffect, useCallback } from 'react';
import { Activity, AlertTriangle, Search, MessageSquare } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { timeAgo } from '@/lib/relative-time';
import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_AS_OF, DEMO_DATE } from '@/lib/demo/config';

const VALID_TAGS = [
  'needs better title',
  'lower price',
  'bad photos',
  'seasonal',
  'restock',
  'good performer',
] as const;

/** eBay serves two years of traffic, and no more. */
const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: 730, label: '2 years' },
] as const;

type Totals = {
  title?: string | null;
  impressions: number;
  views: number;
  ctr: number;
  transactions: number;
  conversionRate: number;
};

type ListingRow = Totals & {
  listingId: string;
  title: string | null;
  noteCount: number;
};

type DailyRecord = {
  date: string;
  impressions: number;
  views: number;
  ctr: number;
};

type SyncInfo = {
  state: 'never' | 'inferred' | 'ok' | 'stale' | 'failed' | 'running' | 'stalled';
  lastSyncedAt: string | null;
  message: string | null;
  earliestSyncedDate: string | null;
  windowExceedsData: boolean;
  truncatedDays: number;
};

type DetailData = {
  listingId: string;
  totals: Totals;
  daily: DailyRecord[];
};

type Note = {
  id: number;
  listingId: string;
  tags: string[];
  note: string | null;
  createdAt: string;
};

function ctrColor(ctr: number) {
  if (ctr >= 5) return 'text-emerald-400';
  if (ctr >= 2) return 'text-yellow-400';
  return 'text-red-400';
}

function fmt(n: number) { return n.toLocaleString(); }
function fmtPct(n: number) { return `${n.toFixed(2)}%`; }

/**
 * How current the traffic is, in one line.
 *
 * The whole domain fails plausibly: a page built on a week-old sync, or on a
 * marketplace filter that returns zero, looks exactly like a quiet week.
 */
function Freshness({ sync, demo }: { sync: SyncInfo; demo: boolean }) {
  const bad = sync.state === 'failed' || sync.state === 'stalled';
  const warn = sync.state === 'stale' || sync.state === 'never';

  const headline = (() => {
    if (demo) return `Synthetic snapshot · ${DEMO_DATE} UTC${sync.lastSyncedAt ? ` · recorded ${timeAgo(sync.lastSyncedAt, new Date(DEMO_AS_OF))}` : ''}`;
    switch (sync.state) {
      case 'failed': return 'The last traffic sync failed';
      case 'stalled': return 'A traffic sync started and never finished';
      case 'never': return 'Traffic has never been synced from eBay';
      case 'running': return 'A traffic sync is running now';
      case 'stale': return `Last synced ${timeAgo(sync.lastSyncedAt)}`;
      default: return `Synced ${timeAgo(sync.lastSyncedAt)}`;
    }
  })();

  return (
    <p className={`text-xs ${bad ? 'text-rose-400' : warn ? 'text-amber-400' : 'text-slate-500'}`}>
      {headline}
      {sync.message && <span className="text-slate-600"> · {sync.message}</span>}
    </p>
  );
}

export default function TrafficPage() {
  const demo = useDemoMode();
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [daily, setDaily] = useState<DailyRecord[]>([]);
  const [sync, setSync] = useState<SyncInfo | null>(null);
  const [total, setTotal] = useState(0);
  const [days, setDays] = useState<number>(30);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteTags, setNoteTags] = useState<string[]>([]);
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200', days: String(days) });
      if (search) params.set('search', search);
      const res = await storeFetch(`/api/traffic?${params}`);
      const json = await res.json() as {
        listings: ListingRow[]; total: number; daily: DailyRecord[]; sync: SyncInfo;
      };
      setListings(json.listings ?? []);
      setTotal(json.total ?? 0);
      setDaily(json.daily ?? []);
      setSync(json.sync ?? null);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [search, days]);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const [detailRes, notesRes] = await Promise.all([
        storeFetch(`/api/traffic/${encodeURIComponent(id)}`),
        storeFetch(`/api/traffic/notes?listingId=${encodeURIComponent(id)}`),
      ]);
      const detailJson = await detailRes.json() as DetailData;
      const notesJson = await notesRes.json() as { notes: Note[] };
      setDetail(detailJson);
      setNotes(notesJson.notes ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void fetchListings(); }, [fetchListings]);

  useEffect(() => {
    if (selected) void fetchDetail(selected);
    else { setDetail(null); setNotes([]); }
  }, [selected, fetchDetail]);

  async function saveNote() {
    if (demo) return;
    if (!selected) return;
    if (noteTags.length === 0 && !noteText.trim()) return;
    setSaving(true);
    try {
      const res = await storeFetch('/api/traffic/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: selected, tags: noteTags, note: noteText.trim() || null }),
      });
      if (res.ok) {
        setNoteTags([]);
        setNoteText('');
        await fetchDetail(selected);
        await fetchListings();
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleTag(tag: string) {
    if (demo) return;
    setNoteTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  const selectedListing = listings.find((l) => l.listingId === selected);

  const chart = (data: DailyRecord[], title: string) => (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 mb-5">
      <h3 className="text-xs font-medium text-slate-400 mb-3">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: '#94a3b8' }} />
          <Line type="monotone" dataKey="impressions" name="Impressions" stroke="#3b82f6" dot={false} />
          <Line type="monotone" dataKey="views" name="Views" stroke="#a78bfa" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <Activity size={20} className="text-blue-400" />
          <div>
            <h1 className="text-lg font-semibold text-white">Traffic &amp; Metrics</h1>
            {sync ? <Freshness sync={sync} demo={demo} /> : <p className="text-xs text-slate-500">{total} listings</p>}
          </div>
        </div>

        <div className="flex flex-wrap md:flex-nowrap items-center gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              className={`rounded-lg px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                days === w.days
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/*
        An empty chart and an un-synced window look identical, and this domain
        produces that confusion more than any other -- so say which it is.
      */}
      {sync?.windowExceedsData && (
        <div className="flex items-center gap-2 border-b border-slate-700 bg-slate-800/60 px-6 py-2 text-xs text-slate-400">
          <AlertTriangle size={13} className="text-slate-500" />
          {demo
            ? `The synthetic snapshot starts on ${sync.earliestSyncedDate ?? DEMO_DATE}. Earlier days in this window have no sample records; live backfills are disabled.`
            : sync.earliestSyncedDate
            ? `Traffic is synced from ${sync.earliestSyncedDate}. Earlier days in this window have not been fetched yet — run a backfill to fill them in.`
            : 'No traffic has been synced from eBay yet. It runs daily once enabled on Settings.'}
        </div>
      )}

      {/*
        eBay stops a per-listing report at 200 rows and offers no way to ask for
        the rest, so a day at the cap is a real gap rather than a quiet one.
      */}
      {sync && sync.truncatedDays > 0 && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-6 py-2 text-xs text-amber-300">
          <AlertTriangle size={13} />
          {sync.truncatedDays} day(s) in this window hit eBay&apos;s 200-listing cap, so the
          quietest listings on those days are missing from the per-listing table.
        </div>
      )}

      {/* Body: master/detail */}
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Left: listing list */}
        <div className="w-full max-h-80 flex-shrink-0 border-b border-slate-800 flex flex-col lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
          <div className="p-3 border-b border-slate-800">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search listings…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="text-center text-slate-500 text-xs py-8">Loading…</p>
            ) : listings.length === 0 ? (
              <p className="text-center text-slate-500 text-xs py-8">
                {demo ? 'No sample traffic matches this window or search. Try a wider window or another listing.' : 'No traffic in this window. Widen it, or check the sync on Settings.'}
              </p>
            ) : (
              listings.map((l) => {
                const isActive = selected === l.listingId;
                return (
                  <button
                    key={l.listingId}
                    onClick={() => setSelected(l.listingId)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-800/60 transition-colors cursor-pointer ${
                      isActive ? 'bg-slate-800' : 'hover:bg-slate-800/50'
                    }`}
                  >
                    <p className={`text-xs font-medium truncate mb-1 ${isActive ? 'text-white' : 'text-slate-300'}`}>
                      {l.title ?? l.listingId}
                    </p>
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className="text-slate-500">{fmt(l.impressions)} impr</span>
                      <span className={ctrColor(l.ctr)}>{fmtPct(l.ctr)} CTR</span>
                      <span className="text-purple-400">{fmt(l.views)} views</span>
                      {l.noteCount > 0 && (
                        <span className="flex items-center gap-0.5 text-blue-400">
                          <MessageSquare size={9} />{l.noteCount}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            daily.length >= 2 ? (
              <div>
                <div className="mb-5">
                  <h2 className="text-base font-semibold text-white mb-0.5">Store traffic</h2>
                  <p className="text-xs text-slate-500">
                    Every listing, including any the per-listing report leaves out.
                  </p>
                </div>
                {chart(daily, 'Daily impressions and views')}
                <p className="text-xs text-slate-600">Select a listing on the left for its own history.</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-600">
                <Activity size={40} className="mb-3 opacity-30" />
                <p className="text-sm">Select a listing to view details</p>
              </div>
            )
          ) : (
            <div>
              {/* Listing title + ID */}
              <div className="mb-5">
                <h2 className="text-base font-semibold text-white mb-0.5">
                  {selectedListing?.title ?? detail?.totals.title ?? selected}
                </h2>
                <p className="text-xs text-slate-500 font-mono">{selected}</p>
              </div>

              {/* Stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                {[
                  { label: 'Impressions', value: fmt(detail?.totals.impressions ?? 0), color: 'text-blue-400' },
                  { label: 'Views', value: fmt(detail?.totals.views ?? 0), color: 'text-white' },
                  { label: 'CTR', value: fmtPct(detail?.totals.ctr ?? 0), color: ctrColor(detail?.totals.ctr ?? 0) },
                  { label: 'Conversion', value: fmtPct(detail?.totals.conversionRate ?? 0), color: 'text-purple-400' },
                ].map((card) => (
                  <div key={card.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                    <p className="text-xs text-slate-400 mb-1">{card.label}</p>
                    <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
                  </div>
                ))}
              </div>

              {/* Trend chart */}
              {(detail?.daily.length ?? 0) >= 2 && chart(detail!.daily, 'Daily trend')}

              {/* Notes section */}
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
                <h3 className="text-sm font-semibold text-white mb-4">Notes</h3>

                {demo && <p id="traffic-demo-readonly" className="text-xs text-amber-300 mb-4">Synthetic notes are available to read. Adding or changing notes is disabled in this read-only demo.</p>}

                {/* Add note form */}
                <div className="mb-5 pb-5 border-b border-slate-700">
                  <p className="text-xs text-slate-400 mb-2">Tags</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {VALID_TAGS.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        disabled={demo}
                        aria-describedby={demo ? 'traffic-demo-readonly' : undefined}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                          noteTags.includes(tag)
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-700 text-slate-400 hover:text-white border border-slate-600'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <textarea
                    disabled={demo}
                    aria-describedby={demo ? 'traffic-demo-readonly' : undefined}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Optional note…"
                    rows={2}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none mb-2"
                  />
                  <button
                    onClick={() => void saveNote()}
                    disabled={demo || saving || (noteTags.length === 0 && !noteText.trim())}
                    aria-describedby={demo ? 'traffic-demo-readonly' : undefined}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    {saving ? 'Saving…' : 'Save Note'}
                  </button>
                </div>

                {/* Notes log */}
                {notes.length === 0 ? (
                  <p className="text-xs text-slate-600">No notes yet.</p>
                ) : (
                  <div className="space-y-3">
                    {notes.map((n) => (
                      <div key={n.id} className="bg-slate-900 rounded-lg p-3">
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {n.tags.map((tag) => (
                            <span key={tag} className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full text-[10px] font-medium">
                              {tag}
                            </span>
                          ))}
                        </div>
                        {n.note && <p className="text-xs text-slate-300 mb-1">{n.note}</p>}
                        <p className="text-[10px] text-slate-600">
                          {demo ? `${new Date(n.createdAt).toLocaleString('en-US', { timeZone: 'UTC' })} UTC` : new Date(n.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
