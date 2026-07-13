'use client';
/*
=======================================================================================================================================
Component: ProductActions  (the cross-module "act on this style" chooser)
=======================================================================================================================================
Purpose: A single, reusable pop-over that lets the operator jump STRAIGHT from a product they've spotted (in an Analytics table, a
         search list, anywhere a groupid appears) to the place they'd change its price — without going back to the dashboard and in
         through a module front door. It's the answer to "I'm in Analytics, I found a style I want to reprice, take me there."

         Given a groupid it offers three actions:
           - Change Shopify price -> /pricing/style/<groupid>  (the price-change screen itself; deep-link is already supported there).
           - Change Amazon price  -> /amz/sku/<code> when the exact SKU code is known (e.g. an Amazon-channel row), else /amz/find?q=
             <groupid> which pre-searches so the operator picks which size to reprice (Amazon is SKU-grain — one price per size).
           - Copy groupid         -> clipboard, for pasting into any other tool.
           - Copy order <num>     -> clipboard, ONLY when the caller supplies `ordernum` (e.g. a Sales row) — absent everywhere else.

         The target carries `?from=<current path>` so its back link returns the operator to exactly where they were (the drill pages
         already read `from`). Wherever this menu is used, back navigation "just works".

Usage:  const actions = useProductActions();
        <tr onClick={(e) => actions.open(e, groupid, { title, amzCode })}> … </tr>
        {actions.node}            // render once, anywhere in the tree — it portals to <body>

         Rendered as a fixed pop-over at the click point (portalled to <body> so table `overflow`/stacking never clips it), with a
         click-away backdrop and Escape-to-close.
=======================================================================================================================================
*/

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import {
  CurrencyPoundIcon, BuildingStorefrontIcon, ClipboardDocumentIcon, HashtagIcon, CheckIcon,
} from '@heroicons/react/24/outline';

interface MenuState {
  groupid: string;
  title?: string | null;
  amzCode?: string | null;   // when known, the Amazon action deep-links straight to this SKU's drill instead of pre-searching
  ordernum?: string | null;  // when supplied (e.g. a Sales row), adds a "Copy order" action; absent elsewhere so nothing changes there
  x: number;
  y: number;
}

// The hook a page uses: `open(e, groupid, opts)` positions + shows the menu; `node` is the (single) element to render in the tree.
export function useProductActions() {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const open = useCallback(
    (e: React.MouseEvent, groupid: string, opts?: { title?: string | null; amzCode?: string | null; ordernum?: string | null }) => {
      // Stop the click bubbling to any row-level handler and anchor the pop-over at the pointer.
      e.stopPropagation();
      setMenu({ groupid, title: opts?.title ?? null, amzCode: opts?.amzCode ?? null, ordernum: opts?.ordernum ?? null, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const close = useCallback(() => setMenu(null), []);
  const node = <ProductActionMenu menu={menu} onClose={close} />;
  return { open, close, node };
}

const MENU_W = 236; // px — used to clamp the pop-over inside the viewport

function ProductActionMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);  // which value was just copied ('groupid' | 'ordernum'), for the tick

  // Fresh copy state each time the menu (re)opens for a different row.
  useEffect(() => { setCopiedKey(null); }, [menu?.groupid, menu?.x, menu?.y]);

  // Escape closes.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, onClose]);

  if (!menu || typeof document === 'undefined') return null;

  const from = encodeURIComponent(pathname || '/');

  const goShopify = () => {
    router.push(`/pricing/style/${encodeURIComponent(menu.groupid)}?from=${from}`);
    onClose();
  };
  const goAmazon = () => {
    // Direct to the SKU drill when we know the exact code (e.g. an Amazon-channel row); otherwise pre-search by groupid so the
    // operator picks the size (Amazon prices are per-size). Either way carry `from` so the target's "← Back" returns where we came
    // from (the search page reads it too — so a not-on-Amazon jump still breadcrumbs back to Analytics, not to the segment picker).
    const url = menu.amzCode
      ? `/amz/sku/${encodeURIComponent(menu.amzCode)}?from=${from}`
      : `/amz/find?q=${encodeURIComponent(menu.groupid)}&from=${from}`;
    router.push(url);
    onClose();
  };
  // Copy any value to the clipboard; `key` drives which row shows the "Copied" tick. Closes shortly after so the tick is seen.
  const copyVal = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(onClose, 650);
    } catch {
      onClose();
    }
  };

  // Clamp inside the viewport so a click near the right/bottom edge doesn't push the menu off-screen. The menu is one row taller when a
  // "Copy order" action is present.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuH = menu.ordernum ? 232 : 190;
  const left = Math.max(8, Math.min(menu.x, vw - MENU_W - 8));
  const top = Math.max(8, Math.min(menu.y, vh - menuH));

  const item = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50';

  return createPortal(
    <>
      {/* Click-away backdrop (transparent). */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        className="fixed z-50 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        style={{ left, top, width: MENU_W }}
      >
        <div className="border-b border-slate-100 px-3 py-2">
          <div className="font-mono text-xs text-slate-500">{menu.groupid}</div>
          {menu.title && <div className="truncate text-xs text-slate-400">{menu.title}</div>}
        </div>
        <button type="button" role="menuitem" onClick={goShopify} className={item}>
          <CurrencyPoundIcon className="h-4 w-4 text-slate-400" />
          Change Shopify price
        </button>
        <button type="button" role="menuitem" onClick={goAmazon} className={item}>
          <BuildingStorefrontIcon className="h-4 w-4 text-slate-400" />
          Change Amazon price
        </button>
        <button type="button" role="menuitem" onClick={() => copyVal('groupid', menu.groupid)} className={item + ' border-t border-slate-100'}>
          {copiedKey === 'groupid' ? <CheckIcon className="h-4 w-4 text-green-600" /> : <ClipboardDocumentIcon className="h-4 w-4 text-slate-400" />}
          {copiedKey === 'groupid' ? 'Copied' : 'Copy groupid'}
        </button>
        {menu.ordernum && (
          <button type="button" role="menuitem" onClick={() => copyVal('ordernum', menu.ordernum!)} className={item}>
            {copiedKey === 'ordernum' ? <CheckIcon className="h-4 w-4 text-green-600" /> : <HashtagIcon className="h-4 w-4 text-slate-400" />}
            {copiedKey === 'ordernum' ? 'Copied' : 'Copy order number'}
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}
