'use client';
/*
=======================================================================================================================================
Page: /social  (Marketing module — Social)
=======================================================================================================================================
Purpose: Post to the Brookfield Comfort Facebook Page every day without it costing thirty minutes. Two tabs in Phase 1:
           Compose — upload a graphic, write a caption, pick the link and the time, queue it.
           Queue   — what's scheduled, what went out, what failed. Cancel or retry.
         Results (Meta reach/engagement) is Phase 2 and arrives with the metrics sweep.

WHY THE QUEUE OWNS THE DATA AND COMPOSE JUST SIGNALS
         One useApiQuery for the whole screen, refreshed when Compose saves. Compose holds no list state of its own, so there is no way
         for the two tabs to disagree about what is queued.

THE SCOREBOARD IS GA4, NOT THIS SCREEN
         Said out loud at the bottom, on purpose. Meta's numbers (when Phase 2 adds them) are diagnostic. The measure of whether any of
         this works is clicks to site via UTM, in GA4 — and a screen full of reach figures is exactly how a team forgets that.

Guarded by AppShell. Consumes GET /social-posts; writes via the Compose/Queue components.
=======================================================================================================================================
*/

import { Suspense, useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PencilSquareIcon, QueueListIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import SocialCompose, { SocialCopySource } from '@/components/SocialCompose';
import SocialQueue from '@/components/SocialQueue';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSocialPosts, SocialPost } from '@/lib/api';

// Stable identity for "nothing loaded yet" — a fresh [] each render would churn anything derived from it.
const NO_POSTS: SocialPost[] = [];

type Tab = 'compose' | 'queue';

// useSearchParams must sit inside a Suspense boundary for Next's build (App Router). Thin wrapper does that — same pattern as
// /amz/find, which this screen's incoming-link handoff (below) mirrors.
export default function SocialPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <SocialPageContent />
    </Suspense>
  );
}

function SocialPageContent() {
  // A product sent in from Inventory ("Send to Social") arrives as ?link=<product URL>&image=<photo URL> and always lands on
  // Compose — it's a handoff into a fresh draft, never a link to the Queue. Read once; SocialCompose owns what happens with them
  // from here (prefilling the link, fetching+uploading the photo) and this page's job stops at getting the operator to the right
  // tab. Nothing here saves or queues anything on its own.
  const searchParams = useSearchParams();
  const incomingLink = searchParams.get('link') || '';
  const incomingImage = searchParams.get('image') || '';
  const [tab, setTab] = useState<Tab>('compose');

  // The Queue → Compose handoff for "Copy & fix". The page only ferries it across and switches tab; SocialCompose owns what a copy
  // means (prefilling the draft, and removing the original once the replacement is queued). The counter is what makes copying the
  // SAME post twice work — Compose keys its prefill on it, and neither component remounts when the tab changes.
  const [copyFrom, setCopyFrom] = useState<SocialCopySource | null>(null);
  const [copyNonce, setCopyNonce] = useState(0);
  // Stable identity: Compose acknowledges the handoff from an effect, and an inline arrow here would re-run that effect on every
  // render of this page.
  const handleCopyHandled = useCallback(() => setCopyFrom(null), []);

  const { data, error, isLoading, refresh } = useApiQuery(['social-posts'], () => getSocialPosts());
  const posts = data?.posts ?? NO_POSTS;
  const failed = data?.counts?.FAILED ?? 0;
  const scheduled = data?.counts?.SCHEDULED ?? 0;

  const tabs: Array<{ key: Tab; label: string; icon: typeof PencilSquareIcon; badge?: number }> = [
    { key: 'compose', label: 'Compose', icon: PencilSquareIcon },
    { key: 'queue', label: 'Queue', icon: QueueListIcon, badge: failed || undefined },
  ];

  return (
    <AppShell title="Social" backHref="/dashboard" backLabel="Dashboard">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Queue a post for the Brookfield Comfort Facebook Page. It goes out on its own at the time you set.
        </p>
        <p className="text-xs text-slate-400">
          {scheduled} scheduled{failed > 0 && <span className="font-medium text-red-600"> · {failed} failed</span>}
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {tabs.map(({ key, label, icon: Icon, badge }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ' +
              (tab === key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700')
            }
          >
            <Icon className="h-4 w-4" />
            {label}
            {badge ? (
              <span className="ml-1 rounded-full bg-red-100 px-1.5 text-[11px] font-semibold text-red-700">{badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'compose' ? (
        <SocialCompose
          // Saving normally lands you on the Queue to see the result. `stayOnCompose` is Compose asking to keep you here instead,
          // which it does only when it has a warning on screen that would otherwise vanish with the unmount.
          onCreated={(opts) => { refresh(); if (!opts?.stayOnCompose) setTab('queue'); }}
          initialLinkUrl={incomingLink}
          initialImageUrl={incomingImage}
          copyFrom={copyFrom}
          onCopyHandled={handleCopyHandled}
        />
      ) : isLoading ? (
        <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
      ) : error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>
      ) : (
        <SocialQueue
          posts={posts}
          onChanged={refresh}
          onCopy={(post) => {
            const nonce = copyNonce + 1;
            setCopyNonce(nonce);
            setCopyFrom({ post, nonce });
            setTab('compose');
          }}
        />
      )}

      {/* The stop-condition, in words, where it cannot be forgotten. */}
      <p className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-400">
        Site clicks are measured in <span className="font-medium text-slate-500">GA4</span>, not here. Every link goes out with a UTM
        tag attached.
      </p>
    </AppShell>
  );
}
