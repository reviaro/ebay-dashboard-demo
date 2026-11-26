'use client';

import { storeFetch } from '@/lib/stores/browser';

import { useState } from 'react';
import useSWR from 'swr';
import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_OPERATION_DISABLED } from '@/lib/demo/operational-presentation';
import {
  Link2, ShieldCheck, AlertTriangle, CheckCircle2, ExternalLink, Loader2, Unplug,
} from 'lucide-react';

interface Status {
  connected: boolean;
  status?: string;
  environment: string;
  marketplaceId: string;
  sellerId?: string | null;
  username?: string | null;
  authorizedAt?: string;
  refreshTokenExpiresAt?: string | null;
  grantedScopes?: string[];
  missingScopes?: string[];
  requestedScopes?: string[];
  readOnly?: boolean;
  error?: string;
  code?: string;
}

const fetcher = (url: string) => storeFetch(url).then((r) => r.json());
const scopeLabel = (uri: string) => uri.split('/').pop() ?? uri;

export default function EbayConnection() {
  const demo = useDemoMode();
  const { data, mutate, isLoading } = useSWR<Status>('/api/ebay/status', fetcher, {
    revalidateOnFocus: false,
  });

  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [redirectInput, setRedirectInput] = useState('');
  const [busy, setBusy] = useState<null | 'start' | 'finish' | 'disconnect'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function post(path: string, body?: unknown) {
    if (demo) throw new Error(DEMO_OPERATION_DISABLED);
    const res = await storeFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  async function handleStart() {
    if (demo) return;
    setBusy('start'); setError(null); setNotice(null);
    try {
      const { url } = await post('/api/ebay/oauth/start');
      setConsentUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  }

  async function handleFinish() {
    if (demo) return;
    setBusy('finish'); setError(null); setNotice(null);
    try {
      await post('/api/ebay/oauth/callback', { redirectUrl: redirectInput });
      setRedirectInput(''); setConsentUrl(null);
      setNotice('Connected. eBay data can now be synchronized.');
      mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  }

  async function handleDisconnect() {
    if (demo) return;
    if (!confirm('Remove the stored eBay token from this dashboard?\n\nThis does NOT revoke access at eBay — do that in your eBay account settings if you want it withdrawn there too.')) return;
    setBusy('disconnect'); setError(null); setNotice(null);
    try {
      const res = await post('/api/ebay/disconnect');
      setNotice(res.note);
      mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  }

  const notConfigured = data?.code === 'not_configured';

  return (
    <section className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Link2 size={15} className="text-blue-400" />
          eBay Connection
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-slate-700 text-slate-300">
            {data?.environment ?? '—'}
          </span>
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-300 flex items-center gap-1">
            <ShieldCheck size={11} /> {data?.readOnly === false ? 'listing writes enabled' : 'read-only'}
          </span>
        </div>
      </div>

      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        Each connection belongs to the selected store. Listing changes require write access in Store Settings and a publisher or administrator role.
      </p>

      {demo && <p className="text-xs text-amber-300 mb-4">Live integrations are disabled in this demo.</p>}
      {!demo && isLoading && <p className="text-sm text-slate-400">Checking connection…</p>}

      {notConfigured && (
        <div className="flex gap-2 text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded-lg p-3">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{data?.error}</span>
        </div>
      )}

      {(demo || !isLoading) && !notConfigured && (
        <>
          <div className="flex items-center gap-2 mb-4">
            {data?.connected ? (
              <>
                <CheckCircle2 size={15} className="text-emerald-400" />
                <span className="text-sm text-white">Connected</span>
                {data.username && <span className="text-xs text-slate-400">as {data.username}</span>}
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-slate-500" />
                <span className="text-sm text-slate-300">Not connected</span>
              </>
            )}
          </div>

          {data?.connected && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4 text-xs">
              <div>
                <dt className="text-slate-500">Marketplace</dt>
                <dd className="text-slate-200">{data.marketplaceId}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Authorized</dt>
                <dd className="text-slate-200">
                  {data.authorizedAt ? new Date(data.authorizedAt).toLocaleDateString() : '—'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Reauthorization needed by</dt>
                <dd className="text-slate-200">
                  {data.refreshTokenExpiresAt
                    ? new Date(data.refreshTokenExpiresAt).toLocaleDateString()
                    : 'unknown'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500 mb-1">Granted scopes</dt>
                <dd className="flex flex-wrap gap-1">
                  {(data.grantedScopes ?? []).map((s) => (
                    <span key={s} className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 text-[10px]">
                      {scopeLabel(s)}
                    </span>
                  ))}
                </dd>
              </div>
              {(data.missingScopes?.length ?? 0) > 0 && (
                <div className="col-span-2 flex gap-2 text-amber-300 bg-amber-950/40 border border-amber-900 rounded-lg p-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span>
                    Missing scopes: {data.missingScopes!.map(scopeLabel).join(', ')}. Reconnect to grant them.
                  </span>
                </div>
              )}
            </dl>
          )}

          {(
            <div className="space-y-3">
              <button
                onClick={handleStart}
                disabled={demo || busy !== null}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {busy === 'start' ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                {data?.connected ? 'Reconnect to eBay' : 'Connect to eBay'}
              </button>

              {!demo && consentUrl && (
                <div className="space-y-2 border-t border-slate-700 pt-3">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    A consent page opened in a new tab. After you approve access, eBay
                    redirects to your registered callback URL. That page will most likely
                    show a &quot;can&apos;t reach this site&quot; or DNS error — that is
                    expected and harmless. What matters is the address bar: copy the whole
                    URL from that tab and paste it below.
                  </p>
                  <a href={consentUrl} target="_blank" rel="noopener noreferrer"
                     className="text-xs text-blue-400 hover:text-blue-300 underline inline-block">
                    Reopen consent page
                  </a>
                  <input
                    type="text"
                    value={redirectInput}
                    onChange={(e) => setRedirectInput(e.target.value)}
                    placeholder="Paste the full redirect URL here"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleFinish}
                    disabled={demo || busy !== null || !redirectInput.trim()}
                    title={demo ? DEMO_OPERATION_DISABLED : undefined}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
                  >
                    {busy === 'finish' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Complete connection
                  </button>
                </div>
              )}
            </div>
          )}

          {data?.connected && (
            <button
              onClick={handleDisconnect}
              disabled={demo || busy !== null}
                title={demo ? DEMO_OPERATION_DISABLED : undefined}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 hover:bg-red-900/60 disabled:opacity-50 text-slate-200 text-sm transition-colors"
            >
              {busy === 'disconnect' ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
              Disconnect
            </button>
          )}
        </>
      )}

      {error && (
        <div className="mt-3 flex gap-2 text-xs text-red-300 bg-red-950/40 border border-red-900 rounded-lg p-3">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mt-3 flex gap-2 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded-lg p-3">
          <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}
    </section>
  );
}
