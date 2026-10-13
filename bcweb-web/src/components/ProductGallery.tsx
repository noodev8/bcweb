'use client';
/*
=======================================================================================================================================
Component: ProductGallery
=======================================================================================================================================
Purpose: The EXTRA images of a product (product_images positions 2..N — docs/product-images-plan.md), on the Add / Modify identity card
         beside the main image. Add several at once, move one left/right, delete one. Every change goes straight to the server, which
         stores the file on one.com (square, 2048 max, never enlarged, SEO-named) and re-pushes the whole gallery to Shopify when the
         product is live — so BCWEB is the one place images are managed (owner, 2026-10-13).

         The main image stays with ImageUploader (Replace) — it is never moved or deleted here. Delete is two clicks (× then "Delete")
         rather than a browser confirm dialog; the armed state has its own cancel ×.

         TEMPORARY (owner, 2026-10-13): with only the main image, "Only one image available" marks the product done for the Missing
         Images counter when no second picture exists (skusummary.single_image_ok_at). Goes with that column after the re-imaging push.
=======================================================================================================================================
*/

import { useRef, useState } from 'react';
import { PlusIcon, ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import { useAuth } from '@/contexts/AuthContext';
import {
  getProductImages, addProductImages, deleteProductImage, moveProductImage, setSingleImageOk, GalleryResult, ShopifyPushResult,
} from '@/lib/api';
import ZoomableThumb from '@/components/ZoomableThumb';
import ShopifyPushNote from '@/components/ShopifyPushNote';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
const MAX_FILES = 10;   // per upload — matches routes/product-images-add.js

export default function ProductGallery({ groupid, title }: { groupid: string; title: string }) {
  const { logout } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, error: loadError, mutate } = useApiQuery(['product-images', groupid], () => getProductImages(groupid));
  const [busy, setBusy] = useState<string | null>(null);         // what's in flight: 'add' | `del-<id>` | `move-<id>`
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<ShopifyPushResult | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const images = data?.images ?? [];
  const extras = images.filter((i) => i.position > 1);
  const total = images.length;

  // One handler for every write: they all return the whole gallery + the Shopify outcome.
  async function run(tag: string, call: () => Promise<{ success: boolean; data?: GalleryResult; error?: string; return_code?: string }>) {
    setBusy(tag);
    setError(null);
    setPush(null);
    const res = await call();
    setBusy(null);
    setConfirmId(null);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return null; }
    if (!res.success || !res.data) { setError(res.error || 'Something went wrong'); return null; }
    await mutate({ groupid, images: res.data.images, single_ok: data?.single_ok }, { revalidate: false });
    setPush(res.data.shopify ?? null);
    return res.data;
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (inputRef.current) inputRef.current.value = '';
    if (!files.length) return;
    if (files.length > MAX_FILES) { setError(`Up to ${MAX_FILES} images at a time`); return; }
    const res = await run('add', () => addProductImages(groupid, files, title));
    if (res && 'failed' in res && Array.isArray(res.failed) && res.failed.length) {
      setError(`Not added: ${res.failed.map((f) => `${f.name} (${f.message})`).join(', ')}`);
    }
  }

  async function markSingle(ok: boolean) {
    setBusy('single');
    setError(null);
    const res = await setSingleImageOk(groupid, ok);
    setBusy(null);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
    if (!res.success) { setError(res.error || 'Something went wrong'); return; }
    await mutate({ groupid, images, single_ok: ok }, { revalidate: false });
  }

  const iconBtn = 'rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Images</span>
        {data && <span className="text-xs text-slate-400">{total} {total === 1 ? 'image' : 'images'}</span>}
      </div>

      <div className="flex flex-wrap items-start gap-2">
        {extras.map((img, idx) => (
          <div key={img.id} className="flex flex-col items-center gap-0.5">
            <ZoomableThumb src={IMAGE_BASE + encodeURIComponent(img.filename)} alt={img.alt || ''} />
            {confirmId === img.id ? (
              // Armed: confirm, or back out with the ×. (A blur-to-cancel was tried — focus left the new button at once and disarmed it.)
              <div className="flex items-center">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(`del-${img.id}`, () => deleteProductImage(groupid, img.id))}
                  className="rounded px-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
                >
                  {busy === `del-${img.id}` ? '…' : 'Delete'}
                </button>
                <button type="button" aria-label="Cancel" disabled={busy !== null} onClick={() => setConfirmId(null)} className={iconBtn}>
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center">
                <button type="button" aria-label="Move left" disabled={busy !== null || idx === 0}
                  onClick={() => run(`move-${img.id}`, () => moveProductImage(groupid, img.id, 'left'))} className={iconBtn}>
                  <ChevronLeftIcon className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="Delete" disabled={busy !== null}
                  onClick={() => setConfirmId(img.id)} className={iconBtn}>
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="Move right" disabled={busy !== null || idx === extras.length - 1}
                  onClick={() => run(`move-${img.id}`, () => moveProductImage(groupid, img.id, 'right'))} className={iconBtn}>
                  <ChevronRightIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}

        <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={onFiles} className="hidden" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null || !data}
          className="flex h-14 w-14 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 text-[11px] text-slate-500 hover:border-brand-400 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'add' ? 'Adding…' : (<><PlusIcon className="h-4 w-4" />Add</>)}
        </button>
      </div>

      {data && total === 1 && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          {data.single_ok ? (
            <>Only one image available · <button type="button" disabled={busy !== null} onClick={() => markSingle(false)}
              className="text-slate-500 underline hover:text-slate-800">Undo</button></>
          ) : (
            <button type="button" disabled={busy !== null} onClick={() => markSingle(true)}
              className="text-slate-500 underline hover:text-slate-800">Only one image available</button>
          )}
        </p>
      )}
      {(error || loadError) && <p className="mt-1.5 text-[11px] text-red-600">{error || loadError?.message}</p>}
      {!error && <ShopifyPushNote result={push} />}
    </div>
  );
}
