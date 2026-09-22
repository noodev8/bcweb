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

import { ReactNode, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import { StarIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid';
import { useAuth } from '@/contexts/AuthContext';
import CopyButton from '@/components/CopyButton';
import { logScreenView } from '@/lib/api';
import { findPinnable, pinnableForPath } from '@/lib/pinnable';
import { usePins, MAX_PINS } from '@/lib/usePins';

// THE HEADER BAR IS NOW PINNED, NOT FIXED (owner, 2026-09-22). It used to be a hard-coded four — Inventory, Segments, Customer
// Orders, Reports — chosen in 2026-08-27 as "the ones genuinely hopped between with a task half-done", after a cut from seven on the
// grounds that a row you have to READ is slower than the menu it saves you a trip to. Both of those judgements still hold; what
// changed is that they are now the DEFAULT rather than the law, so the cap on the row is a cap on what fits, not a standing argument
// about whose four are right.
// The list, the storage and the reasoning live in lib/usePins.ts; the screens that can go in it are lib/pinnable.ts. Crucially this
// bar does NOT mirror the dashboard's five intent groups, and shouldn't be "made consistent" with them later — see the note in
// usePins.ts for why a hop with a known destination is the wrong thing to put a mindset-pick in front of.
// Active state is still by path prefix (longest match wins, so Bclog inside /analytics doesn't light up Reports), and the active tab
// still lifts to a white raised pill inside the recessed track.

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
                           // otherwise-empty right side so it costs no vertical space in the page body
}

// The star itself. Its own component only because it renders in two places — beside a title, and alone on the one pinnable page
// that has no title.
function PinStar({ here, herePinned, full, toggle }: { here: { label: string; href: string }; herePinned: boolean; full: boolean; toggle: (href: string) => void }) {
  const blocked = full && !herePinned;
  return (
    <button
      type="button"
      onClick={() => !blocked && toggle(here.href)}
      aria-pressed={herePinned}
      title={
        herePinned
          ? `Remove ${here.label} from the header bar`
          : blocked
            ? `The header bar is full (${MAX_PINS}) — unpin one first`
            : `Pin ${here.label} to the header bar`
      }
      className={
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition ' +
        (herePinned
          ? 'text-amber-500 hover:bg-amber-50'
          : blocked
            ? 'cursor-not-allowed text-slate-200'
            : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500')
      }
    >
      {herePinned ? <StarSolidIcon className="h-5 w-5" /> : <StarIcon className="h-5 w-5" />}
    </button>
  );
}

export default function AppShell({ children, title, titleHref, titleTitle, subtitle, subtitleCopy, subtitleNode, backHref, backLabel, headerRight }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, isAuthenticated, displayName, logout } = useAuth();
  // Called here, above the auth early-return, because hooks can't run conditionally — the splash branch below returns before the
  // header exists but React still has to see the same hook order on every render.
  const { pins, toggle, full } = usePins();

  // The registry entry for wherever we are, or undefined on a screen that isn't pinnable (the dashboard, a login page). Drives both
  // the active tab and the pin control beside the page title.
  const here = pinnableForPath(pathname);
  const herePinned = !!here && pins.includes(here.href);

  /*
  BACK GOES WHERE YOU CAME FROM, NOT UP THE ROUTE TREE (owner, 2026-09-22 — "I went to Winners and then went back to the full
  reports; I'd prefer to go back where I came"). Every dashboard tile links with `?from=<group id>`; if it's on the URL, the back
  link points at /dashboard?g=<group id>, which re-opens that group. Winners is the case that exposed the old behaviour: its parent
  is the reports index, which since the reports became dashboard cards is a page you may never have been on.
  `backHref` is still the fallback and still right for everything else — a drill page reached from its own list, a deep link, a
  bookmark. This only overrides when the dashboard actually sent you.
  Read from window.location rather than useSearchParams because AppShell wraps EVERY page: useSearchParams here would opt the whole
  app out of static rendering. The effect means the first paint shows the fallback label for a frame, which is invisible in practice
  and cheaper than that.
  It survives exactly one hop, by design. Go Winners -> some drill page and back is that page's own parent again, which is correct:
  by then the dashboard is two steps away, not one.
  */
  const [from, setFrom] = useState<string | null>(null);
  useEffect(() => {
    setFrom(new URLSearchParams(window.location.search).get('from'));
  }, [pathname]);

  const effectiveBackHref = from ? '/dashboard?g=' + encodeURIComponent(from) : backHref;
  const effectiveBackLabel = from ? 'Dashboard' : (backLabel || 'Back');

  /*
  USAGE TELEMETRY (owner, 2026-09-22) — one row per screen opened, so that "which screens are used and which are ignored" is
  answerable when it eventually gets asked. It cannot be answered retrospectively, hence collecting now with no report built yet;
  the server side, the table shape and the caveats are in the header of bcweb-server/routes/screen-view.js.

  HERE, in AppShell, because this wraps every page — a call per dashboard tile would miss the header pins, deep links and bookmarks,
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
              {/* Resolved from href to registry entry at render. A pin whose screen has since left PINNABLE simply doesn't
                  render — dropping a stale tab quietly is better than a tab that leads nowhere. */}
              {pins.map((href) => findPinnable(href)).filter((m): m is NonNullable<typeof m> => !!m).map((m) => {
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
              {/* An empty bar is a possible state (unpin everything) and an empty recessed track reads as something broken rather
                  than as something you emptied, so it says so and names the fix. */}
              {pins.length === 0 && (
                <span className="whitespace-nowrap px-3 py-1.5 text-sm text-slate-400">
                  No pinned screens — star a page to add it
                </span>
              )}
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
      {/* Optional page sub-header (back link + title + the pin control).
          `here` is in the condition so a pinnable page with NO title still gets this row — /update-amazon is the only one, and it
          would otherwise be the single screen in the app you cannot pin from. */}
      {(title || effectiveBackHref || here) && (
        <div className={container + ' pt-6'}>
          {effectiveBackHref && (
            <Link href={effectiveBackHref} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
              <ArrowLeftIcon className="h-4 w-4" /> {effectiveBackLabel}
            </Link>
          )}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {/* THE PIN CONTROL SITS BESIDE THE PAGE'S NAME (owner's call, 2026-09-22), not on the bar it fills and not on a
                  settings screen. You know you want a screen pinned while you are standing ON it and finding yourself back for the
                  third time — putting the control at that moment means pinning never needs a trip anywhere. The star is quiet
                  (slate, no fill) until it's on, so it doesn't compete with the heading it sits next to.
                  Guarded by `here` because not every page is in the registry, and by nothing else: at the cap the star stays
                  visible but goes inert and says why, since a control that vanishes when you need it reads as a bug. */}
              {title && (
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                    {titleHref ? (
                      // Underline only on hover: at rest the heading must still read as the page's name, not as a piece of UI.
                      <Link href={titleHref} title={titleTitle} className="hover:text-brand-700 hover:underline hover:decoration-slate-300 hover:underline-offset-4">
                        {title}
                      </Link>
                    ) : title}
                  </h1>
                  {here && <PinStar {...{ here, herePinned, full, toggle }} />}
                </div>
              )}
              {!title && here && <PinStar {...{ here, herePinned, full, toggle }} />}
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
