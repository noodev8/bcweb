'use client';
/*
=======================================================================================================================================
Component: InvBreakdown
=======================================================================================================================================
Purpose: The "why is that number what it is" deep view for one style on the Inventory browse — opened from a card's Breakdown toggle,
         one card at a time, so the browse itself stays light. It answers the rarer questions the card face deliberately omits:
           - the FULL size range including sold-out zeros (the face chips show only in-stock sizes),
           - where every unit sits across the buckets worth acting on (shown in full — opening Breakdown IS the request for detail, so
             there is no second "Show detail" toggle to click; see DETAIL_GROUPS for the buckets deliberately left off),
           - jumping off to reprice the style, open its live product page, or grab its image,
           - and whether it is actually selling (recent sales).

         It is handed the InvStockData the card ALREADY fetched on the first size tap / breakdown open, so opening it costs no extra
         round-trip. The size-grid-and-buckets logic here was ported wholesale from the old InvStockPanel (retired in the 2026-07-23
         browse redesign) — the card owns the image, header and per-size locations now, so this keeps only the grid + actions + sales.

THE 12 BUCKETS (docs/inventory-spec.md §3b/§3c). One Amazon story read left to right by how far the stock has travelled, closing on the
re-order figure (Amz tot); then the Birk pre-order book; then Incoming (strictly not-landed-yet) last, since it is empty for most styles
most of the time. Reorder DETAIL_GROUPS to change the layout; nothing else needs touching.
=======================================================================================================================================
*/

