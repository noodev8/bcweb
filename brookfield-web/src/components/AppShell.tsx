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
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';

interface AppShellProps {
  children: ReactNode;
  title?: string;
  backHref?: string;     // when set, shows a single back arrow linking here
  backLabel?: string;
}

export default function AppShell({ children, title, backHref, backLabel }: AppShellProps) {
  const router = useRouter();
  const { ready, isAuthenticated, displayName, logout } = useAuth();

  // Route guard — bounce unauthenticated users to /login once hydration is done.
  useEffect(() => {
    if (ready && !isAuthenticated) router.replace('/login');
  }, [ready, isAuthenticated, router]);

  if (!ready || !isAuthenticated) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  return (
    <div className="min-h-screen">
      {/* Platform header — shared by every module. */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
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

      {/* Optional page sub-header (back link + title). */}
      {(title || backHref) && (
        <div className="mx-auto max-w-5xl px-4 pt-6">
          {backHref && (
            <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
              <ArrowLeftIcon className="h-4 w-4" /> {backLabel || 'Back'}
            </Link>
          )}
          {title && <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>}
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
