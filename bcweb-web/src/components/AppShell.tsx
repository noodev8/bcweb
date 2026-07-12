'use client';
/*
=======================================================================================================================================
Component: AppShell
=======================================================================================================================================
Purpose: The reusable platform chrome + route guard for every logged-in page (dashboard + all pricing screens). This is the piece
         that makes the app a "platform": a consistent header (brand, current user, logout) that future modules render inside too.

Guard: if auth has hydrated (ready) and the user is NOT authenticated, redirect to /login. While hydrating, render a light splash so
       we never flash protected content. Optionally shows a back link + page title via props.
=======================================================================================================================================
*/

import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon, ArrowRightOnRectangleIcon, CurrencyPoundIcon, BuildingStorefrontIcon, TagIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import CopyButton from '@/components/CopyButton';

// The persistent module switcher — a compact segmented control in the header on every screen, so the operator can hop straight between
// the "doing" modules without going back to the dashboard first. Kept to the three action modules only: Segments and Analytics are
// "starting thought" screens reached from the dashboard, not places you hop between mid-task. Icons match the dashboard tiles. Active
// state is by path-prefix, so a drill page (/pricing/style/…, /amz/sku/…) still highlights its module.
const MODULES: { label: string; href: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { label: 'Shopify Pricing', href: '/pricing', icon: CurrencyPoundIcon },
  { label: 'Amazon Pricing', href: '/amz', icon: BuildingStorefrontIcon },
  { label: 'Add / Modify', href: '/products', icon: TagIcon },
];

interface AppShellProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;     // optional line under the title (e.g. the style's groupid) — the page's key identifier
  subtitleCopy?: boolean; // when true, shows a copy-icon next to the subtitle that copies it verbatim (e.g. to search elsewhere)
  backHref?: string;     // when set, shows a single back arrow linking here
  backLabel?: string;
}

export default function AppShell({ children, title, subtitle, subtitleCopy, backHref, backLabel }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, isAuthenticated, displayName, logout } = useAuth();

  // Route guard — bounce unauthenticated users to /login once hydration is done.
  useEffect(() => {
    if (ready && !isAuthenticated) router.replace('/login');
  }, [ready, isAuthenticated, router]);

  if (!ready || !isAuthenticated) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  // One shared container so the header, sub-header and main all align to the same width across every module — a single comfortable
  // reading-measure column. (px only here; each site adds its own vertical padding.)
  const container = 'mx-auto max-w-5xl px-4';

  return (
    <div className="min-h-screen">
      {/* Platform header — shared by every module. */}
      <header className="border-b border-slate-200 bg-white">
        <div className={container + ' flex items-center justify-between py-3'}>
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight text-slate-900">Brookfield Comfort</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Platform</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-500">Signed in as <span className="font-medium text-slate-800">{displayName}</span></span>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50"
            >
              <ArrowRightOnRectangleIcon className="h-4 w-4" /> Logout
            </button>
          </div>
        </div>
      </header>

      {/* Module switcher — a segmented control to hop between modules from anywhere (kills the "back to the front page, then in again"
          detour). The active tab lifts to a white "raised" pill inside the recessed track. */}
      <nav className="border-b border-slate-200 bg-white">
        <div className={container + ' overflow-x-auto py-2.5'}>
          <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1">
            {MODULES.map((m) => {
              const active = pathname === m.href || pathname.startsWith(m.href + '/');
              const Icon = m.icon;
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  aria-current={active ? 'page' : undefined}
                  className={
                    'inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition ' +
                    (active
                      ? 'bg-white text-brand-700 shadow-sm ring-1 ring-slate-200'
                      : 'text-slate-500 hover:text-slate-800')
                  }
                >
                  <Icon className={'h-4 w-4 ' + (active ? 'text-brand-600' : 'text-slate-400')} />
                  {m.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Optional page sub-header (back link + title). */}
      {(title || backHref) && (
        <div className={container + ' pt-6'}>
          {backHref && (
            <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
              <ArrowLeftIcon className="h-4 w-4" /> {backLabel || 'Back'}
            </Link>
          )}
          {title && <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>}
          {subtitle && (
            <p className="mt-0.5 flex items-center gap-1 font-mono text-sm text-slate-500">
              {subtitle}
              {subtitleCopy && <CopyButton value={subtitle} label={subtitle} />}
            </p>
          )}
        </div>
      )}

      <main className={container + ' py-6'}>{children}</main>
    </div>
  );
}
