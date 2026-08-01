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
         the preview here is a deliberate MIRROR of that rule — see buildPreviewLink. Keep the two in step: utm_medium is always
         'social', utm_source is the platform, utm_campaign is the campaign slug.
=======================================================================================================================================
*/

import { useMemo, useRef, useState } from 'react';
import { PhotoIcon, ArrowUpTrayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { uploadSocialAsset, createSocialPost, SocialAsset } from '@/lib/api';

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

// MIRROR of utils/socialMeta.js -> buildTrackedLink. Preview only; the server builds the real one at publish time. If you change the
// rule, change it there FIRST — that is the canonical copy.
function buildPreviewLink(linkUrl: string, campaign: string): string | null {
  if (!linkUrl) return null;
  try {
    const u = new URL(linkUrl);
    u.searchParams.set('utm_source', 'facebook');
    u.searchParams.set('utm_medium', 'social');
    if (campaign) u.searchParams.set('utm_campaign', campaign);
    return u.toString();
  } catch {
    return null;
  }
}

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

export default function SocialCompose({ onCreated }: { onCreated: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [asset, setAsset] = useState<SocialAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState('');
  const [campaign, setCampaign] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  // Initialised from the clock once, on mount — nextAvailable() is impure, so calling it during render would make the form's opening
  // state depend on when React happens to re-render.
  const [when, setWhen] = useState(nextAvailable);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const preview = useMemo(() => buildPreviewLink(linkUrl, campaign), [linkUrl, campaign]);
  // The chosen slot must still be in the future — picking today then a slot that has already passed is the one way to build an
  // invalid schedule here, and it should disable Save rather than fail on the server.
  const slotStillValid = slotIsFuture(when.date, when.hour);
  const canSave = !!asset && caption.trim().length > 0 && slotStillValid && !saving;

  async function handleFile(file: File | undefined) {
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
  }

  async function handleSave() {
    if (!asset) return;
    setSaving(true);
    setError(null);
    setOkMsg(null);

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
    setSaving(false);

    if (res.success) {
      setOkMsg(`Queued for ${scheduledAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`);
      // Reset for the next post, but keep the campaign — posts tend to come in runs for the same collection.
      setAsset(null);
      setCaption('');
      setLinkUrl('');
      setWhen(nextAvailable());
      if (fileRef.current) fileRef.current.value = '';
      onCreated();
    } else {
      setError(res.error || 'Could not queue that post');
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
              disabled={uploading}
              className="flex h-56 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-brand-400 hover:text-brand-600 disabled:opacity-60"
            >
              {uploading ? (
                <><ArrowUpTrayIcon className="h-8 w-8 animate-pulse" /><span className="text-sm">Uploading…</span></>
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
            rows={6}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="What's the post about?"
            className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-brand-500 focus:ring-brand-500"
          />
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
              className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-brand-500 focus:ring-brand-500"
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
              className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-brand-500 focus:ring-brand-500"
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
            className="mt-1 block w-full rounded-md border-slate-300 text-sm shadow-sm focus:border-brand-500 focus:ring-brand-500"
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
        {okMsg && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{okMsg}</p>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Queueing…' : 'Add to queue'}
          </button>
          <span className="text-xs text-slate-400">Facebook · Instagram comes later</span>
        </div>
      </div>
    </div>
  );
}
