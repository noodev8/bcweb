'use client';
/*
=======================================================================================================================================
Page: /pricing/style-price?g=<groupid>  (Style price — one style, every channel)
=======================================================================================================================================
Purpose: The owner's single-job price screen (2026-11-18): "a screen that focusses on price for one GROUPID … One place to see the stock
         and prices and one place to set a single price. Then be able to adjust the price for any size/channel. For eBay, be able to
         send to eBay and/or price there too." Typical use: clearing a style — drop it across every channel at once.

         MINIMAL ON PURPOSE (owner: "as minimal as possible for a single job") — no sales, no history, no Buy Box suggestion (owner:
         "keep the buy box suggestion out for now"). Clearance stays its own screen.

LAYOUT (owner, 2026-11-18: "group the sections better"): a compact search, then four cards top to bottom — the STYLE (cost, RRP,
stock), SET PRICES (one price, channel ticks, Reset; review chips under), THE PRICES (a "Whole style" row, then a row per size; one
column per channel, grey boxes the width of a price box) and COMMIT (sticky at the bottom: a live count of what will be sent, any
problem, then each write's result).

HOW IT WORKS — NOTHING IS SENT UNTIL COMMIT (owner: "only set it on the screen display, allowing me to adjust anything before pressing
the final price commit which sends all the prices"):
  1. One price + channel ticks → as it is typed, it fills every open cell of the ticked channels (Shopify: the style price and every size). The SAME figure on every channel (owner); each column says where the customer pays postage.
  2. Any cell can then be changed by hand — every cell always holds a figure to adjust (a Shopify size shows the style price unless
     it has its own; sizes on the style price follow it when it changes). A changed cell is highlighted with its current price under it.
  3. One review chip (None · 3 · 7 · 14 · 30 · Season) OVERWRITES ALL (owner): the Shopify style's review date and every Amazon size's.
  Reset puts every cell, tick and the review chip back to what was loaded (nothing sent).
  4. Send prices ("Send prices & list on eBay" when List on eBay is ticked) → confirm → each change goes through its channel's OWN write, one at a time, each line ticked or showing the refusal.
     One channel failing never undoes another (each write is its own transaction, as every bulk price move — CLAUDE.md).

GREY = no price on that channel for that size (owner): Shopify size cells need stock (a size price needs stock — utils/sizePrice.js);
Amazon needs an amzfeed row (listed by us); eBay needs the size on our live listing, or — when the style isn't on eBay — tick "List on
eBay" and the sizes the List would send open up (Birkenstock never goes on eBay).

THE WRITES (none restated here — server routes are THE rules):
  Shopify style  W1 POST /pricing-apply (note "Style price"), or POST /pricing-park when only the review changes.
  Shopify size   POST /pricing-size-price-set (must be below the style price; set AFTER the style) / -clear when back to the style
                 price. W1 already ends a size price the new style price reaches — a clear then answers NOT_SET, counted as done.
  Amazon size    W-A1 POST /amz-apply (sends to Amazon after commit); POST /amz-review for listed sizes whose price didn't change.
  eBay size      POST /ebay-size-price (live listing), or POST /ebay-list for the whole style with every open size's figure.
Nothing blocks a price: below cost (Amazon: cost + FBA fee; eBay/Shopify: cost) and over RRP are flagged only.
=======================================================================================================================================
*/

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import {
  findProducts, getStylePrice, applyPrice, parkStyle, setSizePrice, clearSizePrice, applyAmzPrice, markAmzReviewed,
  setEbaySizePrice, listOnEbay, type FindRow, type StylePriceHeader, type StylePriceRow,
} from '@/lib/api';
import { REVIEW_PERIODS, seasonPark } from '@/lib/reviewPeriods';
import { prettyPathLabel } from '@/lib/nav';
import { useApiQuery } from '@/lib/useApiQuery';
import BrandRrpNote from '@/components/BrandRrpNote';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
const NOTE = 'Style price';
const NO_RESULTS: FindRow[] = [];

