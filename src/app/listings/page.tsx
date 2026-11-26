'use client';
/* eslint-disable @next/next/no-img-element -- Store-authenticated private photos use direct requests. */

import { useEffect, useState } from 'react';
import { useDemoMode } from '@/components/DemoProvider';
import { useStore } from '@/components/StoreProvider';
import { publishKey, storeFetch, storeJson, storeUrl } from '@/lib/stores/browser';
import { emptyListing, type ListingInput, type Fitment } from '@/lib/ebay/listing/model';

type DraftRow = { id: string; title: string; status: string; version: number; listingId: string | null };
type Validation = { at: string; fees: { name: string; amount: string; currency: string }[]; warnings: string[] };
type Draft = DraftRow & { payload: ListingInput; validation: Validation | null };
type Operation = { id: string; status: string; error: string | null; kind: string };
type Policy = { name: string; paymentPolicyId?: string; returnPolicyId?: string; fulfillmentPolicyId?: string };
const inputClass = 'w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-sm text-slate-100 disabled:opacity-60';
const buttonClass = 'rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-700 disabled:opacity-40';

export default function ListingsPage() {
  const state = useStore()!;
  const demo = useDemoMode();
  const editable = ['editor', 'publisher', 'admin'].includes(state.store.role);
  const publisher = ['publisher', 'admin'].includes(state.store.role);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState<ListingInput>(emptyListing());
  const [operations, setOperations] = useState<Operation[]>([]);
  const [policies, setPolicies] = useState<Record<string, Policy[]>>({});
  const [categories, setCategories] = useState<{ category: { categoryId: string; categoryName: string } }[]>([]);
  const [query, setQuery] = useState('');
  const [connection, setConnection] = useState<{ environment: string; username?: string; connected: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const locked = busy || !editable || ['queued', 'running', 'unknown'].includes(draft?.status ?? '');

  async function refreshList() {
    const { drafts } = await storeJson<{ drafts: DraftRow[] }>('/api/listings');
    setDrafts(drafts);
    return drafts;
  }
  async function open(id: string) {
    const body = await storeJson<{ draft: Draft; operations: Operation[] }>(`/api/listings?id=${id}`);
    setDraft(body.draft); setForm(body.draft.payload); setOperations(body.operations); setDirty(false); setConfirmed(false);
  }
  useEffect(() => {
    void refreshList().then(rows => {
      if (demo && rows[0]) return open(rows[0].id);
    }).catch(e => setMessage(e.message));
    void storeJson<typeof connection>('/api/ebay/status').then(setConnection).catch(() => {});
  }, [demo]);
  useEffect(() => {
    if (!draft || !['queued', 'running'].includes(draft.status)) return;
    const timer = setInterval(() => { void open(draft.id).then(refreshList).catch(e => setMessage(e.message)); }, 3000);
    return () => clearInterval(timer);
  }, [draft?.id, draft?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function change<K extends keyof ListingInput>(key: K, value: ListingInput[K]) { setForm(old => ({ ...old, [key]: value })); setDirty(true); setConfirmed(false); }
  async function action(action: string, extra: Record<string, unknown> = {}) {
    if (demo) return;
    setBusy(true); setMessage('');
    try {
      const result = await storeJson<{ id?: string }>('/api/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id: draft?.id, version: draft?.version, ...extra }) });
      await refreshList();
      await open(result.id || draft!.id);
      setMessage(action === 'save' ? 'Draft saved.' : action === 'publish' ? 'Publishing request queued. You can safely leave this page.' : action === 'refresh' ? 'Loaded the current eBay version.' : action === 'reconcile' ? 'Reconciliation completed. Review the current listing before editing.' : action === 'release' ? 'Resolved. Review the draft before continuing.' : '');
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  async function upload(files: FileList | null) {
    if (demo || !files) return;
    setBusy(true); setMessage('');
    const ids = [...form.assetIds];
    try {
      if (files.length + ids.length + form.pictureUrls.length > 24) throw new Error('A listing can have up to 24 photos.');
      for (const file of Array.from(files)) {
        const response = await storeFetch('/api/listings/assets', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Filename': file.name.replace(/[^\x20-\x7E]/g, '_') }, body: file });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        ids.push(body.asset.id);
      }
    } catch (e) { setMessage((e as Error).message); }
    finally { change('assetIds', ids); setBusy(false); }
  }
  async function metadata(kind: string) {
    if (demo) return;
    setBusy(true); setMessage('');
    try {
      if (kind === 'policies') setPolicies(await storeJson('/api/listings/metadata?kind=policies'));
      else if (kind === 'categories') setCategories((await storeJson<{ categorySuggestions: typeof categories }>(`/api/listings/metadata?kind=categories&q=${encodeURIComponent(query)}`)).categorySuggestions ?? []);
      else {
        const body = await storeJson<{ aspects: { localizedAspectName: string; aspectConstraint: { aspectRequired: boolean } }[] }>(`/api/listings/metadata?kind=aspects&category=${form.categoryId}`);
        const existing = new Set(form.specifics.map(s => s.name.toLowerCase()));
        change('specifics', [...form.specifics, ...body.aspects.filter(a => a.aspectConstraint.aspectRequired && !existing.has(a.localizedAspectName.toLowerCase())).map(a => ({ name: a.localizedAspectName, value: '' }))]);
        setMessage('Required item specifics added. Fill in each value; eBay validation will check category requirements.');
      }
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  const field = (key: keyof ListingInput, label: string, options: { maxLength?: number; type?: string } = {}) => <label className="block text-sm space-y-1" key={key}><span className="text-slate-300">{label}</span><input className={inputClass} disabled={locked} value={String(form[key])} {...options} onChange={e => change(key, key === 'quantity' ? Number(e.target.value) : e.target.value)} /></label>;

  return <div className="text-slate-100 max-w-6xl mx-auto space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Listings · {state.store.name}</h1><p className="text-sm text-slate-400 mt-1">{demo ? 'Sample drafts · Fixed-price used parts' : `${connection?.environment || 'eBay'} · ${connection?.username || 'Seller not verified'} · Fixed-price used parts`}</p></div>{editable && <button disabled={busy || dirty} onClick={() => action('create')} className="rounded-lg bg-blue-600 px-4 py-2 text-sm disabled:opacity-40">New listing</button>}</header>
    {!state.store.writeEnabled && <p className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">{demo ? 'Explore the sample drafts. Saving, eBay validation, publishing, and photo uploads are disabled.' : 'This store has eBay writes disabled. You can prepare drafts; an administrator can enable publishing in Store Settings.'}</p>}
    {message && <p role="status" className="rounded-lg border border-slate-600 bg-slate-800 p-3 text-sm whitespace-pre-wrap">{message}</p>}
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-2"><h2 className="text-sm font-semibold text-slate-400">Drafts and published listings</h2>{drafts.length === 0 && <p className="text-sm text-slate-500">{demo ? 'Loading sample drafts…' : 'Create your first draft to get started.'}</p>}{drafts.map(row => <button key={row.id} disabled={busy || dirty} onClick={() => open(row.id).catch(e => setMessage(e.message))} className={`block w-full text-left rounded-lg border p-3 disabled:opacity-50 ${draft?.id === row.id ? 'border-blue-500 bg-blue-950/30' : 'border-slate-800 bg-slate-900'}`}><span className="block text-sm truncate">{row.title || 'Untitled part'}</span><span className="text-xs text-slate-400">{row.status}{row.listingId ? ` · ${row.listingId}` : ''}</span></button>)}</aside>
      {draft && <div className="space-y-5">
        <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Part details {dirty && <span className="text-xs text-amber-300">· Unsaved changes</span>}</h2>{draft.listingId && <div className="flex gap-3 items-center"><a className="text-sm text-blue-300 underline" href={`https://www.${connection?.environment === 'sandbox' ? 'sandbox.' : ''}ebay.com/itm/${draft.listingId}`} target="_blank" rel="noreferrer">View on eBay</a><button className={buttonClass} disabled={locked || dirty} onClick={() => action('refresh')}>Refresh from eBay</button></div>}</div>
          <p className="text-xs text-slate-400">You can also edit published listings in Seller Hub. Refresh before editing here to pick up those changes.</p>
          {field('title', 'Title', { maxLength: 80 })}
          <div className="grid sm:grid-cols-3 gap-3">{field('sku', 'Your SKU', { maxLength: 50 })}{field('price', 'Price (USD)')}{field('quantity', 'Available quantity', { type: 'number' })}</div>
          <label className="block text-sm space-y-1">Description<textarea rows={7} disabled={locked} className={inputClass} value={form.description} maxLength={20000} onChange={e => change('description', e.target.value)} /></label>
          <div className="grid sm:grid-cols-2 gap-3">{field('conditionId', 'Condition ID (usually 3000 for Used)')}{field('postalCode', 'Item location ZIP code')}</div>
          <label className="block text-sm space-y-1">Condition notes<textarea rows={3} disabled={locked} className={inputClass} value={form.conditionDescription} maxLength={1000} placeholder="Test results, wear, damage, and what is included" onChange={e => change('conditionDescription', e.target.value)} /></label>
        </div>
        <section className="rounded-xl border border-slate-700 p-5 space-y-3"><h2 className="font-semibold">Category and item specifics</h2><div className="flex gap-2"><input className={inputClass} aria-label="Search category" disabled={demo} value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. used alternator" /><button className={buttonClass} disabled={locked || !query} onClick={() => metadata('categories')}>Search</button></div>{categories.map(c => <button key={c.category.categoryId} disabled={locked} className="block text-sm text-blue-300" onClick={() => { change('categoryId', c.category.categoryId); setCategories([]); }}>{c.category.categoryName} · {c.category.categoryId}</button>)}{field('categoryId', 'Category ID')}<button className={buttonClass} disabled={locked || !form.categoryId} onClick={() => metadata('aspects')}>Load required specifics</button>
          <p className="text-xs text-slate-400">For a specific with multiple values, put each value on its own line.</p>{form.specifics.map((s, i) => <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2"><input className={inputClass} aria-label={`Specific ${i + 1} name`} disabled={locked} value={s.name} onChange={e => change('specifics', form.specifics.map((v, j) => j === i ? { ...v, name: e.target.value } : v))} /><textarea rows={2} className={inputClass} aria-label={`${s.name || 'Specific'} value`} disabled={locked} value={s.value} onChange={e => change('specifics', form.specifics.map((v, j) => j === i ? { ...v, value: e.target.value } : v))} /><button className={buttonClass} disabled={locked} aria-label={`Remove ${s.name}`} onClick={() => change('specifics', form.specifics.filter((_, j) => i !== j))}>×</button></div>)}<button className={buttonClass} disabled={locked || form.specifics.length >= 45} onClick={() => change('specifics', [...form.specifics, { name: '', value: '' }])}>Add item specific</button>
        </section>
        <section className="rounded-xl border border-slate-700 p-5 space-y-3"><h2 className="font-semibold">Vehicle compatibility</h2><p className="text-xs text-slate-400">Only include vehicles you have verified this part fits. eBay checks compatibility against the selected category.</p>{form.compatibility.map((v, i) => <div key={i} className="rounded-lg bg-slate-900 p-3 space-y-2"><div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{(['year', 'make', 'model', 'trim', 'engine', 'notes'] as const).map(key => <label key={key} className="text-xs capitalize">{key}<input className={inputClass} disabled={locked} value={v[key]} onChange={e => change('compatibility', form.compatibility.map((row, j) => j === i ? { ...row, [key]: e.target.value } : row))} /></label>)}</div><button className={buttonClass} disabled={locked} onClick={() => change('compatibility', form.compatibility.filter((_, j) => j !== i))}>Remove vehicle</button></div>)}<button className={buttonClass} disabled={locked} onClick={() => change('compatibility', [...form.compatibility, { year: '', make: '', model: '', trim: '', engine: '', notes: '' } as Fitment])}>Add compatible vehicle</button></section>
        <section className="rounded-xl border border-slate-700 p-5 space-y-3"><h2 className="font-semibold">Photos</h2><p className="text-xs text-slate-400">The first photo is the cover. Photos stay with this store and are uploaded to eBay during validation.</p><input aria-label="Upload part photos" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/tiff" disabled={locked} onChange={e => { void upload(e.target.files); e.target.value = ''; }} className="text-sm" /><div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[...form.pictureUrls.map(url => ({ url, remote: true })), ...form.assetIds.map(id => ({ url: storeUrl(`/api/listings/assets?id=${id}`), remote: false }))].map((p, i) => <div key={`${p.url}-${i}`} className="space-y-2">
          <img src={p.url} referrerPolicy="no-referrer" alt={`Part photo ${i + 1}`} className="h-28 w-full object-cover rounded-lg" /><button className={buttonClass} disabled={locked} onClick={() => p.remote ? change('pictureUrls', form.pictureUrls.filter((_, j) => j !== i)) : change('assetIds', form.assetIds.filter((_, j) => j !== i - form.pictureUrls.length))}>Remove</button></div>)}</div></section>
        <section className="rounded-xl border border-slate-700 p-5 space-y-3"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Shipping, payments, and returns</h2><button className={buttonClass} disabled={locked} onClick={() => metadata('policies')}>Load this seller’s policies</button></div><p className="text-xs text-slate-400">Use business policies configured in this seller’s eBay account. You can also enter their IDs.</p>{(['fulfillment', 'payment', 'return'] as const).map(kind => { const key = `${kind}PolicyId` as keyof ListingInput; return <div key={kind}>{field(key, `${kind === 'fulfillment' ? 'Shipping' : kind === 'return' ? 'Return' : 'Payment'} policy ID`)}{policies[kind]?.length > 0 && <select className={`${inputClass} mt-2`} aria-label={`${kind} policies`} disabled={locked} value={String(form[key])} onChange={e => change(key, e.target.value)}><option value="">Choose a policy</option>{policies[kind].map(p => <option key={p[`${kind}PolicyId`]} value={p[`${kind}PolicyId`]}>{p.name}</option>)}</select>}</div>; })}</section>
        <section className="rounded-xl border border-blue-900 bg-blue-950/20 p-5 space-y-4"><h2 className="font-semibold">Review and publish</h2><p className="text-sm">Store: <strong>{state.store.name}</strong> · Seller: <strong>{connection?.username || 'Not connected'}</strong> · {connection?.environment}</p><div className="flex flex-wrap gap-3"><button disabled={locked || !dirty} className={buttonClass} onClick={() => action('save', { payload: form })}>Save draft</button><button disabled={locked || dirty || !publisher || !state.store.writeEnabled} className={buttonClass} onClick={() => action('validate')}>Validate with eBay</button>{dirty && <button className={buttonClass} disabled={busy} onClick={() => open(draft.id)}>Discard unsaved changes</button>}</div>
          {demo && <button type="button" disabled className={buttonClass}>Publish listing</button>}
          {!demo && draft.validation && !dirty && <><div className="text-sm space-y-1"><p>Estimated fees from validation:</p>{draft.validation.fees.length ? draft.validation.fees.map(f => <p key={f.name}>{f.name}: {f.amount} {f.currency}</p>) : <p>No nonzero fees returned. Normal selling fees still apply.</p>}{draft.validation.warnings.map((warning, i) => <p key={i} className="text-amber-200">{warning}</p>)}</div><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed this listing, the seller account, and the fees. {draft.listingId ? 'Apply these changes to the live listing.' : 'Publish this listing on eBay.'}</label><button disabled={locked || !publisher || !state.store.writeEnabled || !confirmed} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm disabled:opacity-40" onClick={() => action('publish', { confirmed: true, key: publishKey() })}>{draft.listingId ? 'Submit revision' : 'Publish listing'}</button></>}
          {operations.map(op => <div key={op.id} className="text-sm border-t border-slate-700 pt-3"><p>{op.kind}: {op.status}</p>{op.error && <p className="text-amber-200 whitespace-pre-wrap">{op.error}</p>}{op.status === 'unknown' && publisher && <><p className="text-slate-400 mt-2">Check Seller Hub before continuing. Reconciliation reads eBay and does not send the listing again.{op.kind === 'revise' ? ' It replaces this draft with the current eBay version.' : ''}</p><button className={`${buttonClass} mt-2`} disabled={busy} onClick={() => action('reconcile', { operationId: op.id })}>{op.kind === 'revise' ? 'Use current eBay version' : 'Reconcile with eBay'}</button>{op.kind === 'create' && <><p className="text-slate-400 mt-3">If Seller Hub shows no listing for this SKU at least 10 minutes after the attempt, release the draft so it can be edited and published again. Nothing is sent to eBay.</p><button className={`${buttonClass} mt-2`} disabled={busy} onClick={() => { if (window.confirm('Confirm: you checked Seller Hub and this listing was NOT created. Releasing a draft whose listing does exist can lead to a duplicate listing.')) void action('release', { operationId: op.id, confirmed: true }); }}>No listing was created — release draft</button></>}</>}</div>)}
        </section>
      </div>}
    </div>
  </div>;
}
