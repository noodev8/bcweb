'use client';
/*
=======================================================================================================================================
Component: ZoomableThumb
=======================================================================================================================================
Purpose: A small product thumbnail that opens the same picture large when clicked (owner, 2026-09-24, on the Shopify price screen —
         the 56px header thumb says WHICH product, but not whether it's the nappa or the suede, or what the sole looks like).

A NATIVE <dialog>, NOT A HAND-ROLLED OVERLAY. showModal() gives the backdrop, focus trapping and Esc-to-close for free, so there is no
keydown listener to wire up in an effect. A click anywhere on the backdrop (the dialog element itself, not the picture) closes it too.
=======================================================================================================================================
*/

import { useRef } from 'react';
import Image from 'next/image';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface Props {
  src: string;
  alt: string;
  onError?: () => void;   // the host swaps to "no image" on a dead filename, same as before
}

export default function ZoomableThumb({ src, alt, onError }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        title="Click to enlarge"
        className="relative block h-14 w-14 cursor-zoom-in overflow-hidden rounded-md border border-slate-200 bg-white transition hover:border-brand-500"
      >
        <Image src={src} alt={alt} fill sizes="56px" onError={onError} className="object-contain" />
      </button>

      <dialog
        ref={dialogRef}
        // Backdrop click: the event target is the <dialog> itself only when the click landed outside its content box.
        onClick={(e) => { if (e.target === dialogRef.current) dialogRef.current?.close(); }}
        className="rounded-xl bg-white p-0 shadow-2xl backdrop:bg-slate-900/60"
      >
        <div className="relative h-[min(80vh,720px)] w-[min(90vw,720px)]">
          <Image src={src} alt={alt} fill sizes="720px" className="object-contain p-4" />
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close"
            className="absolute right-2 top-2 rounded-md bg-white/80 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      </dialog>
    </>
  );
}
