'use client';
/*
=======================================================================================================================================
Component: SocialQueue
=======================================================================================================================================
Purpose: The Queue half of the Social module. Everything composed, grouped Failed / Scheduled / Posted, newest first. Cancel anything
         not yet out; retry anything that failed.

WHY FAILED SORTS TO THE TOP, LOUDLY
         A scheduler that fails quietly is worse than no scheduler (spec) — the way a daily-posting habit dies is a post that didn't go
         out and nobody noticed. So FAILED gets its own group, first, in red, with Meta's actual error text on the row rather than a
         generic "failed" chip. The count also drives the Marketing tile's badge.

WHY POSTED ROWS HAVE NO DELETE
         A POSTED row records something publicly visible on Facebook. Removing it here would not un-publish anything — it would only
         destroy the record of what went out. Cancel therefore only ever applies to SCHEDULED rows.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ArrowPathIcon, TrashIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { SocialPost, SocialStatus, cancelSocialPost, publishSocialNow } from '@/lib/api';
import { buildTrackedLink } from '@/lib/socialLink';

// No CANCELLED group: a post that never went out is DELETED outright rather than parked as a dead row (owner, 2026-08-01) — the queue
// is a worklist, not an archive. Who removed what is recorded in `bclog` instead. CANCELLED survives only for the Phase 3 case where a
// post published on one platform and was pulled on the other, so such a post still appears under its published group.
const GROUPS: Array<{ key: SocialStatus; label: string; tone: string }> = [
  { key: 'FAILED', label: 'Failed', tone: 'text-red-700' },
  { key: 'SCHEDULED', label: 'Scheduled', tone: 'text-slate-900' },
  { key: 'POSTED', label: 'Posted', tone: 'text-slate-900' },
];

const CHIP: Record<SocialStatus, string> = {
  FAILED: 'bg-red-100 text-red-700',
  SCHEDULED: 'bg-sky-100 text-sky-700',
  PUBLISHING: 'bg-amber-100 text-amber-700',
  POSTED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

// A post's headline status for grouping. A post with one target is the normal case; with two (Phase 3) the worst state wins, because
// "one of these needs attention" is the thing the operator has to notice.
function worstStatus(post: SocialPost): SocialStatus {
  const order: SocialStatus[] = ['FAILED', 'PUBLISHING', 'SCHEDULED', 'POSTED', 'CANCELLED'];
  for (const s of order) if (post.targets.some((t) => t.status === s)) return s;
  return 'CANCELLED';
}

export default function SocialQueue({ posts, onChanged }: { posts: SocialPost[]; onChanged: () => void }) {
  const [working, setWorking] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; msg: string } | null>(null);

  // Removes the post entirely when it never went out (server-side rule — see routes/social-post-cancel.js). No confirm dialog: the
  // post hasn't been published, nothing is public, and it takes seconds to re-compose. Who removed what is recorded in bclog.
  async function doDelete(postId: number) {
    setWorking(postId);
    setRowError(null);
    const res = await cancelSocialPost(postId);
    setWorking(null);
    if (!res.success) setRowError({ id: postId, msg: res.error || 'Could not delete' });
    onChanged();
  }

  async function doRetry(postId: number, targetId: number) {
    setWorking(postId);
    setRowError(null);
    const res = await publishSocialNow(targetId);
    setWorking(null);
    // A retry failure carries Meta's own message — show it, because "try again" is rarely the right next step and the reason matters.
    if (!res.success) setRowError({ id: postId, msg: res.error || 'Could not publish' });
    onChanged();
  }

  if (posts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
        <p className="text-sm text-slate-500">Nothing queued yet.</p>
        <p className="mt-1 text-xs text-slate-400">Compose a post and it will show up here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {GROUPS.map(({ key, label, tone }) => {
        const group = posts.filter((p) => worstStatus(p) === key);
        if (group.length === 0) return null;

        return (
          <section key={key}>
            <h2 className={'mb-3 text-sm font-semibold uppercase tracking-wide ' + tone}>
              {label} <span className="font-normal text-slate-400">({group.length})</span>
            </h2>

            <ul className="space-y-3">
              {group.map((post) => {
                const busy = working === post.id;
                const err = rowError?.id === post.id ? rowError.msg : null;
                const failedTarget = post.targets.find((t) => t.status === 'FAILED');
                // Offered whenever nothing has published: a FAILED post is exactly the one you most want to clear out, not just a
                // SCHEDULED one. The server is the authority on whether it deletes or merely cancels.
                const removable = !post.targets.some((t) => t.status === 'POSTED' || t.status === 'PUBLISHING');

                return (
                  <li
                    key={post.id}
                    className={
                      'flex gap-4 rounded-lg border p-3 ' +
                      (key === 'FAILED' ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white')
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={post.asset.public_url}
                      alt=""
                      className="h-20 w-32 flex-none rounded border border-slate-200 object-cover"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {post.targets.map((t) => (
                          <span key={t.id} className={'rounded px-1.5 py-0.5 text-[11px] font-medium ' + CHIP[t.status]}>
                            {t.platform} · {t.status}
                            {t.attempts > 1 && t.status !== 'POSTED' ? ` · try ${t.attempts}` : ''}
                          </span>
                        ))}
                        <span className="text-xs text-slate-500">{when(post.scheduled_at)}</span>
                        {post.campaign && <span className="text-xs text-slate-400">· {post.campaign}</span>}
                      </div>

                      {/* whitespace-pre-line keeps the paragraph breaks. Without it the blank lines collapse and the caption reads as
                          one run-on sentence ("...the more you wear it We stock them in depth"), which looks like the post itself is
                          malformed when it is only the preview. line-clamp-4 rather than 2, since the house template is four blocks. */}
                      <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-sm text-slate-700">{post.caption}</p>

                      {/* The link, shown because THIS is where you check something scheduled days out — Compose's preview is long gone
                          by then. The UTM is rebuilt here rather than stored (it is per-platform, added at publish time), so what is
                          shown is what will actually go out. */}
                      {post.link_url && (
                        <p className="mt-1.5 break-all font-mono text-[11px] text-slate-400">
                          {/* v1 is Facebook-only. When IG lands, each target carries its own utm_source and this becomes per-target. */}
                          {buildTrackedLink(post.link_url, post.campaign, 'FB')}
                        </p>
                      )}

                      {/* Meta's own words, on the row. Not flattened into a generic failure chip. */}
                      {failedTarget?.error && (
                        <p className="mt-1.5 break-words rounded bg-red-100/70 px-2 py-1 font-mono text-[11px] text-red-800">
                          {failedTarget.error}
                        </p>
                      )}
                      {err && <p className="mt-1.5 text-xs text-red-700">{err}</p>}

                      <div className="mt-2 flex items-center gap-3 text-xs">
                        {failedTarget && (
                          <button
                            type="button"
                            onClick={() => doRetry(post.id, failedTarget.id)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            <ArrowPathIcon className="h-3.5 w-3.5" /> {busy ? 'Publishing…' : 'Retry now'}
                          </button>
                        )}
                        {removable && (
                          <button
                            type="button"
                            onClick={() => doDelete(post.id)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                          >
                            <TrashIcon className="h-3.5 w-3.5" /> {busy ? 'Deleting…' : 'Delete'}
                          </button>
                        )}
                        {post.targets.map((t) =>
                          t.status === 'POSTED' && t.remote_id ? (
                            <a
                              key={t.id}
                              href={`https://www.facebook.com/${t.remote_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
                            >
                              View on Facebook <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                            </a>
                          ) : null
                        )}
                        <span className="text-slate-400">by {post.created_by}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
