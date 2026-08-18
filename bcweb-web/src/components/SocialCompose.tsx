'use client';
/*
=======================================================================================================================================
Component: SocialCompose
=======================================================================================================================================
Purpose: The Compose half of the Social module. Upload a finished graphic, write a caption, pick the collection link, pick a date and
         time, save. Deliberately dumb: no image editing, no templates, no rotation planner. You bring the graphic.

WHY THE UPLOAD HAPPENS BEFORE THE POST IS SAVED
         The image must be publicly reachable before Meta can fetch it, and it lives on one.com rather than behind this API. So the
         file goes up as soon as it is chosen — that gives an immediate preview AND surfaces a rejected size/aspect straight away,
         rather than after the caption has been written.

WHY THE TRACKED URL IS SHOWN READ-ONLY
         What actually goes out should never be a surprise. The server builds the canonical UTM at publish time (utils/socialMeta.js);
         the preview here comes from src/lib/socialLink.ts, which is a deliberate MIRROR of that rule and is shared with the Queue.
         Keep it in step with the server: utm_medium is always 'social', utm_source is the platform, utm_campaign is the campaign slug.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhotoIcon, ArrowUpTrayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  uploadSocialAsset, uploadSocialAssetFromUrl, createSocialPost, cancelSocialPost, SocialAsset, SocialPost, ApiResult
} from '@/lib/api';
import { buildTrackedLink } from '@/lib/socialLink';

// Matches the server's multer source cap (routes/social-asset-upload.js). Checked here purely for UX, never as enforcement — a browser
// check is trivially bypassed, so nginx (client_max_body_size) and multer remain the real limits.
//
// The reason it is worth having: nginx sits in front of the API in production and rejects an oversized body with a 413 BEFORE it
// reaches Node. A 413 carries no `return_code` envelope, so src/lib/api.ts can only report it as "Network error - please check your
// connection", which sends you looking at the wrong thing entirely. Catching it here gives an accurate message instantly, without
// spending thirty seconds uploading first.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/*
 * Known collection slugs, offered as a datalist with free text still allowed. These double as utm_campaign values (docs/social:
 * "utm_campaign = the collection slug"), so a short known list is what keeps the GA4 report readable instead of a spray of one-off
 * campaign names for the same collection.
 *
 * EVERY SLUG HERE IS VERIFIED TO RETURN 200 (checked 2026-08-01). If you add one, curl it first.
 * The earlier list was written from memory and five of its six entries 404'd — 'arizona', 'gizeh', 'boston', 'sale', 'new-in' do not
 * exist; the real ones are all prefixed 'birkenstock-'. Picking one from the dropdown would have published a post pointing at a dead
 * page, which is public and not quietly fixable after the fact. Guessing a URL is not acceptable here.
 * Note there is no birkenstock-boston collection (404), so Boston is deliberately absent rather than forgotten.
 */
const CAMPAIGNS = [
  'birkenstock',
  'birkenstock-arizona',
  'birkenstock-gizeh',
  'birkenstock-mayari',
  'birkenstock-milano',
  'birkenstock-eva',
];

// Non-www: the www host 301-redirects. Harmless in a browser, but it is an avoidable hop on a link we are publishing, and redirects
// are exactly where tracking parameters get dropped by an intermediary.
const SITE = 'https://brookfieldcomfort.com/collections/';

/*
 * The caption every post starts from. Only the opening hook changes — it is the one line that depends on which product this is, and it
 * gets written by hand once you know. Everything below it is fixed by docs/social/README.md: no perishable fact anywhere in the fixed
 * body (no counts, no prices, no colours, nothing that expires), word-for-word the same every time, because consistency is what makes
 * it stick.
 *
 * THE DELIVERY PROMISE LEADS. README.md originally made it a footer, on the theory that a repeated headline turns into wallpaper. The
 * owner overruled that (2026-08-18): next-day delivery is the reason someone buys from us rather than from the cheapest listing, so it
 * is the first thing they read after the hook. The stock line then backs it up — next-day only means anything if the stock is really
 * on the shelf — and the discount line stays deliberately vague ("often"), because a specific offer would expire and this text does not.
 *
 * It OPENS WITH TWO BLANK LINES on purpose — that is where the hook goes, and it leaves the blank line between hook and body already
 * in place. Deliberately no placeholder text in that gap: prefilled prompt text is the kind of thing that gets published by accident,
 * and this posts to a live 3.3K-follower Page. Forgetting the hook just yields the body (the caption is trimmed before sending), which
 * is dull but never embarrassing.
 */
