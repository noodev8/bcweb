'use client';
/*
=======================================================================================================================================
Component: StyleThumb
=======================================================================================================================================
Purpose: The list rows' small picture of the shoe — 56px, no taller than a group id + title + size tiles, so it doesn't make a row
         taller. Same image host as the other screens. No image (or a broken one) = an empty box of the same size, so the group ids
         still line up down the list. Used by New Additions and Slow movers (the price drill has its own ZoomableThumb, click to enlarge).
=======================================================================================================================================
*/

import { useState } from 'react';
import Image from 'next/image';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';

export default function StyleThumb({ imagename, alt }: { imagename: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
      {imagename && !failed && (
        <Image src={IMAGE_BASE + imagename} alt={alt} fill sizes="56px" onError={() => setFailed(true)} className="object-contain" />
      )}
    </div>
  );
}
