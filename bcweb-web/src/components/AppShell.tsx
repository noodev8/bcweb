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

import { MouseEvent, ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeftIcon, ArrowRightOnRectangleIcon, CurrencyPoundIcon, BuildingStorefrontIcon, TagIcon, Squares2X2Icon, ChartBarIcon,
  ArchiveBoxIcon, UserGroupIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import CopyButton from '@/components/CopyButton';

// The persistent module switcher — a compact segmented control in the header on every screen, so the operator can hop straight between
// the modules without going back to the dashboard first. Segments leads: it's the "where do I start / what needs attention next"
// screen the operator constantly returns to mid-task (owner feedback), so it belongs in the header, not just as a dashboard tile —
// followed by the three action modules, then Analytics (promoted into the header too, so its reporting is reachable from anywhere).
// Icons match the dashboard tiles. Active state is by path-prefix, so a drill page (/pricing/style/…, /amz/sku/…) still highlights its module.
const MODULES: { label: string; href: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { label: 'Segments', href: '/segments', icon: Squares2X2Icon },
  { label: 'Shopify Pricing', href: '/pricing', icon: CurrencyPoundIcon },
  { label: 'Amazon Pricing', href: '/amz', icon: BuildingStorefrontIcon },
  { label: 'Add / Modify', href: '/products', icon: TagIcon },
  { label: 'Inventory', href: '/inventory', icon: ArchiveBoxIcon },
  // Customer Orders earns a header slot on frequency alone: it's the one screen worked every day, and it's also the one you're most
  // often pulled INTO from somewhere else ("has that order gone?"). Order Status deliberately isn't here — placing and chasing
  // supplier orders is a sit-down job you start from the dashboard, not something you dip into mid-task.
  { label: 'Customer Orders', href: '/customer-orders', icon: UserGroupIcon },
  { label: 'Analytics', href: '/analytics', icon: ChartBarIcon },
];

interface AppShellProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;     // optional line under the title (e.g. the style's groupid) — the page's key identifier
  subtitleCopy?: boolean; // when true, shows a copy-icon next to the subtitle that copies it verbatim (e.g. to search elsewhere)
  subtitleNode?: ReactNode; // richer alternative to `subtitle` for pages whose identity is more than one string (e.g. the Amazon drill's
                            // Group ID + Amazon SKU); rendered in the same slot, takes precedence over `subtitle` when provided
  backHref?: string;     // when set, shows a single back arrow linking here
  backLabel?: string;
  headerRight?: ReactNode; // optional node rendered flush-right of the title (e.g. a product thumbnail) — uses the title row's
                           // otherwise-empty right side so it costs no vertical space in the page body
  onBackgroundClick?: () => void; // fires on a click that lands on empty page background rather than on any real content — wired
                                  // to both the outer shell div and <main> (see their onClick below) so it covers the side margins
                                  // beyond the content measure, the gaps between a page's own sections/panels, and top/bottom
                                  // padding. Lets a page offer "click empty space to deselect/close" without every page
                                  // reimplementing the target===currentTarget check itself. No-op unless a page passes one.
}

export default function AppShell({ children, title, subtitle, subtitleCopy, subtitleNode, backHref, backLabel, headerRight, onBackgroundClick }: AppShellProps) {
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
    // onClick here too (not just on <main> below) — `main` itself is width-constrained to the `container` measure, so on a wide
    // viewport the blank strips either side of that centered column, and any filler below a page shorter than the viewport, are
    // this outer div's own background, not main's. Same target===currentTarget guard, so header/nav content is never affected.
    <div className="min-h-screen" onClick={(e: MouseEvent<HTMLElement>) => { if (onBackgroundClick && e.target === e.currentTarget) onBackgroundClick(); }}>
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
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {title && <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>}
              {subtitleNode ? (
                <div className="mt-0.5">{subtitleNode}</div>
              ) : subtitle && (
                <p className="mt-0.5 flex items-center gap-1 font-mono text-sm text-slate-500">
                  {subtitle}
                  {subtitleCopy && <CopyButton value={subtitle} label={subtitle} />}
                </p>
              )}
            </div>
            {headerRight && <div className="shrink-0">{headerRight}</div>}
          </div>
        </div>
      )}

      <main
        className={container + ' py-6'}
        onClick={(e: MouseEvent<HTMLElement>) => { if (onBackgroundClick && e.target === e.currentTarget) onBackgroundClick(); }}
      >
        {children}
      </main>
    </div>
  );
}
