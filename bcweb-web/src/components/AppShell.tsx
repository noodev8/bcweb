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
  ArrowLeftIcon, ArrowRightOnRectangleIcon, Squares2X2Icon, ArchiveBoxIcon, UserGroupIcon, ChartBarIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import CopyButton from '@/components/CopyButton';

// The persistent module switcher — a compact segmented control in the header on every screen, so the operator can hop straight between
// the modules without going back to the dashboard first.
//
// CUT FROM SEVEN TO FOUR (owner, 2026-08-27). It had grown to seven and was starting to do the dashboard's job badly: a row you have
// to READ is slower than the menu it was meant to save you a trip to. These four are the ones genuinely hopped between with a task
// half-done. Everything else is reached from the dashboard, which is a deliberate trade — the owner goes back there to search anyway,
// so the dashboard is on the path, not a detour.
// Inventory leads: looking a product up is how most tasks start.
// Reports is here on the owner's evidence, not on the theory — the theory said a read-a-number screen is somewhere you go
// deliberately, with nothing else on the go, so it didn't belong. The owner goes there repeatedly through the day for various
// reasons, which makes it exactly the mid-task hop this bar exists for. Kept last: it's the only one that isn't a working screen.
// Icons match the dashboard tiles. Active state is by path-prefix, so a drill page (/pricing/style/…, /amz/sku/…) still highlights its
// module. `also` covers a module whose views don't all live under its own path — Reports absorbed Brands but it kept its original
// route, and a tab that goes dark on a page you reached THROUGH it reads as having lost your place.
const MODULES: { label: string; href: string; icon: React.ComponentType<{ className?: string }>; also?: string[] }[] = [
  { label: 'Inventory', href: '/inventory', icon: ArchiveBoxIcon },
  { label: 'Segments', href: '/segments', icon: Squares2X2Icon },
  // Customer Orders earns a slot on frequency alone: it's the one screen worked every day, and it's also the one you're most often
  // pulled INTO from somewhere else ("has that order gone?").
  { label: 'Customer Orders', href: '/customer-orders', icon: UserGroupIcon },
  { label: 'Reports', href: '/analytics', icon: ChartBarIcon, also: ['/brands'] },
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
}

export default function AppShell({ children, title, subtitle, subtitleCopy, subtitleNode, backHref, backLabel, headerRight }: AppShellProps) {
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
      {/* Platform header — shared by every module. ONE ROW (owner, 2026-08-27): the brand, the module switcher and the account
          controls used to sit in two stacked bordered rows, which cost ~50px of chrome on every screen to say very little. Merged,
          they read as a single toolbar and the page starts that much higher.
          No search box here either (owner, 2026-08-27): the dashboard is where a hunt starts, and it's already on the way — a second
          search box on every screen was one more thing to look past. The hero box on /dashboard is the only one.
          The "Platform" pill next to the brand is gone with the same pass — it labelled the product to the only people who already
          knew what it was. */}
      <header className="border-b border-slate-200 bg-white">
        <div className={container + ' flex items-center justify-between gap-4 py-2.5'}>
          {/* Brand + switcher. The switcher scrolls on its own (min-w-0 + overflow-x-auto) so a narrow window shortens the tabs
              rather than pushing Logout off the edge. */}
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/dashboard" className="shrink-0 text-lg font-semibold tracking-tight text-slate-900 hover:text-brand-700">
              Brookfield Comfort
            </Link>
            {/* Module switcher — hop between modules from anywhere (kills the "back to the front page, then in again" detour).
                The active tab lifts to a white "raised" pill inside the recessed track. */}
            <nav className="inline-flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100/70 p-1">
              {MODULES.map((m) => {
                const paths = [m.href, ...(m.also || [])];
              const active = paths.some((h) => pathname === h || pathname.startsWith(h + '/'));
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
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3 text-sm">
            {/* The signed-in line is the first thing to go when the row gets tight — it's ambient, not a control. */}
            <span className="hidden text-slate-500 lg:inline">Signed in as <span className="font-medium text-slate-800">{displayName}</span></span>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50"
            >
              <ArrowRightOnRectangleIcon className="h-4 w-4" /> Logout
            </button>
          </div>
        </div>
      </header>

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

      <main className={container + ' py-6'}>{children}</main>
    </div>
  );
}
