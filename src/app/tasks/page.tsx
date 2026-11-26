'use client';

import { useDemoMode } from '@/components/DemoProvider';
import { DEMO_OPERATION_DISABLED } from '@/lib/demo/operational-presentation';

import { storeFetch } from '@/lib/stores/browser';

import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { Plus, Trash2, CheckCircle2, AlertCircle, Clock, Search, Sparkles, RefreshCw, FileText } from 'lucide-react';
import TaskDetailModal from '@/components/TaskDetailModal';

interface Task {
  id: number;
  title: string;
  description: string | null;
  report: string | null;
  status: string;
  priority: string;
  phase: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

const fetcher = (url: string) => storeFetch(url).then(res => res.json());

export default function TasksPage() {
  const demo = useDemoMode();
  const [tasks, setTasks] = useState<Task[]>([]);
  const { data: suggestions, mutate: refreshSuggestions, isValidating: isSuggesting } = useSWR(
    '/api/tasks/suggest',
    fetcher,
    { revalidateOnMount: demo, revalidateOnFocus: false, revalidateOnReconnect: false }
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium', status: 'todo' });
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  // Looked up by id so the modal reflects refetched data (e.g. a status toggle).
  const openTask = tasks.find(t => t.id === openTaskId) ?? null;

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await storeFetch('/api/tasks');
      const data = await res.json();
      setTasks(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const submitNewTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (demo || !newTask.title.trim()) return;
    try {
      const res = await storeFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTask),
      });
      if (res.ok) {
        setIsAdding(false);
        setNewTask({ title: '', description: '', priority: 'medium', status: 'todo' });
        fetchTasks();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const addTaskFromSuggestion = async (title: string, description: string) => {
    if (demo || !title.trim()) return;
    try {
      const res = await storeFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, priority: 'medium', status: 'todo' }),
      });
      if (res.ok) fetchTasks();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleStatus = async (task: Task) => {
    if (demo) return;
    const statusCycle: Record<string, string> = { 'todo': 'in-progress', 'in-progress': 'completed', 'completed': 'todo' };
    const newStatus = statusCycle[task.status] || 'todo';
    try {
      await storeFetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, status: newStatus }),
      });
      fetchTasks();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteTask = async (id: number) => {
    if (demo) return;
    if (!confirm('Delete this strategy?')) return;
    try {
      await storeFetch(`/api/tasks?id=${id}`, { method: 'DELETE' });
      fetchTasks();
    } catch (err) {
      console.error(err);
    }
  };

  const closeTask = useCallback(() => setOpenTaskId(null), []);

  const filteredTasks = tasks.filter(t => {
    const matchesFilter = filter === 'all' || t.status === filter;
    return matchesFilter && t.title.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-5xl font-black text-gray-900 dark:text-white tracking-tighter">Strategy Matrix</h1>
          <p className="text-gray-500 font-bold mt-1 uppercase tracking-widest text-xs">Phase 2: Sourcing Intelligence & Analytics</p>
        </div>
        <button 
          onClick={() => { if (!demo) setIsAdding(true); }}
          disabled={demo}
          title={demo ? DEMO_OPERATION_DISABLED : undefined}
          className="flex items-center gap-3 px-8 py-5 bg-blue-600 text-white font-black rounded-3xl shadow-2xl shadow-blue-200 hover:bg-blue-700 hover:shadow-blue-300 transition-all active:scale-95"
        >
          <Plus size={24} />
          Create Strategy
        </button>
      </div>

      {demo && <p className="text-sm text-gray-500 dark:text-gray-400">Browse and filter the synthetic strategies and insights. Creating, changing, and deleting strategies are disabled.</p>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Left Column: Tasks */}
        <div className="lg:col-span-8 space-y-8">
          <div className="flex flex-wrap flex-col md:flex-row gap-4 bg-white dark:bg-gray-800 p-4 rounded-[2.5rem] border border-gray-100 dark:border-gray-700 shadow-sm">
            <div className="relative flex-1 min-w-0 md:basis-48">
              <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                aria-label="Search strategies"
                type="text"
                placeholder="Search strategies..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-14 pr-6 py-4 bg-gray-50 dark:bg-gray-700 dark:text-white border-none rounded-[1.5rem] focus:ring-2 focus:ring-blue-500 font-bold text-sm"
              />
            </div>
            <div className="flex flex-wrap max-w-full gap-2 p-1 bg-gray-50 dark:bg-gray-700 rounded-[1.5rem]">
              {['all', 'todo', 'in-progress', 'completed'].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    filter === f ? 'bg-white dark:bg-gray-600 text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {!demo && isAdding && (
              <form onSubmit={submitNewTask} className="bg-white dark:bg-gray-800 p-8 rounded-[3rem] border-4 border-blue-600 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
                <input
                  autoFocus
                  type="text"
                  placeholder="Strategy Title"
                  className="w-full p-4 bg-gray-50 dark:bg-gray-700 dark:text-white rounded-2xl border-none focus:ring-2 focus:ring-blue-500 font-black text-lg"
                  value={newTask.title}
                  onChange={e => setNewTask({...newTask, title: e.target.value})}
                />
                <textarea
                  placeholder="Implementation details..."
                  className="w-full p-4 bg-gray-50 dark:bg-gray-700 dark:text-white rounded-2xl border-none focus:ring-2 focus:ring-blue-500 text-sm h-32 font-medium"
                  value={newTask.description}
                  onChange={e => setNewTask({...newTask, description: e.target.value})}
                ></textarea>
                <div className="flex gap-2">
                  <button type="submit" className="flex-1 py-5 bg-blue-600 text-white font-black rounded-2xl shadow-xl hover:bg-blue-700 transition">Save</button>
                  <button type="button" onClick={() => setIsAdding(false)} className="px-8 py-5 bg-gray-100 text-gray-600 font-black rounded-2xl hover:bg-gray-200 transition">Cancel</button>
                </div>
              </form>
            )}

            {isLoading ? (
              <div className="col-span-full h-96 flex items-center justify-center">
                <RefreshCw className="animate-spin text-blue-600" size={48} />
              </div>
            ) : filteredTasks.map((task) => (
              <div key={task.id} className={`group bg-white dark:bg-gray-800 p-8 rounded-[3rem] border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all flex flex-col relative overflow-hidden ${task.status === 'completed' ? 'opacity-50' : ''}`}>
                <div className="flex justify-between items-start mb-6">
                  <div className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 ${
                    task.priority === 'high' ? 'bg-red-50 text-red-600 border-red-100' : 
                    task.priority === 'medium' ? 'bg-yellow-50 text-yellow-600 border-yellow-100' : 'bg-blue-50 text-blue-600 border-blue-100'
                  }`}>
                    {task.priority}
                  </div>
                  <button disabled={demo} title={demo ? DEMO_OPERATION_DISABLED : undefined} aria-label={`Delete ${task.title}`} onClick={() => deleteTask(task.id)} className="relative z-10 p-3 text-gray-400 hover:text-red-500 transition-colors md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100">
                    <Trash2 size={20} />
                  </button>
                </div>
                <div className="flex-1 space-y-3">
                  <h3 className={`text-2xl font-black text-gray-900 dark:text-white leading-tight ${task.status === 'completed' ? 'line-through opacity-50' : ''}`}>
                    {/* The ::after overlay stretches this button across the whole
                        card, so clicking anywhere opens the detail view while the
                        delete/status buttons (z-10) stay independently clickable. */}
                    <button
                      type="button"
                      onClick={() => setOpenTaskId(task.id)}
                      className="text-left after:absolute after:inset-0 after:rounded-[3rem] after:content-[''] focus:outline-none focus-visible:after:ring-4 focus-visible:after:ring-blue-500"
                    >
                      {task.title}
                    </button>
                  </h3>
                  <p className="text-sm text-gray-500 font-medium leading-relaxed line-clamp-3">
                    {task.description || "No strategic context provided."}
                  </p>
                  {task.report?.trim() && (
                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 text-[10px] font-black uppercase tracking-widest">
                      <FileText size={14} />
                      Report attached
                    </span>
                  )}
                </div>
                <div className="mt-8 pt-8 border-t border-gray-50 flex items-center justify-between">
                  <button type="button" disabled={demo} title={demo ? DEMO_OPERATION_DISABLED : undefined} className={`relative z-10 flex min-h-11 items-center gap-3 py-2 px-4 rounded-2xl transition-all cursor-pointer font-black text-[10px] uppercase tracking-widest ${
                    task.status === 'completed' ? 'bg-green-600 text-white' : 
                    task.status === 'in-progress' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                  }`} onClick={() => toggleStatus(task)} aria-label={`Change status for ${task.title}. Current status ${task.status}`}>
                    {task.status === 'completed' ? <CheckCircle2 size={16} /> : <Clock size={16} />}
                    {task.status.replace('-', ' ')}
                  </button>
                  <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">
                    {new Date(task.createdAt).toLocaleDateString(demo ? 'en-US' : undefined, demo ? { timeZone: 'UTC' } : undefined)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: AI Suggestions */}
        <div className="lg:col-span-4 space-y-8">
          <div className="bg-gradient-to-br from-indigo-900 via-blue-900 to-gray-900 p-8 rounded-[3rem] shadow-2xl text-white relative overflow-hidden group">
            <div className="absolute top-0 right-0 -mt-20 -mr-20 w-64 h-64 bg-blue-500/20 rounded-full blur-[80px]"></div>
            
            <div className="relative z-10 flex justify-between items-center mb-10">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-500/20 backdrop-blur-md rounded-2xl border border-blue-400/30">
                  <Sparkles className="text-blue-300 animate-pulse" size={24} />
                </div>
                <h2 className="text-2xl font-black tracking-tight">AI Insights</h2>
              </div>
              <button 
                onClick={() => refreshSuggestions()}
                aria-label="Refresh strategy insights"
                disabled={isSuggesting}
                className="p-3 hover:bg-white/10 rounded-2xl transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`${isSuggesting ? 'animate-spin' : ''}`} size={20} />
              </button>
            </div>

            <div className="relative z-10 space-y-4">
              {!suggestions ? (
                <div className="text-center py-10 opacity-60 space-y-3">
                  <div className="w-16 h-16 bg-white/10 rounded-full mx-auto flex items-center justify-center">
                    <Sparkles size={28} />
                  </div>
                  <p className="text-sm font-bold">Hit the refresh button above to generate insights from your data.</p>
                </div>
              ) : suggestions.length === 0 ? (
                <div className="text-center py-10 opacity-50 space-y-4">
                  <div className="w-16 h-16 bg-white/10 rounded-full mx-auto flex items-center justify-center">
                    <AlertCircle size={32} />
                  </div>
                  <p className="text-sm font-bold">Upload CSV data to generate strategic suggestions.</p>
                </div>
              ) : (Array.isArray(suggestions) ? suggestions : []).map((s: any, i: number) => (
                <div key={i} role={demo ? "button" : undefined} aria-disabled={demo || undefined} title={demo ? DEMO_OPERATION_DISABLED : undefined} className="group bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-[2rem] hover:bg-white/10 transition-all cursor-pointer" onClick={() => addTaskFromSuggestion(s.title, s.description)}>
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-300">{demo ? "Synthetic Data Insight" : "Auto-Generated"}</span>
                    <Plus className="text-blue-300 opacity-0 group-hover:opacity-100 transition-opacity" size={18} />
                  </div>
                  <h4 className="font-black text-lg leading-tight mb-2">{s.title}</h4>
                  <p className="text-xs text-blue-100/60 font-medium line-clamp-2">{s.description}</p>
                </div>
              ))}
            </div>

            <div className="relative z-10 mt-8 pt-8 border-t border-white/10">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 text-center">Performance-to-Task Matrix V1</p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 p-8 rounded-[3rem] border border-gray-100 dark:border-gray-700 shadow-sm space-y-6">
            <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight flex items-center gap-3">
              <div className="w-2 h-8 bg-blue-600 rounded-full"></div>
              Phase 2 Focus
            </h3>
            <ul className="space-y-4">
              {[
                "Multi-Yard Inventory Querying",
                "Advanced Profit Analytics",
                "Seasonal Demand Tracking",
                "Interactive Sourcing Map"
              ].map(f => (
                <li key={f} className="flex items-center gap-4 text-sm font-bold text-gray-600 dark:text-gray-300">
                  <div className="p-1 bg-green-50 text-green-600 rounded-lg">
                    <CheckCircle2 size={16} />
                  </div>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {openTask && <TaskDetailModal task={openTask} onClose={closeTask} />}
    </div>
  );
}
