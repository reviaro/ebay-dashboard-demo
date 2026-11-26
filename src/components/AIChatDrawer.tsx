'use client';

import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_DATE, DEMO_QUESTIONS } from '@/lib/demo/config';

import { storeFetch } from '@/lib/stores/browser';

import { useState, useRef, useEffect } from 'react';
import { Send, X, Bot, User, Loader2, Zap } from 'lucide-react';
import type { AIProvider, AIProviderSettings } from '@/lib/ai/types';

function renderMarkdown(text: string) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-slate-600/50 my-2" />);
      i++;
      continue;
    }

    // H2
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-sm font-bold text-slate-100 mt-3 mb-1">
          {inlineMarkdown(line.slice(3))}
        </h2>
      );
      i++;
      continue;
    }

    // H3
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-xs font-semibold text-slate-300 uppercase tracking-wide mt-2 mb-1">
          {inlineMarkdown(line.slice(4))}
        </h3>
      );
      i++;
      continue;
    }

    // Bullet list block
    if (/^[-*] /.test(line)) {
      const startKey = i;
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={startKey} className="space-y-0.5 my-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm text-slate-300">
              <span className="text-violet-400 mt-0.5 flex-shrink-0">•</span>
              <span>{inlineMarkdown(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list block
    if (/^\d+\. /.test(line)) {
      const startKey = i;
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ''));
        i++;
      }
      elements.push(
        <ol key={startKey} className="space-y-0.5 my-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm text-slate-300">
              <span className="text-violet-400 font-mono text-xs mt-0.5 flex-shrink-0 w-4">{j + 1}.</span>
              <span>{inlineMarkdown(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line — small gap
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-1" />);
      i++;
      continue;
    }

    // Normal paragraph line
    elements.push(
      <p key={i} className="text-sm text-slate-300 leading-relaxed">
        {inlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function inlineMarkdown(text: string): React.ReactNode {
  // Handle **bold**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-slate-100">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function AIChatDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const demo = useDemoMode();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: demo
      ? `Explore five cached answers calculated from fictional store data as of ${DEMO_DATE}. Live AI and store changes are off in this read-only demo.`
      : "Hello! I'm your eBay Auto Parts Specialist. How can I help you with your store today?" }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [settings, setSettings] = useState<AIProviderSettings | null>(null);
  const [provider, setProvider] = useState<AIProvider | ''>('');
  const [settingsError, setSettingsError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || demo) return;
    const controller = new AbortController();
    setSettingsError('');
    storeFetch('/api/chat', { signal: controller.signal, cache: 'no-store' })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || 'Unable to load AI providers.');
        return data as AIProviderSettings;
      })
      .then(data => {
        setSettings(data);
        setProvider(current => current || data.defaultProvider);
      })
      .catch(error => {
        if (!controller.signal.aborted) setSettingsError(error.message || 'Unable to load AI providers.');
      });
    return () => controller.abort();
  }, [isOpen, demo]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const canSend = demo || Boolean(provider && !settingsError && settings?.providers.find(p => p.id === provider)?.configured);

  const sendQuestion = async (question: string) => {
    if (!question.trim() || isLoading || !canSend) return;
    const userMsg: Message = { role: 'user', content: question };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await storeFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(demo ? { question: question.trim() } : { messages: [...messages, userMsg], provider }),
      });
      const data = await res.json();
      if (res.ok && data.content) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);
      } else {
        const errMsg = demo ? 'The cached sample answer could not be loaded. Please try again.' : data.detail ? `Error: ${data.detail}` : "Sorry, I'm having trouble connecting right now. Please try again.";
        setMessages(prev => [...prev, { role: 'assistant', content: errMsg }]);
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'assistant', content: demo ? 'The cached sample answer could not be loaded. Please try again.' : "Sorry, I'm having trouble connecting to the brain right now." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendQuestion(input);
  };

  if (!isOpen) return null;

  return (
    <div className="w-full bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-top-4 fade-in duration-300" style={{ height: '560px' }}>
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-700/60 flex justify-between items-center flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/15 rounded-lg">
            <Bot size={15} className="text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100 leading-tight">AI Strategy Partner</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">{demo ? 'Cached sample answers' : 'Store strategy & sourcing'}</span>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      {!demo && <div className="px-5 py-2.5 border-b border-slate-700/60 flex-shrink-0 space-y-1.5">
        <div className="flex items-center gap-3">
          <label htmlFor="ai-provider" className="text-xs text-slate-400">Provider</label>
          <select
            id="ai-provider"
            value={provider}
            onChange={e => setProvider(e.target.value as AIProvider)}
            disabled={isLoading || !settings}
            className="min-w-0 flex-1 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
          >
            {!settings && <option value="">Loading providers...</option>}
            {settings?.providers.map(option => (
              <option key={option.id} value={option.id} disabled={!option.configured}>
                {option.label} — {option.configured ? option.model : 'API key required'}
              </option>
            ))}
          </select>
        </div>
        {settingsError ? (
          <p role="alert" className="text-xs text-amber-300">{settingsError} Close and reopen chat to retry.</p>
        ) : settings && !settings.providers.find(p => p.id === provider)?.configured ? (
          <p role="status" className="text-xs text-amber-300">Choose a configured provider, or add its API key to .env.local and restart the app.</p>
        ) : null}
      </div>}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-slate-950/40">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
              m.role === 'user'
                ? 'bg-blue-600/20 text-blue-400'
                : 'bg-violet-600/20 text-violet-400'
            }`}>
              {m.role === 'user' ? <User size={13} /> : <Zap size={13} />}
            </div>
            <div className={`max-w-[75%] px-4 py-3 rounded-xl text-sm leading-relaxed ${
              m.role === 'user'
                ? 'bg-blue-600 text-white rounded-tr-sm'
                : 'bg-slate-800 border border-slate-700/60 rounded-tl-sm'
            }`}>
              {m.role === 'assistant' ? renderMarkdown(m.content) : m.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-2.5 flex-row">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 bg-violet-600/20 text-violet-400">
              <Zap size={13} />
            </div>
            <div className="bg-slate-800 border border-slate-700/60 px-4 py-3 rounded-xl rounded-tl-sm flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 className="animate-spin flex-shrink-0" size={14} />
              <span>{demo ? 'Loading cached answer...' : 'Analyzing market data...'}</span>
            </div>
          </div>
        )}
        {demo && (
          <div className="space-y-2" aria-label="Sample questions">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Explore the fictional store</p>
            {DEMO_QUESTIONS.map(question => (
              <button
                key={question}
                type="button"
                onClick={() => void sendQuestion(question)}
                disabled={isLoading}
                className="block w-full text-left px-3 py-2 bg-slate-800 border border-slate-700/60 rounded-lg text-xs text-blue-300 hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {question}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-5 py-4 border-t border-slate-700/60 flex-shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={demo ? "Choose a sample question or type it here" : "Ask about sourcing, pricing, or listings..."}
            className="min-w-0 flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-colors"
            autoFocus
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim() || !canSend}
            aria-label="Send message"
            className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex-shrink-0"
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}