import { useRouter } from 'next/navigation';
import {
  ArrowDownTrayIcon, ArrowUpRightIcon, ChartBarIcon, CurrencyPoundIcon, GlobeAltIcon, MegaphoneIcon, PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { InvStockData, InvBuckets, InvSizeRow } from '@/lib/api';
import CopyButton from '@/components/CopyButton';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
// The public storefront product URL is handle-based (skusummary.handle is the slug). Used to email a customer a link to the live page.
const STORE_PRODUCT_BASE = 'https://brookfieldcomfort.com/products/';

// The one style every action in the jump-off bar shares — see the bar's comment.
const BTN =
  'inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-100';

type DetailCol = {
  key: string;
  label: string;
  title: string;
  get: (s: InvSizeRow) => number;
  getTotal: (t: InvStockData['totals']) => number;
  // Set on a column that is a CONCLUSION rather than a raw bucket, so it is drawn heavier than the buckets around it. Nothing uses it
  // since Amz tot was dropped; kept because the next conclusion column will want it.
  strong?: boolean;
};

// Helper for the plain bucket columns.
const bucket = (key: keyof InvBuckets, label: string, title: string): DetailCol => ({
  key, label, title,
  get: (s) => s.buckets[key],
  getTotal: (t) => t.buckets[key],
});

// `always`: the group shows even when every size reads 0 — see the column filter in the component.
const DETAIL_GROUPS: { group: string; cols: DetailCol[]; always?: boolean }[] = [
  {
    group: 'AMZ',
    always: true,
    cols: [
      // 'Res' (amzAlloc — here but earmarked for Amazon, the C3-Amazon bay) and 'Transit' (collected by DPD in the last 2 days)
      // deliberately NOT shown (owner, 2026-07-27): both are small, rarely acted on directly, and made the AMZ group read as four
      // numbers to weigh when only Live and Tot are decisions. Per-size Res still shows as a LOCATION on the card face, and both
      // buckets are still folded into Tot below — the re-order figure is unchanged, just less noisily explained.
      // 'Inbound' (amztotal - amzlive) deliberately NOT shown (owner, 2026-07-25): amzfeed only stores the live/total split, not
      // Amazon's real reason for the gap (reserved-but-sold, unsellable, researching, or genuinely inbound all read the same), so the
      // label was frequently wrong — e.g. a unit sold minutes ago reads as "1 inbound" until Amazon's next feed sync ships it out.
      // Live and Tot are both raw amzfeed values and stay trustworthy on their own; the gap is still folded into Tot below, just unlabelled.
      // 'Tot' (amazonTotal, the re-order figure) dropped with them (owner, 2026-07-27): once its components were hidden it was an
      // unexplained roll-up, and with Live the only AMZ number left on the grid the roll-up had nothing left to summarise.
      bucket('amzLive', 'Live', 'Sellable FBA stock at Amazon'),
    ],
  },
  {
    group: 'Birk PO',
    cols: [
      {
        key: 'birkOnOrder', label: 'On order',
        title: 'Birkenstock pre-order book: units requested minus those already arrived (arrived stock is counted in Local)',
        get: (s) => s.birkOnOrder,
        getTotal: (t) => t.birkOnOrder,
      },
    ],
  },
  {
    group: 'Incoming',
    always: true,
    cols: [
      bucket('onOrderLocal', 'SHP', 'Ordered for us (orderstatus type 2), not yet arrived'),
      bucket('onOrderAmz', 'AMZ', 'Ordered for Amazon (orderstatus type 3), not yet arrived — counted in the AMZ Total'),
    ],
  },
];

// Print the human-entered size label (skumap.optionsize: "38 EU / 5 UK", or just "5 UK" on a UK-sized brand) — do not derive it. The
// fallback only fires if it is blank (none are today) and deliberately does not reconstruct the EU/UK pair.
function sizeLabel(s: { sizeDisplay: string | null; eu: string; uksize: string | null }): string {
  return s.sizeDisplay || s.uksize || s.eu;
}

export default function InvBreakdown({ data, onLeave }: {
  data: InvStockData;
  // Called just before a SAME-TAB jump away (Shopify, Amazon, Sales, Send to Social), so /inventory can save the operator's place and
  // put them back on this card, Detail open, when they return. See RETURN TO YOUR PLACE in app/inventory/page.tsx.
  onLeave?: () => void;
}) {
  const router = useRouter();

  // Only the bucket columns that hold something for THIS style (owner, 2026-09-24). Most styles have nothing at Amazon, on the Birk
  // book or incoming, and three groups of greyed zeros buried the two numbers that matter (Local, Total). A group with no live columns
  // drops out entirely; its header goes with it. EXCEPT AMZ and Incoming, which always show (owner, 2026-09-24): "none at Amazon" and
  // "nothing on the way" are answers the operator wants to read off the grid, so their zeros are shown rather than left to be inferred
  // from a gap. Only Birk PO still hides when empty — it is Birkenstock-only, so on most styles it could never hold anything.
  const groups = DETAIL_GROUPS
    .map((g) => ({ ...g, cols: g.always ? g.cols : g.cols.filter((c) => c.getTotal(data.totals) > 0) }))
    .filter((g) => g.cols.length > 0);
  const colCount = groups.reduce((n, g) => n + g.cols.length, 0);
  const src = data.imagename ? IMAGE_BASE + data.imagename : null;
  const productUrl = data.handle ? STORE_PRODUCT_BASE + data.handle : null;

  // Send to Social — hand this style's live link + photo to Marketing, no auto-post. Both are already on hand (this panel only
  // opens once /inv-stock has loaded), so this is just a navigation, not a fetch: lands on /social?link=&image=, which prefills a
  // fresh Compose draft and stops there — caption, collection, timing and "Add to queue" stay the operator's.
  const sendToSocial = () => {
    const params = new URLSearchParams();
    if (productUrl) params.set('link', productUrl);
    if (src) params.set('image', src);
    onLeave?.();
    router.push(`/social?${params.toString()}`);
  };

  // SALES replaced the inline recent-sales panel (owner, 2026-09-24): the panel was a pricing question squatting on a stock screen, and
  // Analytics → Sales answers it properly (12 months, every channel, returns netted). SAME TAB, not new — on the owner's condition that
  // coming back lands on this card with Detail still open; onLeave saves that, and the Sales screen's Back (from=/inventory) or the
  // browser's Back both return to it. The groupid seeds Sales' Contains box, which matches groupid as a substring.
  // SHOPIFY / AMAZON pricing moved to the same tab too (owner, 2026-09-24), on the same terms. Both screens already honour ?from= for
  // their Back link, so passing /inventory is all it takes; Amazon's Find threads it on through to the SKU drill and back.
  const leaveTo = (path: string, params: Record<string, string>) => {
    onLeave?.();
    router.push(`${path}?${new URLSearchParams({ ...params, from: '/inventory' }).toString()}`);
  };
  const openSales = () => leaveTo('/analytics/sales', { q: data.groupid, back: 'Inventory' });
  const openShopify = () => leaveTo(`/pricing/style/${encodeURIComponent(data.groupid)}`, {});
  const openAmazon = () => leaveTo('/amz/find', { q: data.groupid });

  return (
    <div className="border-t border-slate-200 bg-slate-50/40">
      {/* ---- Jump-off actions. Price this style, see its sales, open its live page, or grab the image. Shopify, Amazon, Sales and
              Social stay in THIS tab and save the operator's place first (onLeave); Edit product and Product page still open a new tab.
              Shopify is groupid-grain (straight to the drill); Amazon is per-size, so it opens the Find screen pre-filled. ---- */}
      {/* ONE button style for every action (owner, 2026-09-24): the old bar mixed green/amber/brand tints, pipe separators and
          emoji ↗ glyphs, and read as six unrelated widgets. Now they are one row of equal neutral buttons; a new-tab jump carries the
          same small outbound icon on the right. */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 text-xs">
        <button type="button" onClick={openShopify} title="Price this style on Shopify" className={BTN}>
          <CurrencyPoundIcon className="h-3.5 w-3.5 text-slate-400" /> Shopify
        </button>
        <button type="button" onClick={openAmazon} title="Price this style's sizes on Amazon" className={BTN}>
          <CurrencyPoundIcon className="h-3.5 w-3.5 text-slate-400" /> Amazon
        </button>
        <button type="button" onClick={openSales} title="This style's sales, last 12 months, all channels" className={BTN}>
          <ChartBarIcon className="h-3.5 w-3.5 text-slate-400" /> Sales
        </button>
        {/* Edit the product itself — title, attributes, sizes, images — one hop from the shelf, opens in a new tab (unlike the
            pricing jumps). groupid-grain, so /products opens straight on this style's edit panel (it searches and selects on arrival). */}
        <a
          href={`/products?groupid=${encodeURIComponent(data.groupid)}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open this product in Add / Modify (new tab)"
          className={BTN}
        >
          <PencilSquareIcon className="h-3.5 w-3.5 text-slate-400" /> Edit product
          <ArrowUpRightIcon className="h-3 w-3 text-slate-400" />
        </a>
        {productUrl && (
          // The copy-link icon sits INSIDE the same bordered group as its button, so it reads as part of "Product page" rather than
          // a stray glyph floating between two buttons.
          <span className="inline-flex items-center rounded border border-slate-200 bg-white">
            <a
              href={productUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the live product page (new tab)"
              className="inline-flex items-center gap-1 rounded-l px-2 py-1 font-medium text-slate-600 hover:bg-slate-100"
            >
              <GlobeAltIcon className="h-3.5 w-3.5 text-slate-400" /> Product page
              <ArrowUpRightIcon className="h-3 w-3 text-slate-400" />
            </a>
            <CopyButton value={productUrl} label="product page link" className="self-stretch rounded-l-none border-l border-slate-200 px-1.5" />
          </span>
        )}
        {src && (
          <a
            href={src}
            download={data.imagename || undefined}
            target="_blank"
            rel="noopener noreferrer"
            title="Download this image"
            className={BTN}
          >
            <ArrowDownTrayIcon className="h-3.5 w-3.5 text-slate-400" /> Image
          </a>
        )}
        {(productUrl || src) && (
          <button
            type="button"
            onClick={sendToSocial}
            title="Load this product's link and photo into a new Social post — nothing posts or queues until you do"
            className={BTN}
          >
            <MegaphoneIcon className="h-3.5 w-3.5 text-slate-400" /> Send to Social
          </button>
        )}
      </div>

      {/* ---- Full size grid: EVERY size from skumap, sold-out ones reading 0 (the face chips show only in-stock sizes). Show detail
              expands the same grid to the twelve buckets, scrolling inside its own box so the card never scrolls sideways. ---- */}
      <div className="border-t border-slate-200 px-4 pb-3 pt-3">
        {/* Always scrolls inside its own box — the bucket grid is wide, but the card/page never scrolls sideways. */}
        <div className="overflow-x-auto">
          {/* w-auto, not w-full: every numeric column is fixed width, so a full-width table would dump the slack into the Size column. */}
          <table className="w-auto text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="text-[10px] text-slate-400">
                <th className="py-1 pr-3" />
                <th className={`py-1 px-3 ${colCount ? 'border-r-2 border-slate-200' : ''}`} colSpan={2} />
                {/* Group label alignment follows the group's width: a ONE-column group right-aligns, so the group word, its column
                    label and the numbers below all sit on the same right edge (centring it left the word visibly adrift of its own
                    data). Two or more columns still centre, spanning them. Padding matches the column cells either way. */}
                {groups.map((g) => (
                  <th
                    key={g.group}
                    colSpan={g.cols.length}
                    className={`border-l border-slate-200 py-1 px-2 font-medium ${g.cols.length === 1 ? 'text-right' : 'text-center'}`}
                  >
                    {g.group}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-slate-200">
                <th className="py-1.5 pr-6 font-medium">Size</th>
                {/* Local first, then Total, with a real rule after Total to mark where "the answer" ends and "the evidence" begins. */}
                {/* Wider than Total because it is the only column that can carry a tag (the "Pick n" chip). Sized so the number and
                    the chip sit on ONE line — at w-16 the chip wrapped and made that size's row double-height, which read as an
                    error in the grid rather than a note on the number (owner, 2026-08-18). */}
                <th className="w-28 py-1.5 px-3 text-right font-semibold text-slate-700">Local</th>
                <th className={`w-16 py-1.5 pl-3 pr-4 text-right font-semibold text-slate-700 ${colCount ? 'border-r-2 border-slate-200' : ''}`}>Total</th>
                {groups.map((g) =>
                  g.cols.map((c, i) => (
                    <th
                      key={c.key}
                      title={c.title}
                      className={`w-14 whitespace-nowrap py-1.5 px-2 text-right font-medium ${i === 0 ? 'border-l border-slate-200' : ''} ${c.strong ? 'text-slate-700' : ''}`}
                    >
                      {c.label}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* NO row hover. These rows are read-only: locations and +/- live on the size chips on the card face. A hover highlight
                  advertised a click that never landed, and operators were tapping size rows here expecting the racks panel (owner,
                  2026-07-27). If these rows are ever made to open that panel, bring the hover back with it. */}
              {data.sizes.map((s) => (
                <tr key={s.code}>
                  <td className="whitespace-nowrap py-1.5 pr-6 text-slate-700">{sizeLabel(s)}</td>
                  {/* Zeros greyed rather than blank. Local carries a "Pick n" tag when some of it is committed to an order — the units
                      are still on the shelf, but an operator about to promise the last pair needs to see it is spoken for. */}
                  <td className={`whitespace-nowrap py-1.5 px-3 text-right font-semibold tabular-nums ${s.local ? 'text-slate-900' : 'text-slate-300'}`}>
                    {/* Chip BEFORE the number, not after: this is a right-aligned numeric column, so a tag on the right pushes the
                        digit out of the column of digits and the eye loses the vertical line it was scanning. On the left the tag
                        hangs off into the column's slack and every Local figure still shares one right edge. leading-none keeps it
                        from growing the row. */}
                    {s.buckets.picked > 0 && (
                      <span
                        title={`${s.buckets.picked} of these ${s.buckets.picked === 1 ? 'is' : 'are'} picked for a customer order — still on the shelf, but spoken for`}
                        className="mr-1.5 rounded bg-amber-50 px-1 py-0.5 align-middle text-[10px] font-medium leading-none text-amber-700"
                      >
                        Pick {s.buckets.picked}
                      </span>
                    )}
                    {s.local}
                  </td>
                  <td className={`py-1.5 pl-3 pr-4 text-right font-semibold tabular-nums ${s.total ? 'text-slate-900' : 'text-slate-300'} ${colCount ? 'border-r-2 border-slate-200' : ''}`}>{s.total}</td>
                  {groups.map((g) =>
                    g.cols.map((c, i) => {
                      const v = c.get(s);
                      return (
                        <td
                          key={c.key}
                          className={`py-1.5 px-2 text-right tabular-nums ${v ? (c.strong ? 'font-semibold text-slate-900' : 'text-slate-700') : 'text-slate-300'} ${i === 0 ? 'border-l border-slate-100' : ''}`}
                        >
                          {v}
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
              {data.sizes.length === 0 && (
                <tr>
                  <td colSpan={3 + colCount} className="py-4 text-center text-sm text-slate-400">No sizes set up for this style.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
