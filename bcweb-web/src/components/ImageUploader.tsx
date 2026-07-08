'use client';
/*
=======================================================================================================================================
Component: ImageUploader
=======================================================================================================================================
Purpose: The main product image: shows the current image (from images.brookfieldcomfort.com) and lets the user replace it with a
         file-picker. Picking a file uploads it straight away (POST /product-image) — the server converts it to a clean 800x800 JPEG,
         SFTPs it to the image host, and returns the new filename, which we hand back to the page via onUploaded.

         No in-browser editing/cropping — just select a file. After an upload we bump a cache-buster on the <img> src so a
         same-named (overwritten) image refreshes instead of showing the stale cached one.
=======================================================================================================================================
*/

import { useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { uploadProductImage, ShopifyPushResult } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import ShopifyPushNote from '@/components/ShopifyPushNote';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';

export default function ImageUploader({
  groupid, imagename, title, onUploaded,
}: {
  groupid: string;
  imagename: string | null;
  title: string;                       // on-screen title — seeds the SEO filename server-side
  onUploaded: (imagename: string) => void;
}) {
  const { logout } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);      // image failed to load (missing file)
  const [bust, setBust] = useState(0);              // cache-buster, bumped after each successful upload
  const [push, setPush] = useState<ShopifyPushResult | null>(null);  // Shopify re-push outcome, when the product is live

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = ''; // let the same file be re-picked later
    if (!file) return;
    setUploading(true);
    setError(null);
    setPush(null);
    const res = await uploadProductImage(groupid, file, title);
    if (res.success && res.data) {
      setFailed(false);
      setBust((b) => b + 1);
      setPush(res.data.shopify ?? null);
      onUploaded(res.data.imagename);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Upload failed');
    }
    setUploading(false);
  }

  const box = 'flex h-44 w-44 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white';
  const src = imagename && !failed ? `${IMAGE_BASE}${encodeURIComponent(imagename)}${bust ? `?v=${bust}` : ''}` : null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      {src ? (
        <div className={'relative ' + box}>
          {/* key on bust so next/image re-fetches after an overwrite. Host is whitelisted in next.config.js. */}
          <Image key={bust} src={src} alt="" fill sizes="176px" onError={() => setFailed(true)} className="object-contain" />
        </div>
      ) : (
        <div className={box + ' text-center text-[11px] text-slate-400'}>{imagename ? 'Image not found' : 'No image'}</div>
      )}

      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={onFile} className="hidden" />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowUpTrayIcon className="h-3.5 w-3.5" />
        {uploading ? 'Uploading…' : imagename ? 'Replace image' : 'Upload image'}
      </button>
      {error && <span className="max-w-[10rem] text-right text-[11px] text-red-600">{error}</span>}
      {!error && <ShopifyPushNote result={push} />}
    </div>
  );
}
