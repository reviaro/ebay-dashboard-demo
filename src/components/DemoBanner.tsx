import { ShieldCheck } from 'lucide-react';

export default function DemoBanner() {
  return <div className="demo-banner"><div className="flex items-center gap-2"><ShieldCheck size={15} className="shrink-0" /><span>Demo store with made-up data. Read-only.</span></div><span className="text-amber-200/70 whitespace-nowrap">As of Sep 30, 2026</span></div>;
}