const CAPTION_TEMPLATE = `

Order by 2pm Mon–Fri and it's with you the next working day.

Actual stock on the shelf, ready to go.

Discounts often available.

Have a look →`;

const pad = (n: number) => String(n).padStart(2, '0');
const toDateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/*
 * THE PUBLISH SLOTS.
 *
 * The sweep is the ONLY thing that publishes, and it runs four times a day, not continuously. So these are the only times a post can
 * actually go out — offering a free-text time would let the screen promise 11:00 for something that would really appear at 13:00.
 * Hence a date + a slot, rather than a datetime: the picker cannot express a time the scheduler will not honour.
 *
 * THESE MUST MATCH THE CRONTAB ON THE SERVER. The cron entries are written in GMT (the box's timezone) and hand-shifted so the LOCAL
 * time stays put across BST — the same convention as the update_orders.py entries. These hours are therefore Europe/London local
 * hours, which is also what the operator's browser shows. If the crontab times ever change, change them here in the same commit.
 */
const SLOT_HOURS = [4, 9, 13, 19] as const;
const slotLabel = (h: number) => `${pad(h)}:00`;

// Is this slot on this date still in the future? A date+slot in the past is rejected by the server, so we never offer one.
function slotIsFuture(dateValue: string, hour: number): boolean {
  if (!dateValue) return false;
  const d = new Date(`${dateValue}T${pad(hour)}:00:00`);
  return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
}

// The soonest slot that can still fire: today's next remaining slot, else the first slot tomorrow. Used for the initial state so the
// form opens on something valid rather than on a time that has already passed.
function nextAvailable(): { date: string; hour: number } {
  const now = new Date();
  const today = toDateValue(now);
  const remaining = SLOT_HOURS.find((h) => slotIsFuture(today, h));
  if (remaining !== undefined) return { date: today, hour: remaining };
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { date: toDateValue(tomorrow), hour: SLOT_HOURS[0] };
}

// The slot an existing post is scheduled into, for the Copy handoff. Keeps the ORIGINAL time when it is still in the future — when
// you are copying a post to fix its graphic, the time was already a decision and re-making it is just another thing to get wrong.
// Falls back to the next available slot if that moment has since passed (or the stored time isn't one of the four slots at all,
// which can only happen if SLOT_HOURS changed after the post was queued).
function slotFromIso(iso: string): { date: string; hour: number } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return nextAvailable();
  const date = toDateValue(d);
  const hour = SLOT_HOURS.find((h) => h === d.getHours());
  if (hour === undefined || !slotIsFuture(date, hour)) return nextAvailable();
  return { date, hour };
}

/*
 * A post being copied in from the Queue. `nonce` is what makes a SECOND copy of the SAME post re-prefill the form — the page does
 * not remount between Queue and Compose, so without it a repeat copy of the same row would look like nothing happened.
 *
 * WHY COPY-THEN-DELETE RATHER THAN AN EDIT ROUTE (owner's call, 2026-08-05)
 *   There is no update endpoint for a queued post, and adding one is more dangerous than it looks: the publish sweep can claim a
 *   target (PUBLISHING) between the form loading and the save landing, so an edit would have to re-check target status inside its
 *   own transaction exactly as social-post-cancel.js already does. Replacing the graphic also means a NEW social_asset row either
 *   way, so an update would additionally have to reimplement cancel's "delete the one.com file if no other post references it"
 *   cleanup or leak orphaned files. Copy + delete reuses both of those behaviours from code that already works, and nothing has
 *   published yet so the post id changing costs nothing.
 */
export interface SocialCopySource { post: SocialPost; nonce: number }