type Channel = 'shopify' | 'amazon' | 'ebay';
type Cells = Record<string, string>;   // code -> typed price ('' = Shopify: follows the style price)

const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `£${v.toFixed(2)}`);
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : v.toFixed(2));
// A typed price: > 0, rounded to the penny; null when blank or not a number.
function parse(s: string): number | null {
  const n = Number(s.replace(/[£,\s]/g, ''));
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
const same = (a: number | null, b: number | null) => (a === null ? b === null : b !== null && Math.abs(a - b) < 0.005);

export default function StylePricePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <StylePriceContent />
    </Suspense>
  );
}

function StylePriceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupid = (searchParams.get('g') || '').trim();
  const from = searchParams.get('from') || '';
  const backHref = from || '/dashboard';
  const backLabel = from ? prettyPathLabel(from) : 'Dashboard';

  const go = (g: string) => {
    const qs = new URLSearchParams({ g });
    if (from) qs.set('from', from);
    router.push(`/pricing/style-price?${qs.toString()}`);
  };

  return (
    <AppShell title="Style price" backHref={backHref} backLabel={backLabel}>
      <Search initial={groupid} onPick={go} />
      {groupid && <StyleEditor key={groupid} groupid={groupid} />}
    </AppShell>
  );
}

// ---- Search: a group id or title; one exact hit opens straight away, otherwise pick from the list. ----------------------------------
function Search({ initial, onPick }: { initial: string; onPick: (g: string) => void }) {
  const [term, setTerm] = useState(initial);
  const [q, setQ] = useState('');
  const { data, busy, error } = useApiQuery(q ? ['find-products', q] : null, () => findProducts(q));
  const results = q ? data ?? NO_RESULTS : NO_RESULTS;

  return (
    <div className="mb-4 max-w-md">
      <form onSubmit={(e) => { e.preventDefault(); setQ(term.trim()); }} className="flex gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
          <input value={term} onChange={(e) => setTerm(e.target.value.toUpperCase())} autoFocus={!initial}
            placeholder="Group ID or product name"
            className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
        <button type="submit" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Find</button>
      </form>
      {busy && <p className="mt-2 text-sm text-slate-400">Searching…</p>}
      {error && <p className="mt-2 text-sm text-red-700">{error.message}</p>}
      {q && !busy && !error && results.length === 0 && <p className="mt-2 text-sm text-slate-400">No matches.</p>}
      {results.length > 0 && (
        <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-white text-sm shadow-sm">
          {results.map((r) => (
            <li key={r.groupid}>
              <button type="button" onClick={() => { setQ(''); setTerm(r.groupid); onPick(r.groupid); }}
                className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-slate-50">
                <span className="font-mono text-xs text-slate-600">{r.groupid}</span>
                <span className="flex-1 truncate text-slate-700">{r.title}</span>
                <span className="text-slate-500">{money(r.now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- The editor ----------------------------------------------------------------------------------------------------------------------
interface Step { label: string; run: () => Promise<{ ok: boolean; msg?: string }> }
interface Done { label: string; ok: boolean; msg?: string }

function StyleEditor({ groupid }: { groupid: string }) {
  const { data, error, isLoading, refresh } = useApiQuery(['style-price', groupid], () => getStylePrice(groupid));
  // Reset (owner, 2026-11-18): bumping this remounts the editor, so every cell goes back to the live figures as loaded.
  const [resets, setResets] = useState(0);
  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (error) return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div>;
  if (!data) return null;
  // Keyed on the loaded figures, so a refresh after Commit starts the staging over from what is now live.
  return <Editor key={`${resets}:${JSON.stringify(data)}`} header={data.header} rows={data.rows} onCommitted={refresh}
    onReset={() => setResets((n) => n + 1)} />;
}

function Editor({ header: h, rows, onCommitted, onReset }: {
  header: StylePriceHeader; rows: StylePriceRow[]; onCommitted: () => void; onReset: () => void;
}) {
  // Staged figures — what is on screen, not yet sent.
  const [style, setStyle] = useState(str(h.shopify.price));
  // Every Shopify size cell always holds a price (owner, 2026-11-18: "have the price in EACH of the sizes and allow me to adjust it"):
  // its own size price, else the style price. A size whose figure equals the style price FOLLOWS it — change the style price and those
  // sizes move with it; a size given its own figure keeps it.
  const [shop, setShop] = useState<Cells>(() => Object.fromEntries(rows.map((r) => [r.code, str(r.shopify.size_price ?? h.shopify.price)])));
  function changeStyle(v: string) {
    const old = parse(style);
    setStyle(v);
    setShop((c) => Object.fromEntries(Object.entries(c).map(([code, x]) => {
      const n = parse(x);
      return [code, x.trim() === '' || (old !== null && n !== null && same(n, old)) ? v : x];
    })));
  }
  const [amz, setAmz] = useState<Cells>(() => Object.fromEntries(rows.map((r) => [r.code, str(r.amazon.price)])));
  const listable = !!h.ebay_list && h.ebay_list.status !== 'missing';
  const [listEbay, setListEbay] = useState(false);
  const [ebayStyle, setEbayStyle] = useState(h.ebay_list?.style || '');
  const [ebayMaterial, setEbayMaterial] = useState(h.ebay_list?.material || '');
  const [ebay, setEbay] = useState<Cells>(() => Object.fromEntries(rows.map((r) =>
    [r.code, r.ebay.state === 'could' ? str(h.ebay_list?.sizes[r.code] ?? null) : str(r.ebay.price)])));

  const [one, setOne] = useState('');
  const [ticks, setTicks] = useState<Record<Channel, boolean>>({ shopify: true, amazon: true, ebay: true });
  const [review, setReview] = useState<number | null>(null);
  const season = seasonPark();

  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Done[] | null>(null);

  const ebayOpen = (r: StylePriceRow) => r.ebay.state === 'on' || (r.ebay.state === 'could' && listEbay && r.ebay.open);
  const hasEbay = rows.some((r) => r.ebay.state === 'on') || listable;
  const hasAmz = rows.some((r) => r.amazon.open);

  // One price goes on screen AS IT IS TYPED (owner, 2026-11-18: no "Set on screen" button — "just do it anyway after making a change"),
  // into the ticked channels; ticking a channel later puts the current one price into it too. The raw text is copied (not 2dp) so the
  // cells read exactly what is being typed; Commit rounds to the penny.
  function applyOne(raw: string, on: Record<Channel, boolean>) {
    if (parse(raw) === null) return;
    const v = raw.trim();
    if (on.shopify) {
      setStyle(v);
      setShop(Object.fromEntries(rows.map((r) => [r.code, v])));   // every size to the one price (= the style price, so no size price)
    }
    if (on.amazon) setAmz((c) => ({ ...c, ...Object.fromEntries(rows.filter((r) => r.amazon.open).map((r) => [r.code, v])) }));
    if (on.ebay) {
      if (listable) setListEbay(true);
      setEbay((c) => ({ ...c, ...Object.fromEntries(rows.filter((r) => r.ebay.state === 'on' || r.ebay.open).map((r) => [r.code, v])) }));
    }
    setConfirming(false);
    setDone(null);
  }

  // ---- What Commit would send -----------------------------------------------------------------------------------------------------
  const stylePrice = parse(style);
  const plan = useMemo(() => {
    const problems: string[] = [];
    const steps: Step[] = [];
    const counts = { shopify: 0, sizes: 0, amazon: 0, amazonReview: 0, ebay: 0 };

    // Shopify style (W1), or only its review (park).
    const styleChanged = stylePrice !== null && !same(stylePrice, h.shopify.price);
    if (style.trim() !== '' && stylePrice === null) problems.push('The Shopify style price isn’t a price.');
    if (styleChanged) {
      counts.shopify = 1;
      steps.push({ label: `Shopify style ${money(h.shopify.price)} → ${money(stylePrice)}`, run: async () => {
        const r = await applyPrice(h.groupid, stylePrice!, review, NOTE);
        if (!r.success) return { ok: false, msg: r.error };
        const s = r.data?.shopify;
        return { ok: true, msg: s && !s.pushed ? `saved, Shopify push failed: ${s.message || s.error || 'unknown'}` : undefined };
      } });
    } else if (review !== null) {
      steps.push({ label: 'Shopify style review', run: async () => {
        const r = await parkStyle(h.groupid, review);
        return { ok: r.success, msg: r.error };
      } });
    }

    // Shopify size prices — after the style price, so "below the style price" is judged against the new one.
    const effStyle = stylePrice ?? h.shopify.price;
    for (const r of rows) {
      if (!r.shopify.open) continue;
      const typed = shop[r.code] ?? '';
      let want = typed.trim() === '' ? null : parse(typed);
      if (typed.trim() !== '' && want === null) { problems.push(`Shopify ${r.size}: not a price.`); continue; }
      if (want !== null && effStyle !== null && same(want, effStyle)) want = null;   // = the style price → no size price
      if (want !== null && effStyle !== null && want > effStyle) {
        problems.push(`Shopify ${r.size}: a size price must be below the style price (${money(effStyle)}) — raise the style price instead.`);
        continue;
      }
      if (same(want, r.shopify.size_price)) continue;
      counts.sizes++;
      if (want === null) {
        steps.push({ label: `Shopify ${r.size} back to the style price`, run: async () => {
          const x = await clearSizePrice(r.code);
          return x.success || x.return_code === 'NOT_SET' ? { ok: true } : { ok: false, msg: x.error };
        } });
      } else {
        steps.push({ label: `Shopify ${r.size} size price ${money(r.shopify.size_price)} → ${money(want)}`, run: async () => {
          const x = await setSizePrice(r.code, want!);
          return { ok: x.success, msg: x.error };
        } });
      }
    }

    // Amazon — a price change carries the review; an unchanged listed size takes the review alone (one call for them all).
    const reviewOnly: string[] = [];
    for (const r of rows) {
      if (!r.amazon.open) continue;
      const typed = amz[r.code] ?? '';
      if (typed.trim() === '' && r.amazon.price === null) continue;   // no price there yet and none typed — leave it
      const want = parse(typed);
      if (want === null) { problems.push(`Amazon ${r.size}: not a price.`); continue; }
      if (same(want, r.amazon.price)) { if (review !== null) reviewOnly.push(r.code); continue; }
      counts.amazon++;
      steps.push({ label: `Amazon ${r.size} ${money(r.amazon.price)} → ${money(want)}`, run: async () => {
        const x = await applyAmzPrice(r.code, want, NOTE, review);
        if (!x.success) return { ok: false, msg: x.error };
        const a = x.data?.amazon;
        return { ok: true, msg: a && !a.sent ? `saved — Amazon hasn’t taken it yet${a.message ? `: ${a.message}` : ''} (Send to Amazon / Update Orders retries)` : undefined };
      } });
    }
    if (reviewOnly.length) {
      counts.amazonReview = reviewOnly.length;
      steps.push({ label: `Amazon review on ${reviewOnly.length} unchanged size${reviewOnly.length === 1 ? '' : 's'}`, run: async () => {
        const x = await markAmzReviewed(reviewOnly, review!, NOTE);
        return { ok: x.success, msg: x.error };
      } });
    }

    // eBay — per size on the live listing, or the whole style as a new listing.
    if (listEbay && listable) {
      const prices: Record<string, number> = {};
      for (const r of rows.filter((x) => x.ebay.state === 'could' && x.ebay.open)) {
        const p = parse(ebay[r.code] ?? '');
        if (p === null) problems.push(`eBay ${r.size}: needs a price to list.`);
        else prices[r.code] = p;
      }
      if (!ebayStyle.trim() || !ebayMaterial.trim()) problems.push('eBay listing needs a Style and a Material.');
      const n = Object.keys(prices).length;
      counts.ebay = n;
      steps.push({ label: `List on eBay — ${n} size${n === 1 ? '' : 's'}, free postage`, run: async () => {
        const x = await listOnEbay(h.groupid, prices, ebayStyle.trim(), ebayMaterial.trim());
        return { ok: x.success, msg: x.success ? x.data?.url : x.error };
      } });
    } else {
      for (const r of rows) {
        if (r.ebay.state !== 'on') continue;
        const want = parse(ebay[r.code] ?? '');
        if (want === null) { problems.push(`eBay ${r.size}: not a price.`); continue; }
        if (same(want, r.ebay.price)) continue;
        counts.ebay++;
        steps.push({ label: `eBay ${r.size} ${money(r.ebay.price)} → ${money(want)}`, run: async () => {
          const x = await setEbaySizePrice(r.code, want);
          return { ok: x.success, msg: x.error };
        } });
      }
    }
    return { steps, problems, counts };
  }, [style, stylePrice, shop, amz, ebay, listEbay, listable, ebayStyle, ebayMaterial, review, rows, h]);

  async function commit() {
    setRunning(true);
    const out: Done[] = [];
    for (const s of plan.steps) {
      let res: { ok: boolean; msg?: string };
      try { res = await s.run(); } catch (e) { res = { ok: false, msg: e instanceof Error ? e.message : 'Network error' }; }
      out.push({ label: s.label, ...res });
      setDone([...out]);
    }
    setRunning(false);
    setConfirming(false);
    if (out.every((d) => d.ok)) onCommitted();   // all through → reload from live; a failure keeps the screen so it can be fixed
  }

  // A size of a listed style that isn't on the listing (no stock yet). Update Orders adds it when it has stock, at ITS default price —
  // its Amazon price, else the Shopify style price + £4.50 (utils/ebayListingRules.js → sizePriceFor, THE copy). Shown read-only from
  // the figures ON SCREEN, so a new Amazon price here shows what eBay will take. No price can be set ahead: there is no eBay offer yet.
  const ebayLater = (r: StylePriceRow): number | null => {
    const a = r.amazon.open ? parse(amz[r.code] ?? '') : null;
    if (a !== null) return a;
    return stylePrice !== null ? Math.round((stylePrice + h.ebay.uplift) * 100) / 100 : null;
  };

  // ---- Flags (never blocks) -------------------------------------------------------------------------------------------------------
  const flag = (p: number | null, floor: number | null) => {
    if (p === null) return null;
    if (floor !== null && p < floor) return <span className="text-[11px] font-medium text-red-600">below cost</span>;
    if (h.rrp !== null && p > h.rrp) return <span className="text-[11px] font-medium text-amber-700">over RRP</span>;
    return null;
  };

  const local = rows.reduce((a, r) => a + r.local, 0);
  const fba = rows.reduce((a, r) => a + r.fba, 0);
  const c = plan.counts;
  const total = c.shopify + c.sizes + c.amazon + c.ebay;

  const changeList = [c.shopify && 'Shopify style', c.sizes && `${c.sizes} Shopify size${c.sizes === 1 ? '' : 's'}`,
    c.amazon && `${c.amazon} Amazon`, c.ebay && (listEbay ? `list ${c.ebay} on eBay` : `${c.ebay} eBay`)].filter(Boolean).join(' · ');
  const canCommit = plan.steps.length > 0 && plan.problems.length === 0 && !running;

  return (
    <div className="max-w-5xl space-y-4 pb-4">
      {/* 1. THE STYLE — what it is and what it holds. */}
      <section className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        {h.imagename && (
          <Image src={IMAGE_BASE + h.imagename} alt="" width={56} height={56} unoptimized className="h-14 w-14 rounded object-contain" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-slate-900">{h.title || h.groupid}</div>
          <div className="font-mono text-xs text-slate-500">{h.groupid}</div>
          {/* The brand asked for RRP on a channel — a reminder only (owner, 2026-11-18). Shopify against its style price; Amazon
              prices per size, so that one stays a plain reminder. */}
          <BrandRrpNote brand={h.brand} channel="SHP" rrp={h.rrp} price={h.shopify.price} className="mt-0.5 text-xs" />
          <BrandRrpNote brand={h.brand} channel="AMZ" rrp={h.rrp} price={null} className="mt-0.5 text-xs" />
        </div>
        <div className="flex gap-6">
          <Stat label="Cost" value={money(h.cost)} />
          <Stat label="RRP" value={money(h.rrp)} />
          <Stat label="Local" value={String(local)} />
          <Stat label="FBA" value={String(fba)} />
        </div>
      </section>

      {/* 2. SET PRICES — the one price (applied as typed), which channels it goes to, the review, and Reset. */}
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            One price
            <MoneyInput value={one} onChange={(v) => { setOne(v); applyOne(v, ticks); }} />
          </label>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500">to</span>
            {(['shopify', 'amazon', 'ebay'] as Channel[]).map((ch) => {
              const avail = ch === 'shopify' || (ch === 'amazon' ? hasAmz : hasEbay);
              return (
                <Tick key={ch} on={ticks[ch] && avail} disabled={!avail} label={CHANNEL_NAME[ch]}
                  onChange={(v) => {
                    setTicks((t) => ({ ...t, [ch]: v }));
                    if (v) applyOne(one, { shopify: false, amazon: false, ebay: false, [ch]: true });
                  }} />
              );
            })}
          </div>
          <button type="button" disabled={running} onClick={onReset} title="Put every price back to what is live now"
            className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            Reset
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="mr-1 text-sm font-medium text-slate-700">Review in</span>
          {[null, ...REVIEW_PERIODS].map((d) => (
            <Chip key={String(d)} on={review === d} onClick={() => setReview(d)}>{d === null ? 'None' : `${d} days`}</Chip>
          ))}
          <Chip on={review === season.days} onClick={() => setReview(season.days)} title={season.title}>{season.label}</Chip>
          <span className="ml-1 text-xs text-slate-500">{review === null ? 'review dates left as they are' : 'Shopify and every Amazon size'}</span>
        </div>
      </section>

      {/* 3. THE PRICES — the whole style on top, then a row per size; a column per channel. */}
      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <colgroup>
            <col className="w-40" /><col className="w-16" /><col className="w-16" />
            <col /><col /><col />
          </colgroup>
          <thead className="border-b border-slate-200 text-left">
            <tr className="text-xs text-slate-500">
              <th className="px-4 py-2.5 font-medium uppercase tracking-wide">Size</th>
              <th className="px-2 py-2.5 text-right font-medium uppercase tracking-wide">Local</th>
              <th className="px-2 py-2.5 text-right font-medium uppercase tracking-wide">FBA</th>
              <ChannelHead name="Shopify" note={`customer pays postage${h.shopify.live ? '' : ' · not live'}`} />
              <ChannelHead name="Amazon" note="free delivery" />
              <ChannelHead name="eBay" note={h.birk ? 'no Birkenstock' : 'free postage'} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {/* Whole style: Shopify's STYLE price (the sizes below follow it unless given their own); eBay's listing state. */}
            <tr className="bg-slate-50">
              <td className="px-4 py-2.5 font-medium text-slate-700" colSpan={3}>Whole style</td>
              <td className="px-4 py-2.5">
                <PriceCell value={style} onChange={changeStyle} was={h.shopify.price} flag={flag(stylePrice, h.cost)} />
              </td>
              <td className="px-4 py-2.5 text-xs text-slate-400">priced per size</td>
              <td className="px-4 py-2.5 text-xs">
                {h.ebay.item_id ? (
                  <a href={`https://www.ebay.co.uk/itm/${h.ebay.item_id}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">Listed on eBay ↗</a>
                ) : listable ? (
                  <Tick on={listEbay} onChange={setListEbay} label="List on eBay" />
                ) : h.ebay_list ? (
                  <span className="text-amber-700" title={h.ebay_list.missing.join(', ')}>Can’t list: {h.ebay_list.missing.join(', ')}</span>
                ) : (
                  <span className="text-slate-400">{h.birk ? '—' : 'Not on eBay'}</span>
                )}
              </td>
            </tr>
            {rows.map((r) => {
              const shopEff = parse(shop[r.code] ?? '') ?? stylePrice;
              const none = !r.local && !r.fba;
              return (
                <tr key={r.code} className="align-top">
                  <td className={'whitespace-nowrap px-4 py-2.5 ' + (none ? 'text-slate-400' : 'text-slate-800')} title={r.code}>{r.size}</td>
                  <td className={'px-2 py-2.5 text-right tabular-nums ' + (r.local ? 'text-slate-800' : 'text-slate-300')}>{r.local}</td>
                  <td className={'px-2 py-2.5 text-right tabular-nums ' + (r.fba ? 'text-slate-800' : 'text-slate-300')}>{r.fba}</td>
                  <td className="px-4 py-2">
                    {r.shopify.open ? (
                      <PriceCell value={shop[r.code] ?? ''} onChange={(v) => setShop((s) => ({ ...s, [r.code]: v }))}
                        was={r.shopify.size_price ?? h.shopify.price} flag={flag(shopEff, h.cost)}
                        title={r.shopify.kind === 'overstock' ? 'Overstock size price — a change here makes it a clearance price' : 'Same as the style price = no size price; lower = a size price'} />
                    ) : <Grey text="no stock" title={`Follows the style price (${money(stylePrice)})`} />}
                  </td>
                  <td className="px-4 py-2">
                    {r.amazon.open ? (
                      <PriceCell value={amz[r.code] ?? ''} onChange={(v) => setAmz((s) => ({ ...s, [r.code]: v }))} was={r.amazon.price}
                        flag={flag(parse(amz[r.code] ?? ''), h.cost !== null ? h.cost + (r.amazon.fbafee ?? 0) : null)} />
                    ) : <Grey text="not listed" />}
                  </td>
                  <td className="px-4 py-2">
                    {ebayOpen(r) ? (
                      <PriceCell value={ebay[r.code] ?? ''} onChange={(v) => setEbay((s) => ({ ...s, [r.code]: v }))}
                        was={r.ebay.state === 'on' ? r.ebay.price : null} wasBlank={r.ebay.state === 'could' ? 'new' : undefined}
                        flag={flag(parse(ebay[r.code] ?? ''), h.cost)} />
                    ) : r.ebay.state === 'style' ? (
                      <EbayLater price={ebayLater(r)} />
                    ) : <Grey text={r.ebay.state === 'never' ? '—' : r.ebay.open ? 'tick List on eBay' : '—'} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* The new eBay listing's details sit with the prices they list. */}
        {listEbay && listable && (
          <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 bg-amber-50/60 px-4 py-2.5 text-sm">
            <span className="font-medium text-slate-700">New eBay listing</span>
            <label className="flex items-center gap-2 text-slate-600">Style
              <input value={ebayStyle} maxLength={65} onChange={(e) => setEbayStyle(e.target.value)}
                className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1" /></label>
            <label className="flex items-center gap-2 text-slate-600">Material
              <input value={ebayMaterial} maxLength={65} placeholder="e.g. Leather" onChange={(e) => setEbayMaterial(e.target.value)}
                className={'w-40 rounded-md border bg-white px-2 py-1 ' + (ebayMaterial.trim() ? 'border-slate-300' : 'border-amber-400')} /></label>
          </div>
        )}
      </section>

      {/* 4. COMMIT — stays in view: what will be sent, any problem, then the results. */}
      <section className="sticky bottom-0 z-10 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 shadow-md backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 text-sm">
            {plan.steps.length === 0 ? (
              <span className="text-slate-400">No changes yet — nothing is sent until you press Send.</span>
            ) : (
              <span className="text-slate-700">
                <strong>{total || 'No'} price change{total === 1 ? '' : 's'}</strong>
                {changeList && <span className="text-slate-500"> — {changeList}</span>}
                {review !== null && <span className="text-slate-500"> · review {review === season.days ? season.label : `${review} days`}</span>}
              </span>
            )}
          </div>
          {!confirming ? (
            <button type="button" disabled={!canCommit} onClick={() => { setDone(null); setConfirming(true); }}
              className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">
              {listEbay && listable ? 'Send prices & list on eBay' : 'Send prices'}
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-900 ring-1 ring-amber-200">
              <span>Send them now?</span>
              <button type="button" disabled={running} onClick={commit}
                className="h-8 rounded-md bg-brand-600 px-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {running ? 'Sending…' : 'Yes, send'}
              </button>
              <button type="button" disabled={running} onClick={() => setConfirming(false)}
                className="h-8 rounded-md border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            </div>
          )}
        </div>
        {plan.problems.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-sm text-red-700">{plan.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        {done && (
          <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto border-t border-slate-100 pt-2 text-sm">
            {done.map((d, i) => (
              <li key={i} className={d.ok ? 'text-slate-700' : 'text-red-700'}>
                {d.ok ? '✓' : '✗'} {d.label}{d.msg && <span className={d.ok ? ' text-amber-700' : ''}> — {d.msg}</span>}
              </li>
            ))}
            {running && <li className="text-slate-400">…</li>}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---- Small pieces --------------------------------------------------------------------------------------------------------------------
const CHANNEL_NAME: Record<Channel, string> = { shopify: 'Shopify', amazon: 'Amazon', ebay: 'eBay' };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-medium tabular-nums text-slate-800">{value}</div>
    </div>
  );
}

function ChannelHead({ name, note }: { name: string; note: string }) {
  return (
    <th className="px-4 py-2.5 font-medium">
      <div className="text-xs uppercase tracking-wide text-slate-600">{name}</div>
      <div className="text-[11px] font-normal text-slate-400">{note}</div>
    </th>
  );
}

function Tick({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={'flex items-center gap-1.5 text-sm ' + (disabled ? 'text-slate-300' : 'cursor-pointer text-slate-700')}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="rounded border-slate-300" />
      {label}
    </label>
  );
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={'rounded-full border px-3 py-1 text-sm ' + (on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}>
      {children}
    </button>
  );
}

// eBay: not on the listing yet — the price Update Orders will add it at once it has stock.
function EbayLater({ price }: { price: number | null }) {
  return (
    <div title="Not on the listing yet (no stock). Update Orders adds it when it has stock, at its Amazon price, else Shopify + £4.50."
      className="w-28 rounded-md bg-slate-100 px-2 py-1 text-center text-xs leading-tight text-slate-500">
      {price !== null ? money(price) : '—'}<div className="text-[10px] text-slate-400">when in stock</div>
    </div>
  );
}

// A cell with no price on that channel — the same width as a price box, so the columns stay lined up.
function Grey({ text, title }: { text: string; title?: string }) {
  return <div title={title} className="w-28 rounded-md bg-slate-100 px-2 py-1.5 text-center text-xs text-slate-400">{text}</div>;
}

// A £ box: the £ sits inside the input.
function MoneyInput({ value, onChange, changed }: { value: string; onChange: (v: string) => void; changed?: boolean }) {
  return (
    <div className="relative w-28">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-400">£</span>
      <input value={value} inputMode="decimal" onChange={(e) => onChange(e.target.value)}
        className={'w-full rounded-md border py-1.5 pl-6 pr-2 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 '
          + (changed ? 'border-amber-400 bg-amber-50' : 'border-slate-300 bg-white')} />
    </div>
  );
}

// One price box. Highlighted when it differs from what is live (`was`), with the live price beside any flag under it.
// wasBlank 'new' = not on the channel yet (a new eBay listing), always highlighted.
function PriceCell({ value, onChange, was, wasBlank, flag, title }: {
  value: string; onChange: (v: string) => void; was: number | null; wasBlank?: 'new'; flag: React.ReactNode; title?: string;
}) {
  const changed = wasBlank === 'new' ? true : !same(parse(value), was);
  return (
    <div title={title}>
      <MoneyInput value={value} onChange={onChange} changed={changed} />
      {(changed || flag) && (
        <div className="mt-0.5 flex gap-2 text-[11px] text-slate-400">
          {changed && <span>was {was !== null ? money(was) : 'not listed'}</span>}
          {flag}
        </div>
      )}
    </div>
  );
}
