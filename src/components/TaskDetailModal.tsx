'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, FileText, CheckCircle2, Clock, Calendar } from 'lucide-react';

export interface TaskDetail {
  id: number;
  title: string;
  description: string | null;
  report: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// Reports are untrusted. Only explicit HTTP(S) citations may navigate away;
// opening a report must never fetch an agent-supplied resource.
function reportUrl(url: string, key: string): string {
  if (key !== 'href' || !/^https?:\/\//i.test(url)) return '';
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

// These map markdown nodes onto Tailwind classes — the project has no
// typography plugin. Images stay readable as text without an image element
// (including React's automatic resource preload). Raw HTML is skipped below.
const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-black text-gray-900 dark:text-white mt-8 mb-4 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-black text-gray-900 dark:text-white mt-8 mb-3 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-black text-gray-900 dark:text-white mt-6 mb-2 first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="text-base font-black text-gray-900 dark:text-white mt-4 mb-2">{children}</h4>,
  p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-3 ml-6 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 ml-6 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  a: ({ href, children }) => href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-blue-600 dark:text-blue-400 font-bold underline underline-offset-2 break-words">
      {children}
    </a>
  ) : <span>{children}</span>,
  img: ({ alt }) => (
    <span className="italic text-gray-500 dark:text-gray-400">
      {alt ? `[Image omitted: ${alt}]` : '[Image omitted]'}
    </span>
  ),
  strong: ({ children }) => <strong className="font-black text-gray-900 dark:text-white">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-blue-200 dark:border-blue-800 pl-4 italic text-gray-500 dark:text-gray-400">{children}</blockquote>
  ),
  hr: () => <hr className="my-6 border-gray-100 dark:border-gray-700" />,
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-2xl bg-gray-50 dark:bg-gray-900 p-4 text-xs leading-relaxed">{children}</pre>
  ),
  code: ({ className, children }) => (
    <code className={`${className ?? ''} rounded-md bg-gray-100 dark:bg-gray-900 px-1.5 py-0.5 font-mono text-[0.85em] [pre_&]:bg-transparent [pre_&]:p-0`}>{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-2xl border border-gray-100 dark:border-gray-700">
      <table className="w-full text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-50 dark:bg-gray-900">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 font-black uppercase tracking-wider text-[10px] text-gray-500">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 align-top">{children}</td>,
};

export function ReportMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown skipHtml urlTransform={reportUrl} remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {children}
    </ReactMarkdown>
  );
}

export default function TaskDetailModal({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const hasReport = !!task.report?.trim();

  // Portalled to <body> so no transformed ancestor (the page's animate-in
  // wrapper) can become the containing block for `fixed`.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 md:p-8 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        // Height-capped to the viewport so the card stays centered; only the body
        // below the header scrolls. (Centering an overflowing box in a flex
        // overlay pushes its top above the viewport, where it can't be scrolled to.)
        className="relative flex flex-col w-full max-w-3xl max-h-full overflow-hidden bg-white dark:bg-gray-800 rounded-[3rem] border border-gray-100 dark:border-gray-700 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 p-8 md:p-10 border-b border-gray-50 dark:border-gray-700">
          <div className="flex justify-between items-start gap-4 mb-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 ${
                task.priority === 'high' ? 'bg-red-50 text-red-600 border-red-100' :
                task.priority === 'medium' ? 'bg-yellow-50 text-yellow-600 border-yellow-100' : 'bg-blue-50 text-blue-600 border-blue-100'
              }`}>
                {task.priority}
              </span>
              <span className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                task.status === 'completed' ? 'bg-green-600 text-white' :
                task.status === 'in-progress' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
              }`}>
                {task.status === 'completed' ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                {task.status.replace('-', ' ')}
              </span>
            </div>
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close"
              className="p-3 -m-3 rounded-2xl text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <X size={22} />
            </button>
          </div>
          <h2 id="task-detail-title" className="text-3xl font-black text-gray-900 dark:text-white leading-tight tracking-tight">
            {task.title}
          </h2>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
            <span>Created {new Date(task.createdAt).toLocaleDateString()}</span>
            {task.updatedAt !== task.createdAt && <span>Updated {new Date(task.updatedAt).toLocaleString()}</span>}
            {task.dueDate && (
              <span className="flex items-center gap-1.5"><Calendar size={12} />Due {new Date(task.dueDate).toLocaleDateString()}</span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-8 md:p-10">
          {task.description && (
            <p className="mb-8 pb-8 border-b border-gray-50 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 font-medium leading-relaxed whitespace-pre-wrap break-words">
              {task.description}
            </p>
          )}
          <h3 className="flex items-center gap-3 text-xs font-black uppercase tracking-widest text-gray-400 mb-6">
            <FileText size={16} />
            Report
          </h3>
          {hasReport ? (
            <div className="text-sm text-gray-700 dark:text-gray-300 break-words">
              <ReportMarkdown>{task.report!}</ReportMarkdown>
            </div>
          ) : (
            <p className="text-sm text-gray-400 font-medium">
              No report attached. The agent can attach one by sending a <code className="font-mono text-xs">report</code> field
              (markdown) to <code className="font-mono text-xs">/api/agent/tasks</code>.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
