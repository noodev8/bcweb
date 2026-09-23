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
import { ArrowLeftIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import CopyButton from '@/components/CopyButton';
import { logScreenView } from '@/lib/api';
import { HEADER_TABS, tabForPath } from '@/lib/headerNav';
import { useUrlParam } from '@/lib/useUrlParam';

// The header bar is a FIXED four (lib/headerNav.ts). Pinning via a star beside the page title was tried on 2026-09-22 and removed on
// 2026-09-23; the reasoning is in that file. Active state is by path prefix (longest match wins), and the active tab lifts to a
// white raised pill inside the recessed track.

interface AppShellProps {
  children: ReactNode;
  title?: string;
  // When set, the title itself is the link — used where the page's SUBJECT has an obvious home elsewhere (a style's price screen
  // links its product name into Add / Modify). A heading is only made clickable where the destination is the same thing the
  // heading names; it is not a general-purpose action slot, which is what the button beside it would have become.
  titleHref?: string;
  titleTitle?: string;   // tooltip for the linked title, so the destination is named before the click
  subtitle?: string;     // optional line under the title (e.g. the style's groupid) — the page's key identifier
  subtitleCopy?: boolean; // when true, shows a copy-icon next to the subtitle that copies it verbatim (e.g. to search elsewhere)
  subtitleNode?: ReactNode; // richer alternative to `subtitle` for pages whose identity is more than one string (e.g. the Amazon drill's
                            // Group ID + Amazon SKU); rendered in the same slot, takes precedence over `subtitle` when provided
  // The page's OWN parent — where back goes when you arrived any other way than through the dashboard menu. See the `from` note in
  // the component body: a `?from=` on the URL overrides this, because the step you actually took beats the route tree.
  backHref?: string;
  backLabel?: string;
  headerRight?: ReactNode; // optional node rendered flush-right of the title (e.g. a product thumbnail) — uses the title row's
                           // otherwise-empty right side so it costs no vertical space in the page body. With no title it moves up
                           // to the back-link row, for the same reason.
  crumb?: ReactNode;       // optional "where you are" rendered after the back link as `← Repricing / GIZEH-SEG` — for pages whose
                           // name is context you picked one click ago, not a heading worth a row (owner, 2026-09-24: the pricing lists)
}

export default function AppShell({ children, title, titleHref, titleTitle, subtitle, subtitleCopy, subtitleNode, backHref, backLabel, headerRight, crumb }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, isAuthenticated, displayName, logout } = useAuth();
  // The header tab for wherever we are (drives the active highlight), or undefined on a screen that has none.
  const here = tabForPath(pathname);

  /*
  BACK GOES WHERE YOU CAME FROM, NOT UP THE ROUTE TREE (owner, 2026-09-22 — "I went to Winners and then went back to the full
  reports; I'd prefer to go back where I came"). Every dashboard tile links with `?from=<group id>`; if it's on the URL, the back
  link points at /dashboard?g=<group id>, which re-opens that group. Winners is the case that exposed the old behaviour: its parent
  is the reports index, which since the reports became dashboard cards is a page you may never have been on.
  `backHref` is still the fallback and still right for everything else — a drill page reached from its own list, a deep link, a
  bookmark. This only overrides when the dashboard actually sent you.
  Read from window.location rather than useSearchParams because AppShell wraps EVERY page: useSearchParams here would opt the whole
  app out of static rendering (lib/useUrlParam.ts). The server render has no URL, so the first paint shows the fallback label for a
  frame, which is invisible in practice and cheaper than that.
  It survives exactly one hop, by design. Go Winners -> some drill page and back is that page's own parent again, which is correct:
  by then the dashboard is two steps away, not one.
  A `from` that is a PATH (starts with "/") is not a dashboard group: the pricing screens use ?from=<path>&back=<label> to thread
  their own return target (Segments -> a segment's list -> a style's drill), and they pass it in as backHref themselves. Treating
  that as a group id sent every one of those back links to a dashboard with nothing open (fixed 2026-09-23).
  */
  const fromParam = useUrlParam('from');
  const from = fromParam && !fromParam.startsWith('/') ? fromParam : null;

  const effectiveBackHref = from ? '/dashboard?g=' + encodeURIComponent(from) : backHref;
  const effectiveBackLabel = from ? 'Dashboard' : (backLabel || 'Back');
  const hasTitleRow = !!(title || subtitle || subtitleNode);   // else headerRight moves up to the back-link row (no empty row for it)

  /*
  USAGE TELEMETRY (owner, 2026-09-22) — one row per screen opened, so that "which screens are used and which are ignored" is
  answerable when it eventually gets asked. It cannot be answered retrospectively, hence collecting now with no report built yet;
  the server side, the table shape and the caveats are in the header of bcweb-server/routes/screen-view.js.

  HERE, in AppShell, because this wraps every page — a call per dashboard tile would miss the header tabs, deep links and bookmarks,
  which are exactly the navigation habits worth knowing about.

  FIRE AND FORGET, and it must stay that way. Nothing is awaited, no state is set, and the `.catch` is empty: a usage row is
  bookkeeping, and it must never delay a render, surface an error, or make a page that loaded perfectly look broken. The path is sent
  raw and NORMALISED SERVER-SIDE (utils/screenPath.js) — the client is not the right place to decide a route's canonical name, and
  the query string is dropped there rather than here so search terms never leave the browser in this call at all.

  Gated on `ready && isAuthenticated`: before that we may be about to bounce to /login, and a view logged for a page nobody got to
  see is a false row. Keyed on pathname only — a filter change or a ?from= is the same screen, not a second visit.
  */
  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    logScreenView(pathname);
  }, [pathname, ready, isAuthenticated]);

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
              {HEADER_TABS.map((m) => {
                const active = here?.href === m.href;
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

      {/* Optional page sub-header (back link [+ crumb] + title). */}
      {(title || effectiveBackHref) && (
        <div className={container + ' pt-6'}>
          {effectiveBackHref && (
            <div className="mb-2 flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <Link href={effectiveBackHref} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700">
                  <ArrowLeftIcon className="h-4 w-4" /> {effectiveBackLabel}
                </Link>
                {crumb && (
                  <>
                    <span className="text-slate-300">/</span>
                    {crumb}
                  </>
                )}
              </div>
              {!hasTitleRow && headerRight && <div className="shrink-0">{headerRight}</div>}
            </div>
          )}
          {hasTitleRow && (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {title && (
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                  {titleHref ? (
                    // Underline only on hover: at rest the heading must still read as the page's name, not as a piece of UI.
                    <Link href={titleHref} title={titleTitle} className="hover:text-brand-700 hover:underline hover:decoration-slate-300 hover:underline-offset-4">
                      {title}
                    </Link>
                  ) : title}
                </h1>
              )}
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
          )}
        </div>
      )}

      <main className={container + ' py-6'}>{children}</main>
    </div>
  );
}