export default function SocialCompose({ onCreated, initialLinkUrl, initialImageUrl, copyFrom, onCopyHandled }: {
  // `stayOnCompose` asks the page NOT to jump to the Queue after a save, so a warning written here stays readable.
  onCreated: (opts?: { stayOnCompose?: boolean }) => void;
  // A handoff from Inventory's "Send to Social" button (?link=&image= on /social) — a product's live URL and photo, dropped
  // straight into a fresh draft so the operator only has to write the hook and pick a time. Never auto-saves or auto-queues.
  initialLinkUrl?: string;
  initialImageUrl?: string;
  // A handoff from the Queue's Copy button — see SocialCopySource. Loads the existing post into this form; queueing the result
  // then removes the original.
  copyFrom?: SocialCopySource | null;
  // Lets the page drop its copy state once this form has taken ownership of it, so a later remount doesn't resurrect the handoff.
  onCopyHandled?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [asset, setAsset] = useState<SocialAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState(CAPTION_TEMPLATE);
  const [campaign, setCampaign] = useState('');
  const [linkUrl, setLinkUrl] = useState(initialLinkUrl || '');
  // Initialised from the clock once, on mount — nextAvailable() is impure, so calling it during render would make the form's opening
  // state depend on when React happens to re-render.
  const [when, setWhen] = useState(nextAvailable);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  // The post this draft is REPLACING, if it arrived via Copy. Set only by the copy prefill below; cleared once the replacement has
  // been queued (or when the operator detaches it to keep both). `null` is the ordinary "this is a brand new post" case.
  const [replacing, setReplacing] = useState<{ id: number; scheduledAt: string } | null>(null);
  // A replacement that queued but whose original could NOT be removed. Kept separate from `error` because the new post DID save —
  // this is a "you now have two, go and delete one" warning, not a failure, and flattening the two together would misreport it.
  const [warnMsg, setWarnMsg] = useState<string | null>(null);

  const preview = useMemo(() => buildTrackedLink(linkUrl, campaign, 'FB'), [linkUrl, campaign]);
  // The chosen slot must still be in the future — picking today then a slot that has already passed is the one way to build an
  // invalid schedule here, and it should disable Save rather than fail on the server.
  // Still the bare template — the product-specific opening line hasn't been written yet.
  const hookMissing = caption.trim() === CAPTION_TEMPLATE.trim();
  const slotStillValid = slotIsFuture(when.date, when.hour);
  const canSave = !!asset && caption.trim().length > 0 && slotStillValid && !saving;

  // Shared by both upload paths (a manual file pick, and the URL-based one below) — same success/failure handling either way, so
  // the operator sees one consistent story regardless of how the image got here.
  const applyUploadResult = useCallback((res: ApiResult<SocialAsset>) => {
    if (res.success && res.data) {
      setAsset(res.data);
    } else if (res.return_code === 'NETWORK_ERROR') {
      // The request never came back with an envelope. For an UPLOAD specifically, the most likely cause is a proxy in front of the API
      // rejecting the body size (nginx answers 413 with no return_code, which api.ts can only report as a network error). Say so,
      // rather than sending the operator off to check their wifi.
      setError(
        'The upload didn\'t reach the server. If the image is large this is usually a size limit on the server, not your connection — ' +
        'try a smaller export, and tell Andreas if it keeps happening.'
      );
      setAsset(null);
    } else {
      // The server's message is specific and actionable here (exact dimensions, the allowed ratio window) — show it verbatim rather
      // than flattening it to "upload failed".
      setError(res.error || 'Upload failed');
      setAsset(null);
    }
  }, []);

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setOkMsg(null);

    // Reject before the request is made — see MAX_UPLOAD_BYTES for why this is worth doing client-side.
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB. ` +
        'Export it smaller and try again.'
      );
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setUploading(true);
    const res = await uploadSocialAsset(file);
    setUploading(false);
    applyUploadResult(res);
  }, [applyUploadResult]);

  // ---- Prefill from Inventory's "Send to Social" -----------------------------------------------------------------------------
  // Runs once per incoming product, not once per mount: `prefillKey` records the last link|image pair actually applied, so a
  // SECOND Send-to-Social while this tab is already open (the page doesn't remount for a same-route navigation) still resets the
  // draft onto the new product, rather than silently keeping the first one on screen.
  //
  // The reset itself happens DURING RENDER, not in an effect — the official "adjusting state when a prop changes" pattern
  // (react.dev), which is also what react-hooks/set-state-in-effect (enforced project-wide) exists to steer you toward instead of
  // an effect that turns incoming props straight into state on every change. `prefillKey` is the last link|image pair already
  // applied; a mismatch means a fresh product just arrived and the draft is reset onto it, synchronously, before this render paints.
  const [prefillKey, setPrefillKey] = useState('');
  const [prefilling, setPrefilling] = useState(false);
  const incomingKey = `${initialLinkUrl || ''}|${initialImageUrl || ''}`;
  if ((initialLinkUrl || initialImageUrl) && incomingKey !== prefillKey) {
    setPrefillKey(incomingKey);
    setLinkUrl(initialLinkUrl || '');
    setCaption(CAPTION_TEMPLATE);
    setCampaign('');
    setAsset(null);
    setError(null);
    setOkMsg(null);
    // Flips the graphic box to "fetching" immediately, in this same render — the effect below does the actual fetch and is left
    // with nothing to set synchronously itself (only the async callback after it, once the request has actually returned).
    setPrefilling(!!initialImageUrl);
  }

  // ---- Prefill from the Queue's "Copy" ---------------------------------------------------------------------------------------
  // Same during-render adjustment as above (and the same reason for it), keyed on the handoff's nonce so copying the same row twice
  // still reloads the draft.
  //
  // THE IMAGE IS REUSED, NOT RE-UPLOADED: the original's social_asset row is already a valid public URL, so the copy simply points
  // at it. That is what makes "replace the graphic" work as a normal edit — remove it with the × and upload the fixed file, exactly
  // as for any other post. If it is left alone, both posts reference one asset, and cancel's orphan check (which counts referencing
  // posts before deleting the file) keeps the shared image alive when the original is removed.
  // Mirrored into a ref as well as state: the photo-fetch effect below needs to know, from inside an async callback, whether a copy
  // has landed since it started. State would be stale in that closure; the ref is not.
  const [copyKey, setCopyKey] = useState(0);
  const copyKeyRef = useRef(0);
  if (copyFrom && copyFrom.nonce !== copyKey) {
    setCopyKey(copyFrom.nonce);
    const src = copyFrom.post;
    setCaption(src.caption);
    setCampaign(src.campaign || '');
    setLinkUrl(src.link_url || '');
    setAsset(src.asset);
    setWhen(slotFromIso(src.scheduled_at));
    setReplacing({ id: src.id, scheduledAt: src.scheduled_at });
    setError(null);
    setOkMsg(null);
    setWarnMsg(null);
    setPrefilling(false);
    // Stops the Send-to-Social prefill above from being applied over the top of this copy when ?link=&image= are still sitting in
    // the URL from an earlier visit.
    setPrefillKey(`${initialLinkUrl || ''}|${initialImageUrl || ''}`);
  }

  // Tell the page the handoff has been consumed, so it can drop its copy state.
  //
  // IN AN EFFECT, NOT IN THE BLOCK ABOVE: that block runs during render, and calling a parent's setState from there is the
  // "cannot update a component while rendering a different component" warning. It also genuinely matters that the page clears it —
  // Compose unmounts every time the tab changes, so a copy left sitting in page state would re-prefill this form on the way back
  // and silently resurrect a draft that has already been queued (and whose original is by then deleted).
  useEffect(() => {
    // Ref kept in step with the state here rather than in the render block above — writing a ref during render is what
    // react-hooks/refs forbids, and this runs on commit, long before any in-flight network response could return.
    copyKeyRef.current = copyKey;
    if (copyKey > 0) onCopyHandled?.();
  }, [copyKey, onCopyHandled]);

  // The actual side effect — asking the SERVER to fetch the photo — stays in an effect, keyed on the image URL alone so it fires
  // exactly once per incoming photo. Goes through uploadSocialAssetFromUrl, not a browser fetch(): images.brookfieldcomfort.com
  // sends no CORS headers, so the browser silently blocks reading that response itself, but the API server has no such
  // restriction — see routes/social-asset-upload.js's `source_url` field (host-allowlisted against SSRF). Same
  // validation/conversion pipeline as a manual upload either way, via applyUploadResult.
  useEffect(() => {
    if (!initialImageUrl) return;
    let cancelled = false;
    // A copy that lands WHILE this fetch is in flight must win: the operator switched to the Queue and deliberately loaded a
    // different post, so dropping the product photo on top of it when the request finally returns would silently undo that. The
    // nonce (rather than a plain boolean) keeps a LATER Send-to-Social working — that arrives as a new initialImageUrl, re-runs
    // this effect, and re-reads the nonce as it stands then.
    const copyKeyAtStart = copyKeyRef.current;
    (async () => {
      const res = await uploadSocialAssetFromUrl(initialImageUrl);
      if (cancelled || copyKeyRef.current !== copyKeyAtStart) return;
      applyUploadResult(res);
      setPrefilling(false);
    })();
    return () => { cancelled = true; };
  }, [initialImageUrl, applyUploadResult]);

  async function handleSave() {
    if (!asset) return;
    setSaving(true);
    setError(null);
    setOkMsg(null);
    setWarnMsg(null);

    // Build the instant from the chosen date + slot. `new Date('YYYY-MM-DDTHH:00:00')` (no zone suffix) is read in the BROWSER's zone
    // — Europe/London for this team — and toISOString() converts to UTC, which is what the server stores. Appending a 'Z' or passing
    // the bare string would make it UTC and silently shift the post by an hour during BST.
    const scheduledAt = new Date(`${when.date}T${pad(when.hour)}:00:00`);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      setSaving(false);
      setError('That slot has already passed — pick a later one.');
      return;
    }

    const res = await createSocialPost({
      caption: caption.trim(),
      asset_id: asset.id,
      scheduled_at: scheduledAt.toISOString(),
      platforms: ['FB'],
      ...(linkUrl.trim() ? { link_url: linkUrl.trim() } : {}),
      ...(campaign ? { campaign } : {}),
    });
    if (!res.success) {
      setSaving(false);
      setError(res.error || 'Could not queue that post');
      return;
    }

    const queuedFor = scheduledAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

    /*
     * A REPLACEMENT: now remove the post this one was copied from.
     *
     * ORDER MATTERS — the new post is created FIRST and the original deleted only after that succeeded. The failure the operator
     * can actually recover from is "two posts queued, delete one" (visible in the Queue, one click). The other order risks
     * "original deleted, replacement never saved", which loses the caption with nothing on screen to recover it from.
     *
     * A failure here is therefore NOT an error — the replacement is safely queued. It is a warning, and it has to be loud, because
     * the consequence of ignoring it is that BOTH posts go out to a live 3.3K-follower Page.
     */
    let warning: string | null = null;
    if (replacing) {
      const del = await cancelSocialPost(replacing.id);
      if (!del.success) {
        warning =
          `Queued for ${queuedFor} — but the original post could not be removed (${del.error || 'unknown error'}). ` +
          'It is still scheduled and WILL go out as well. Delete it in the Queue.';
      } else if (!del.data?.deleted) {
        // The server keeps any post that has published somewhere and only cancels what is still pending — so this means the sweep
        // got to the original between Copy and Save. Nothing is broken, but the operator needs to know the old graphic is public.
        warning =
          `Queued for ${queuedFor} — but the original had already been published by then, so it was kept (only its pending ` +
          'targets were cancelled). The old graphic is live on Facebook; remove it there if it should not be.';
      }
    }
    setWarnMsg(warning);
    if (!warning) setOkMsg(`Queued for ${queuedFor}.${replacing ? ' The post it replaced has been removed.' : ''}`);

    setSaving(false);
    // Reset for the next post, but keep the campaign — posts tend to come in runs for the same collection. The caption goes back to
    // the template rather than to empty, so the next post starts from the house format instead of a blank box.
    setAsset(null);
    setCaption(CAPTION_TEMPLATE);
    setLinkUrl('');
    setWhen(nextAvailable());
    setReplacing(null);
    if (fileRef.current) fileRef.current.value = '';
    // Stay on Compose when there is a warning to read — the page normally jumps to the Queue on save, which would unmount this form
    // and take the warning with it. That is fine for the ordinary "queued" confirmation, but not for the one message whose whole
    // point is that something still needs doing.
    onCreated({ stayOnCompose: !!warning });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* What this draft is going to do to the queue, said before it is saved rather than after. Without it, a copied post looks
          exactly like a new one and the operator has no way to tell that queueing it will remove something. Detaching is offered
          because "actually I want both" is a reasonable thing to decide halfway through — and it is one click either way. */}
      {replacing && (
        <div className="lg:col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          <span>
            Replacing the post scheduled for{' '}
            <span className="font-medium">
              {new Date(replacing.scheduledAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
            . It will be removed when you queue this one.
          </span>
          <button
            type="button"
            onClick={() => setReplacing(null)}
            className="font-medium underline underline-offset-2 hover:text-sky-950"
          >
            Keep both instead
          </button>
        </div>
      )}

      {/* ---- The graphic ---- */}
      <div>
        <label className="block text-sm font-medium text-slate-700">Graphic</label>
        <p className="mt-1 text-xs text-slate-500">
          Between 4:5 (portrait) and 1.91:1 (landscape), up to 8MB. Converted to JPEG automatically.
        </p>

        <div className="mt-2">
          {asset ? (
            <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.public_url} alt="Post graphic" className="w-full object-contain" />
              <button
                type="button"
                onClick={() => { setAsset(null); if (fileRef.current) fileRef.current.value = ''; }}
                className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-slate-600 shadow hover:text-slate-900"
                aria-label="Remove image"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
              <div className="border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                {asset.width}×{asset.height} · {(asset.bytes / 1024).toFixed(0)}KB
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || prefilling}
              className="flex h-56 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-brand-400 hover:text-brand-600 disabled:opacity-60"
            >
              {uploading ? (
                <><ArrowUpTrayIcon className="h-8 w-8 animate-pulse" /><span className="text-sm">Uploading…</span></>
              ) : prefilling ? (
                <><ArrowUpTrayIcon className="h-8 w-8 animate-pulse" /><span className="text-sm">Fetching product photo…</span></>
              ) : (
                <><PhotoIcon className="h-8 w-8" /><span className="text-sm">Choose an image</span></>
              )}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      </div>

      {/* ---- The words ---- */}
      <div className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="social-caption" className="block text-sm font-medium text-slate-700">Caption</label>
            <span className="text-xs text-slate-400">{caption.length}</span>
          </div>
          <textarea
            id="social-caption"
            rows={9}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="What's the post about?"
            className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          {/* A nudge, not a block — the body alone is a valid post, just a dull one. */}
          {hookMissing && (
            <p className="mt-1 text-xs text-amber-600">Add your opening line at the top — the bit about this particular product.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="social-campaign" className="block text-sm font-medium text-slate-700">Collection</label>
            <input
              id="social-campaign"
              list="social-campaigns"
              value={campaign}
              onChange={(e) => {
                const v = e.target.value;
                setCampaign(v);
                // Offer the matching collection URL as soon as a known slug is picked — saves typing the same URL every day, but
                // stays editable because not every post points at a collection.
                if (v && CAMPAIGNS.includes(v) && !linkUrl) setLinkUrl(SITE + v);
              }}
              placeholder="birkenstock"
              className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <datalist id="social-campaigns">
              {CAMPAIGNS.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>

          <div>
            <label htmlFor="social-date" className="block text-sm font-medium text-slate-700">Goes out</label>
            <input
              id="social-date"
              type="date"
              value={when.date}
              min={toDateValue(new Date())}
              onChange={(e) => {
                const date = e.target.value;
                // Changing to today can strand the chosen slot in the past — move to the first slot that still works that day.
                const hour = slotIsFuture(date, when.hour)
                  ? when.hour
                  : (SLOT_HOURS.find((h) => slotIsFuture(date, h)) ?? when.hour);
                setWhen({ date, hour });
              }}
              className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            {/* Only four times exist, so they are shown as choices rather than as a free time field that would have to be corrected. */}
            <div className="mt-1.5 flex gap-1">
              {SLOT_HOURS.map((h) => {
                const usable = slotIsFuture(when.date, h);
                const active = when.hour === h;
                return (
                  <button
                    key={h}
                    type="button"
                    disabled={!usable}
                    onClick={() => setWhen({ ...when, hour: h })}
                    title={usable ? undefined : 'That time has already passed today'}
                    className={
                      'flex-1 rounded border px-1 py-1 text-xs font-medium ' +
                      (active
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : usable
                          ? 'border-slate-300 text-slate-600 hover:bg-slate-50'
                          : 'cursor-not-allowed border-slate-200 text-slate-300')
                    }
                  >
                    {slotLabel(h)}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-slate-400">Posts go out at one of these four times.</p>
          </div>
        </div>

        <div>
          <label htmlFor="social-link" className="block text-sm font-medium text-slate-700">Link <span className="font-normal text-slate-400">(optional)</span></label>
          <input
            id="social-link"
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder={SITE + 'birkenstock'}
            className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          {/* What actually goes out, before it goes out. */}
          {linkUrl && (
            preview ? (
              <p className="mt-1.5 break-all rounded bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-500">{preview}</p>
            ) : (
              <p className="mt-1.5 text-xs text-amber-600">That doesn&apos;t look like a valid URL.</p>
            )
          )}
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {/* Amber, not green and not red: the post saved, but something is left for the operator to do. */}
        {warnMsg && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">{warnMsg}</p>}
        {okMsg && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{okMsg}</p>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Queueing…' : replacing ? 'Replace post' : 'Add to queue'}
          </button>
          <span className="text-xs text-slate-400">Facebook · Instagram comes later</span>
        </div>
      </div>
    </div>
  );
}
