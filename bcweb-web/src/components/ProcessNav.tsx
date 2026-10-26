'use client';
/*
ProcessNav — the small Today / Amazon Order / Sales buttons (Today = the /process screen on screen since 2026-10-26) (owner, 2026-10-26: "Need navigation from the amazon screen and sales
screen and back"). Process shows them under its cards; Amazon Order and Sales show them in the header row ONLY when Process sent
you (?from=/process), so the team's ordinary visits look the same as before. Every link carries ?from=/process&back=Process, so
each screen's ← Process link keeps working however many hops you make between them. The screen you're on is left out.
*/

import Link from 'next/link';
import { ChevronRightIcon } from '@heroicons/react/20/solid';

export const PROCESS_PATH = '/process';

const LINKS = [
  { key: 'process', href: PROCESS_PATH, label: 'Today' },
  { key: 'amazon-order', href: '/amazon-order', label: 'Amazon Order' },
  { key: 'sales', href: '/analytics/sales', label: 'Sales' },
] as const;

export default function ProcessNav({ current, className = '' }: { current: (typeof LINKS)[number]['key']; className?: string }) {
  return (
    <nav className={`flex flex-wrap gap-2 ${className}`}>
      {LINKS.filter((l) => l.key !== current).map((l) => (
        <Link
          key={l.key}
          href={l.key === 'process' ? l.href : `${l.href}?from=${encodeURIComponent(PROCESS_PATH)}&back=Today`}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:border-brand-500 hover:text-brand-600"
        >
          {l.label}
          <ChevronRightIcon className="h-4 w-4 text-slate-400" />
        </Link>
      ))}
    </nav>
  );
}
