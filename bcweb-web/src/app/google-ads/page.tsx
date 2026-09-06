'use client';
/*
=======================================================================================================================================
Page: /google-ads  (Google Ads — campaign assignment)
=======================================================================================================================================
Purpose: "Which products should be in which Google Ads campaign, and is it working?" The operator narrows the catalogue down, reads
         what each style earned against what Google charged for it, selects rows and assigns them to a bucket.

         Spec: docs/google-ads-spec.md (authoritative).

WHAT THE SCREEN WRITES: skusummary.googlecampaign, and nothing else. The nightly merchant feed ships it as Google's custom_label_0,
which is what scopes a Shopping campaign. A style is taken out of Google by assigning it `pause`, never by switching googlestatus off
— reversible, one lever.

NOTHING HERE REACHES GOOGLE TODAY. The chain is: this write -> merchant feed at 3:30am -> SFTP -> Google recrawls -> the label
updates. Tomorrow at the earliest. The bulk bar says so when you assign; the grid does NOT flag rows as pending, because our copy of
what Google reports is only as fresh as the last import and the flag said more than it could know (see the note on the row).

THE FILTER IS INVENTORY'S, DELIBERATELY UNCHANGED IN BEHAVIOUR
Contains / Does not contain, stacked steps, each search narrowing what is already on screen, and a search that would empty the list is
treated as a fresh hunt instead. The operator has years of muscle memory in it and a second dialect of the same idea would be worse
than either. Two departures, both the owner's: there is NO Find button (Enter applies the boxes, and so does tabbing out of them),
and the typed commands differ because the questions do — this screen asks about SPEND and KEPT first. SIZES is the one command it
shares with Inventory, and it is here for a money reason rather than a stock one: see THIN_SIZES.

WHY THE DEFAULT SORT IS "KEPT", WORST FIRST
Every other list in this platform opens on something neutral. This one opens on the money it is losing, because that is the job: over
the 30 days to 5 Sep 2026, 55 styles cost more in ads than they made in profit — £1,578 of spend against £676 of profit — and another
78 drew spend having sold nothing at all. Those rows are the reason to open the screen, so they are what it opens on.

ALL FIVE WINDOWS SHIP IN ONE PAYLOAD (see the route header), so the window switch is a display change with no round-trip — the same
trade birk-stock makes with LIVE / FULL. Only the 30-day window has a like-for-like year-ago partner, so the comparison bar appears
there and is dropped rather than faked on the others — 7 days included, where a seven-day slice of last September would be one piece
of noise measured against another.

NO WINDOW ON THIS SCREEN RUNS TO TODAY, AND THAT IS DELIBERATE (2026-09-06)
Every window ends at `asOf` — the newest COMPLETE day of Google ad data — on BOTH the sales side and the ad side. So a sale made this
morning does not appear here, and someone will eventually ask why. The answer: sales are live, the ad report only covers days it has
finished watching, and the newest day in an import is normally a PART day (a report pulled at 14:38 holds that day up to 14:38). A
window running to today would set N days of sales against fewer days of cost, and Kept would read high by exactly that gap. Anchored,
the two sides always describe the same days. The money bar prints the real range it measured, and the import panel's freshness line
says how old that is — between them the screen never claims a day it has not measured. The route header (google-ads-styles) has the
full reasoning, and what Google does and does not actually delay.
=======================================================================================================================================
*/

import { useCallback, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, ArrowPathIcon, XMarkIcon, QuestionMarkCircleIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import GoogleAdsMoneyBar from '@/components/GoogleAdsMoneyBar';
import GoogleAdsCampaignPanel from '@/components/GoogleAdsCampaignPanel';
import GoogleAdsImport from '@/components/GoogleAdsImport';
import GoogleAdsDrill from '@/components/GoogleAdsDrill';
import {
  getGoogleAdsStyles, getGoogleAdsCampaigns, googleAdsAssign,
  GoogleAdsStyleRow, GoogleAdsWindow, GoogleAdsWindowKey,
} from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

// ---- Filtering ------------------------------------------------------------------------------------------------------------------
// One applied narrowing step. `has` keeps matching rows; `not` drops them. Same contract as Inventory.
interface FilterStep { op: 'has' | 'not'; term: string }

// A worded numeric command typed in the Contains box, consumed rather than searched for. Plain-English keywords, not "<10" symbols,
// exactly as Inventory does — so the two screens read the same and neither clashes with a future meaning for "<".
//
// The metrics are this screen's questions: SPEND (what Google charged), KEPT (profit after that), STOCK, SOLD, SIZES. The first
// four compare against the CURRENTLY SELECTED WINDOW, so "SPEND MORE 50" means something different on 30d and 365d — which is
// correct, and the active chip names the window so it is never ambiguous.
//
// SIZES IS THE ODD ONE AND DELIBERATELY SO: it is today's shelf, not the window's. "SIZES LESS 5" asks how many sizes a shopper can
// buy RIGHT NOW, which is what decides whether the next click finds anything — a windowed version would answer a question about the
// past that nobody is acting on. Same standing as STOCK, which is already read straight off the row.
type QtyMetric = 'spend' | 'kept' | 'stock' | 'sold' | 'sizes';
interface QtyFilter { metric: QtyMetric; op: 'less' | 'more'; n: number }

function metricValue(r: GoogleAdsStyleRow, w: GoogleAdsWindowKey, metric: QtyMetric): number {
  if (metric === 'stock') return r.stock;
  if (metric === 'sizes') return r.sizesInStock;
  const win = r[w];
  if (metric === 'spend') return win.spend;
  if (metric === 'kept') return win.profitAfterSpend;
  return win.units;
}

type Season = 'Winter' | 'Summer';
// 'Any' is year-round and answers YES to both — in December you want the Winter styles AND the year-round ones, because those are
// what you can actually sell. Same rule as Inventory. Note skusummary.season is known to be wrong on Birkenstock (spec §1); this
// screen reuses the behaviour as-is and improves for free when the tags are fixed.
function inSeason(r: GoogleAdsStyleRow, season: Season | null): boolean {
  if (season === null) return true;
  const tag = (r.season || '').trim().toLowerCase();
  return tag === season.toLowerCase() || tag === 'any';
}

interface Criteria {
  steps: FilterStep[];
  qty: QtyFilter[];
  season: Season | null;
  bucket: string | null;      // a campaign chip, set by clicking a row in the campaign panel
}

function haystack(r: GoogleAdsStyleRow): string {
  return `${r.title || ''} ${r.groupid} ${r.segment} ${r.brand} ${r.campaign}`.toLowerCase();
}
interface IndexedRow { row: GoogleAdsStyleRow; hay: string }

function applyCriteria(indexed: IndexedRow[], c: Criteria, w: GoogleAdsWindowKey, campaignNames: Set<string>): IndexedRow[] {
  let out = indexed;
  for (const s of c.steps) {
    const t = s.term.toLowerCase();
    // A term that is EXACTLY a live campaign name (e.g. typing "new" when a 'new' bucket exists) filters on the bucket itself —
    // r.campaign === t — rather than the plain substring search. Otherwise Contains "new" would also catch any title, groupid,
    // segment or brand that happens to contain the letters "new" (a style genuinely called "New Balance", say), which is not
    // what typing a real bucket's name means. Does-not-contain gets the same treatment, for the same reason, in both directions.
    // A one-off, unmanaged bucket typo would just fall through to the substring path, same as before.
    const isCampaignName = campaignNames.has(t);
    // CONTAINS is a plain substring (operators type partials: "ARIZ" must find Arizona). DOES NOT CONTAIN is its exact mirror — the
    // legacy PowerBuilder rule, and the one Inventory settled on after a whole-word variant broke ¬WOMEN.
    if (isCampaignName) {
      out = s.op === 'has'
        ? out.filter((x) => x.row.campaign.toLowerCase() === t)
        : out.filter((x) => x.row.campaign.toLowerCase() !== t);
    } else {
      out = s.op === 'has' ? out.filter((x) => x.hay.includes(t)) : out.filter((x) => !x.hay.includes(t));
    }
  }
  if (c.bucket !== null) out = out.filter((x) => x.row.campaign === c.bucket);
  if (c.season !== null) out = out.filter((x) => inSeason(x.row, c.season));
  for (const f of c.qty) {
    out = out.filter((x) => {
      const v = metricValue(x.row, w, f.metric);
      return f.op === 'less' ? v < f.n : v > f.n;
    });
  }
  return out;
}

// Pull a typed command out of the Contains box, so it is consumed as a command instead of being hunted for as text.
function parseContains(raw: string): { term: string; qty: QtyFilter | null; season: Season | null } {
  const text = raw.trim();
  const upper = text.toUpperCase();

  if (upper === 'WINTER' || upper === 'SUMMER') {
    return { term: '', qty: null, season: upper === 'WINTER' ? 'Winter' : 'Summer' };
  }
  const m = upper.match(/^(SPEND|KEPT|STOCK|SOLD|SIZES)\s+(LESS|MORE)\s+(-?\d+(?:\.\d+)?)$/);
  if (m) {
    return {
      term: '',
      qty: { metric: m[1].toLowerCase() as QtyMetric, op: m[2].toLowerCase() as 'less' | 'more', n: Number(m[3]) },
      season: null,
    };
  }
  return { term: text, qty: null, season: null };
}

// ---- Sorting --------------------------------------------------------------------------------------------------------------------
type SortKey = 'groupid' | 'campaign' | 'sizes' | 'sold' | 'conv' | 'spend' | 'kept' | 'keptper';
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
  groupid: 'asc', campaign: 'asc', sizes: 'asc', sold: 'desc', conv: 'asc', spend: 'desc', kept: 'asc', keptper: 'asc',
};
function sortValue(r: GoogleAdsStyleRow, key: SortKey, w: GoogleAdsWindowKey): number | string {
  const win = r[w];
  switch (key) {
    case 'groupid': return r.groupid.toLowerCase();
    case 'campaign': return r.campaign.toLowerCase();
    // Sorted on the COUNT of sizes in stock, not the share (owner, 2026-09-06 — "sorting on size e.g. 4/7 goes weird").
    // The share is the better measure — 4 of 11 is a thinner shelf than 4 of 5 — but sorting on it scatters the column the eye is
    // actually reading, so 4/7 and 4/11 land pages apart and the list looks unsorted. The first number is what a reader ranks on,
    // so that is what the sort ranks on. The share still does its job as the amber threshold on the cell.
    // Tie-broken by the share, so equal counts put the thinner run first.
    case 'sizes': return r.sizesInStock + (r.sizesListed > 0 ? r.sizesInStock / r.sizesListed / 1000 : 0);
    case 'sold': return win.units;
    case 'conv': return convPct(r, w);
    case 'spend': return win.spend;
    // KEPT is profit after ad spend — the grid shows no other kind of profit (owner, 2026-09-06: the column was called Profit, and
    // renaming it matches Reports > Ad Efficiency, where the same figure has always been Kept).
    case 'kept': return win.profitAfterSpend;
    // A style with nothing sold has no per-sale figure. Sent to the far end so it never sits among real ones.
    case 'keptper': return keptPerSale(win);
  }
}

// ---- Display helpers ------------------------------------------------------------------------------------------------------------
function money(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
}

// WHAT ONE SALE OF THIS STYLE ACTUALLY LEFT YOU, after paying Google to make it. THE TARGET FIGURE (owner, 2026-09-06): "get kept
// per product as high as possible".
//
// It replaced a Kept % column, which replaced ROAS. Each swap moved the same way — towards the money and away from a ratio. ROAS was
// Google's revenue over Google's spend and flattered every row (61x on a 64p profit, because the revenue counted was the whole
// basket the click led to). Kept % was honest but answered a different question — efficiency of spend — when the decision being made
// is which styles earn their place. This is the same measure Reports > Ad Efficiency ranks months on, so a style and a month are
// finally read in the same units.
//
// ZERO, NOT NULL, WHEN NOTHING SOLD (owner, 2026-09-06 — "helps the sort"). Strictly there is no per-sale figure for no sales, and
// this column used to say so with a dash and push those rows to the end of the sort. That put a real group of styles somewhere the
// operator never looked. At 0 they sort where they belong: below every earner, above every loser.
//
// The trade, stated so nobody reads 0 as harmless: a style that spent £58 and sold nothing also reads £0.00 here. Its KEPT column
// is -£58 and sits immediately to the left, which is the figure that damns it. Sorting on Kept, not Kept / sale, is what finds
// those rows — this column ranks earners.
// Clicks that turned into a sale. THE column that says WHY a row is expensive, and it costs nothing — `clicks` was already in the
// payload and simply was not drawn.
//
// It separates two faults that look identical on money alone. Measured on the same day (2026-09-06), five styles with the biggest
// ad spend all drew 117-212 clicks at 42-71p each — Google treated them identically — and converted at 9.0%, 4.8%, 3.9%, 1.4% and
// 0.9%. The 10x spread in conversion, not the bidding, is the whole difference between a style that keeps 46% of its profit and one
// that loses four times it. Sorted ascending by default: the worst converter is the row to look at.
//
// NO NULLS (owner, 2026-09-06 — "Conv % sort is using NULLs, makes it awkward"). This returned null below a click floor and the
// sort banished those rows past the end, which is exactly where an operator never looks.
//
// A rate below the floor is still a real ratio, just a thin one: one sale on three clicks IS 33%, it simply should not be believed.
// So the number is computed for everyone and the DISPLAY carries the warning instead — rows under the floor are greyed. Ranking and
// trustworthiness are two different jobs and the sort should not be doing both.
//
// No clicks at all reads 0%, which is honest: nothing was offered, nothing converted.
const CONV_MIN_CLICKS = 20;

// THE SHELF-DEPTH LINE, AND WHY IT IS A COUNT AND NOT A SHARE (2026-09-06)
// This cell was amber under HALF the run. That rule was a guess and the data disagrees with it. Over the 30 days to 5 Sep 2026,
// grouped by how many sizes are actually buyable today:
//
//     sizes in stock    styles   clicks   spend     sold   conv.    kept
//     0                     32      652   £185        36    5.5%    -£17
//     1-2                   59    2,841   £972        83    2.9%   -£514
//     3-4                   41    1,640   £674        60    3.7%    -£73
//     5-7                   55    2,192   £1,136     219   10.0%   +£448
//     8+                    16    1,077   £570       114   10.6%   +£677
//
// The break is a cliff between 4 and 5, not a slope, and it is not a share: conversion nearly triples the moment a fifth size is
// buyable. £1,831 of £3,537 — 52% of all spend — sits below the line and returns -£604; everything above it returns +£1,125. Every
// penny this account keeps comes from deep-stock styles.
//
// Scored the two rules against each other on the same 30 days, the count is the better line: it keeps a set converting at 10.2%
// (the share rule keeps one at 8.6%, because it lets 37 shallow styles through on a flattering denominator) and it stops flagging
// 4 healthy styles the share rule called thin — they convert at 10.3% and keep £79 between them.
//
// The one thing the count gets wrong on purpose: 16 styles list fewer than 5 sizes in total, so they are amber whatever they do.
// They draw £98 of spend between them and the flag is arguably right anyway — a shopper whose size is not there does not care that
// the run was never longer. Not worth a second rule.
//
// The merchant feed CANNOT catch any of this. It reports style-level availability, and it reports it correctly: these styles ARE in
// stock. Depth is invisible to it, which is why the money leaks here and nowhere else.
const THIN_SIZES = 5;
function convPct(r: GoogleAdsStyleRow, w: GoogleAdsWindowKey): number {
  const win = r[w];
  if (win.clicks <= 0) return 0;
  return Math.round((win.units / win.clicks) * 1000) / 10;
}

function keptPerSale(w: GoogleAdsWindow): number {
  if (w.units <= 0) return 0;
  return Math.round((w.profitAfterSpend / w.units) * 100) / 100;
}

// Most titles on this screen start "Birkenstock " or "Womens " — a dozen characters of nothing, repeated down the whole list, that
// push the part which actually distinguishes one row from another (model, colour, fit) out past the truncation. Stripped for DISPLAY
// only; the filter still matches the full title, and the full title is on the cell's tooltip. Same device as the Birkenstock sheet.
const TITLE_NOISE = /^(birkenstock|womens|mens|ladies)\s+/i;
function styleName(title: string | null): string {
  if (!title) return '—';
  return title.replace(TITLE_NOISE, '');
}

const WINDOWS: { key: GoogleAdsWindowKey; short: string }[] = [
  // 7 DAYS LEADS THE ROW BUT IS NOT THE DEFAULT (owner, 2026-09-06). It exists because a pause or a bucket move takes a day to reach
  // Google and a few more to show, so on 30 days the effect of last week's decision is a quarter of a window three-quarters made of
  // the decision it replaced. It is also the noisiest window here — a style selling two a month reads nothing across most weeks — so
  // the screen still opens on 30 days, and the chips run short-to-long so the trade is legible left to right.
  { key: 'd7', short: '7 days' },
  { key: 'd30', short: '30 days' },
  { key: 'd90', short: '90 days' },
  { key: 'd365', short: '365 days' },
];

const NO_ROWS: GoogleAdsStyleRow[] = [];

// NO ROW WINDOWING (owner, 2026-09-06). This list used to paint 120 rows at a time behind a "Show more" button, borrowed from the
// Inventory browse. It was the wrong borrow: there each row is an image card and the paint cost is real, whereas here a row is nine
// numbers and the whole catalogue is ~284 of them. What it cost instead was legibility — sorting re-ordered a list you could only
// see part of, so it was never clear where the hidden rows began or whether "Show more" would bring back something that belonged
// higher up. Every matching row is rendered.

export default function GoogleAdsPage() {
  // ---- data ---------------------------------------------------------------------------------------------------------------
  const stylesQ = useApiQuery('google-ads-styles', getGoogleAdsStyles);
  const [win, setWin] = useState<GoogleAdsWindowKey>('d30');
  // The campaign panel's money follows the window switch, so its key carries the day count.
  const days = win === 'd7' ? 7 : win === 'd30' ? 30 : win === 'd90' ? 90 : 365;
  const campaignsQ = useApiQuery(`google-ads-campaigns:${days}`, () => getGoogleAdsCampaigns(days));

  const rows = stylesQ.data?.rows ?? NO_ROWS;
  const windows = stylesQ.data?.windows;

  // ---- filter state -------------------------------------------------------------------------------------------------------
  const [contains, setContains] = useState('');
  const [notContains, setNotContains] = useState('');
  const [steps, setSteps] = useState<FilterStep[]>([]);
  const [qty, setQty] = useState<QtyFilter[]>([]);
  const [season, setSeason] = useState<Season | null>(null);
  const [bucket, setBucket] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const containsRef = useRef<HTMLInputElement>(null);

  // ---- sort / selection / paging ------------------------------------------------------------------------------------------
  const [sortKey, setSortKey] = useState<SortKey>('kept');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // CUT — a per-row manual hide, same idiom as Inventory. The filter cannot always express "these 6 of the 48", because what makes
  // them different is a judgement rather than a word in the title: a summer sandal you know is about to go quiet is a WINNER on
  // every column here. So you narrow with the boxes, cut the stragglers by hand, then act on what is left.
  // VIEW-ONLY and never sent anywhere. Restore or Reset brings them back.
  const [cut, setCut] = useState<Set<string>>(new Set());
  // Anchor for shift-click range selection — the index in the CURRENT sort of the last row whose box was clicked.
  const anchorRef = useRef<number | null>(null);
  const [drill, setDrill] = useState<string | null>(null);

  const [assignTo, setAssignTo] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const indexed = useMemo<IndexedRow[]>(() => rows.map((row) => ({ row, hay: haystack(row) })), [rows]);

  // Live bucket names, lowercased, so a Contains/Does-not-contain term that exactly matches one filters on the bucket rather than
  // as a substring — see applyCriteria. Read straight off the campaign panel's own data, so a newly-created bucket is usable here
  // the moment it exists, with nothing to keep in sync by hand.
  const campaignNames = useMemo(
    () => new Set((campaignsQ.data?.buckets ?? []).map((b) => b.name.toLowerCase())),
    [campaignsQ.data]
  );

  const criteria: Criteria = useMemo(
    () => ({ steps, qty, season, bucket }),
    [steps, qty, season, bucket]
  );
  const filtering = steps.length > 0 || qty.length > 0 || season !== null || bucket !== null || cut.size > 0;

  const matched = useMemo(
    () => applyCriteria(indexed, criteria, win, campaignNames).map((x) => x.row),
    [indexed, criteria, win, campaignNames]
  );
  // Cuts apply AFTER the filter, so a cut row comes back the moment the filter changes underneath it rather than staying hidden in
  // a list it was never cut from.
  // NO CUT COUNT AND NO RESTORE (owner, 2026-09-06). A cut row is simply gone from the working set; Reset is the way back. The
  // count and the undo link were both spending space on a state the operator has just deliberately created and does not need
  // reminding of.
  const visible = useMemo(() => matched.filter((r) => !cut.has(r.groupid)), [matched, cut]);

  const sorted = useMemo(() => {
    const list = [...visible];
    list.sort((a, b) => {
      const av = sortValue(a, sortKey, win);
      const bv = sortValue(b, sortKey, win);
      let d = 0;
      if (typeof av === 'string' || typeof bv === 'string') d = String(av).localeCompare(String(bv));
      else d = av - bv;
      if (d === 0) d = a.groupid.localeCompare(b.groupid);   // stable, readable tie-break
      return sortDir === 'asc' ? d : -d;
    });
    return list;
  }, [visible, sortKey, sortDir, win]);

  // Nothing between `sorted` and the DOM: what you filtered is what you see.
  const painted = sorted;

  // Totals for the money bar: the FILTERED set, not the catalogue. Narrowing to Zermatt and reading the bar for Zermatt is the point
  // — a headline that ignored the filter would answer a question nobody on this screen is asking.
  const totals = useMemo(() => {
    const blank: GoogleAdsWindow = {
      units: 0, revenue: 0, profit: 0, impressions: 0, clicks: 0, spend: 0,
      conversions: 0, convValue: 0, profitAfterSpend: 0, roas: null,
    };
    const add = (key: GoogleAdsWindowKey) => visible.reduce((a, r) => {
      const w = r[key];
      return {
        ...a,
        units: a.units + w.units, revenue: a.revenue + w.revenue, profit: a.profit + w.profit,
        impressions: a.impressions + w.impressions, clicks: a.clicks + w.clicks, spend: a.spend + w.spend,
        conversions: a.conversions + w.conversions, convValue: a.convValue + w.convValue,
        profitAfterSpend: a.profitAfterSpend + w.profitAfterSpend,
      };
    }, { ...blank });
    return { current: add(win), lastYear: add('ly30') };
  }, [visible, win]);

  // ---- actions ------------------------------------------------------------------------------------------------------------
  // ANY change to what is on screen clears the selection — every filter step added OR removed, the window switch, a campaign chip,
  // a cut, Reset (owner, 2026-09-06). Two reasons, and the second is the one that bites:
  //   1. A bulk assign that quietly included a row you can no longer see is the worst thing this screen could do.
  //   2. The shift-click anchor is an INDEX into the current sort, not an id. Leave it in place across a filter change and it
  //      points at a different style, so the next shift-click takes a range nobody asked for.
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
    // The assign confirmation ("N styles moved to X · reaches Google after tonight's feed") is about the LAST bulk action, and
    // stops being true the moment the operator moves on to a new filter — it would otherwise sit there describing a set of rows
    // that is no longer on screen. Same trigger as the selection it sits below, for the same reason: every filter change, not
    // just Reset.
    setFlash(null);
  }, []);

  const onFind = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseContains(contains);
    const next: FilterStep[] = [];
    if (parsed.term) next.push({ op: 'has', term: parsed.term });
    if (notContains.trim()) next.push({ op: 'not', term: notContains.trim() });

    let nextQty = qty;
    if (parsed.qty) nextQty = [...qty.filter((f) => f.metric !== parsed.qty!.metric), parsed.qty];
    const nextSeason = parsed.season ?? season;

    if (next.length > 0) {
      // A Find that would empty the list is treated as a NEW hunt rather than a narrowing — the operator was starting again
      // ("ARIZONA" then "ZERMATT"), not asking for styles that are both. Inventory's rule, and the reason it feels right there.
      const narrowed = applyCriteria(indexed, { ...criteria, steps: [...steps, ...next], qty: nextQty, season: nextSeason }, win, campaignNames);
      setSteps(narrowed.length === 0 && filtering ? next : [...steps, ...next]);
    }
    setQty(nextQty);
    setSeason(nextSeason);
    setContains('');
    setNotContains('');
    clearSelection();
  }, [contains, notContains, qty, season, steps, indexed, criteria, filtering, win, campaignNames, clearSelection]);

  // Enter applies the boxes. Explicit rather than relying on the form's implicit submission: with two text inputs and no submit
  // button, browsers do NOT reliably submit on Enter — and this form deliberately has no Find button.
  const onEnter = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    onFind(e);
  }, [onFind]);

  const onReset = useCallback(() => {
    setSteps([]); setQty([]); setSeason(null); setBucket(null); setCut(new Set());
    setContains(''); setNotContains(''); setDrill(null);
    clearSelection();
    stylesQ.refresh();
    campaignsQ.refresh();
    containsRef.current?.focus();
  }, [clearSelection, stylesQ, campaignsQ]);

  // THIN SHELF — the one narrowing on this screen that gets a button instead of a typed command (owner, 2026-09-06).
  // It is exactly `SIZES LESS 5` and composes with everything else, so it is not a special case in the filter; it is a shortcut to
  // the one step that is worth taking on most visits. Half the ad budget sits behind it (see THIN_SIZES), it is asked for by name
  // every time the account is reviewed, and it is the only cohort here defined by a fact known BEFORE the money is spent rather
  // than a verdict reached after it.
  //
  // Toggles, like the campaign chip: pressing it again lifts it. Clearing its chip does the same thing, and both routes are live
  // because the button is where the eye is and the chip is where the other narrowings are lifted.
  const thinActive = qty.some((f) => f.metric === 'sizes');
  const onThinShelf = useCallback(() => {
    setQty((list) => (
      list.some((f) => f.metric === 'sizes')
        ? list.filter((f) => f.metric !== 'sizes')
        : [...list, { metric: 'sizes' as QtyMetric, op: 'less' as const, n: THIN_SIZES }]
    ));
    clearSelection();
  }, [clearSelection]);

  const onSort = useCallback((key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(DEFAULT_DIR[key]); }
  }, [sortKey]);

  // SELECTION IS EXPLORER'S, NOT A CHECKBOX LIST (owner, 2026-09-06). The checkboxes were removed: they were a 16px target
  // competing with the row click, and they made a plain click mean "add to a set" when what the operator wanted was "work on this
  // one". Selection is now the row highlight and nothing else.
  //
  //   click              this row only — everything else clears. Clicking the only selected row clears it.
  //   ctrl / cmd click   toggle this row, keep the rest.
  //   shift click        the range from the anchor to here, REPLACING the selection (Explorer's rule, not additive).
  //
  // The anchor is the last row given a plain or ctrl click. Shift does not move it, so shift-clicking twice from the same start
  // grows and shrinks one range instead of walking away from it.
  const toggleRow = useCallback((groupid: string, index: number, e: React.MouseEvent) => {
    const additive = e.ctrlKey || e.metaKey;

    if (e.shiftKey && anchorRef.current !== null) {
      const anchor = anchorRef.current;
      const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor];
      setSelected(new Set(painted.slice(lo, hi + 1).map((x) => x.groupid)));
      return;   // anchor deliberately unmoved
    }

    if (additive) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(groupid)) next.delete(groupid); else next.add(groupid);
        return next;
      });
      anchorRef.current = index;
      return;
    }

    // Plain click: this row alone, or nothing if it was already the only one selected.
    setSelected((prev) => (prev.size === 1 && prev.has(groupid) ? new Set() : new Set([groupid])));
    anchorRef.current = index;
  }, [painted]);

  // Hide a row from the working set. Clears the selection with it: leaving a cut row selected would let a bulk assign move the very
  // thing just excluded, and every row below it shifts up by one, which strands the shift anchor.
  const cutRow = useCallback((groupid: string) => {
    setCut((prev) => new Set(prev).add(groupid));
    clearSelection();
  }, [clearSelection]);

  // Cut the whole selection. The row ✕ is for picking off one straggler; this is for the other half of the job — select a run of
  // summer sandals with shift, drop them, then act on what is left. Same view-only cut, same Reset to undo it.
  const cutSelected = useCallback(() => {
    setCut((prev) => {
      const next = new Set(prev);
      for (const g of selected) next.add(g);
      return next;
    });
    clearSelection();
  }, [selected, clearSelection]);

  // NO SELECT-ALL CONTROL (owner, 2026-09-06). Click the first row, shift-click the last — that covers it, and a pill sitting in
  // the filter strip for a gesture the operator already has was one more thing to read past.

  const buckets = campaignsQ.data?.buckets ?? [];
  const assignable = buckets.filter((b) => !b.archived && b.managed);

  async function runAssign() {
    if (!assignTo || selected.size === 0) return;
    setAssigning(true);
    setFlash(null);
    const res = await googleAdsAssign({ groupids: [...selected], campaign: assignTo });
    setAssigning(false);
    if (!res.success) { setFlash(res.error || 'Nothing was changed'); return; }
    const { moved, unchanged } = res.data!;
    setFlash(
      `${moved} style${moved === 1 ? '' : 's'} moved to ${res.data!.campaign}` +
      (unchanged > 0 ? ` · ${unchanged} already there` : '') +
      ' · reaches Google after tonight’s feed'
    );
    setSelected(new Set());
    stylesQ.refresh();
    campaignsQ.refresh();
  }

  const loading = stylesQ.isLoading;

  return (
    <AppShell title="Google Ads">
      {/* ---- Window switch + import ------------------------------------------------------------------------------------ */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => { setWin(w.key); clearSelection(); }}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                win === w.key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {w.short}
            </button>
          ))}
        </div>
        <GoogleAdsImport onImported={() => { stylesQ.refresh(); campaignsQ.refresh(); }} />
      </div>

      {/* ---- The headline ----------------------------------------------------------------------------------------------- */}
      {windows && (
        <div className="mb-4">
          <GoogleAdsMoneyBar
            current={totals.current}
            currentMeta={windows[win]}
            lastYear={totals.lastYear}
            lastYearMeta={windows.ly30}
            // Only the 30-day window has a like-for-like partner a year back. Comparing 365 days — or 7 — against 30 would be a fake.
            showLastYear={win === 'd30'}
          />
        </div>
      )}

      {/* ---- Campaigns -------------------------------------------------------------------------------------------------- */}
      <div className="mb-4">
        <GoogleAdsCampaignPanel
          buckets={buckets}
          adsCampaigns={campaignsQ.data?.adsCampaigns ?? []}
          windowLabel={windows ? windows[win].label : ''}
          onChanged={() => { campaignsQ.refresh(); stylesQ.refresh(); }}
          onFilterBucket={(name) => { setBucket((b) => (b === name ? null : name)); clearSelection(); }}
          activeBucket={bucket}
        />
      </div>

      {/* ---- Filter bar ------------------------------------------------------------------------------------------------- */}
      {/* NO FIND BUTTON (owner, 2026-09-06). Enter submits the form, and tabbing OUT of the two boxes applies whatever is in them.
          The blur handler checks where focus actually went: tabbing from Contains to Does-not-contain must NOT fire, or the first
          term is applied and the box cleared while the operator is still half-way through typing the pair. So it fires only when
          focus leaves the form entirely — which is what "tab out" means and what a Find press used to mean. */}
      <form
        onSubmit={onFind}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;   // still inside the filter — not finished yet
          if (!contains.trim() && !notContains.trim()) return;                    // nothing typed, nothing to apply
          onFind(e);
        }}
        className="mb-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Contains</label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              <input
                ref={containsRef}
                value={contains}
                onChange={(e) => setContains(e.target.value.toUpperCase())}
                onKeyDown={onEnter}
                autoFocus
                placeholder="e.g. ZERMATT"
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Does not contain</label>
            <input
              value={notContains}
              onChange={(e) => setNotContains(e.target.value.toUpperCase())}
              onKeyDown={onEnter}
              placeholder="e.g. EVA"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button
            type="button"
            onClick={onReset}
            title="Clear the search and re-read from the database"
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Reset
          </button>
          {/* Sits beside Reset rather than among the window chips: it narrows the LIST, which is what this bar does, and it must not
              read as a change to the period being measured. */}
          <button
            type="button"
            onClick={onThinShelf}
            aria-pressed={thinActive}
            title={`Only styles with fewer than ${THIN_SIZES} sizes buyable today — where clicks stop converting`}
            className={`whitespace-nowrap rounded-md border px-4 py-2 text-sm font-medium ${
              thinActive
                ? 'border-slate-400 bg-slate-100 text-slate-800'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Thin shelf
          </button>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            title="Search commands"
            aria-expanded={showHelp}
            className={`flex items-center rounded-md border px-2 py-2 ${showHelp ? 'border-slate-400 bg-slate-100 text-slate-600' : 'border-slate-300 text-slate-400 hover:bg-slate-50'}`}
          >
            <QuestionMarkCircleIcon className="h-5 w-5" />
          </button>
        </div>

        {showHelp && (
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <div className="mb-1 font-medium uppercase tracking-wide text-slate-400">Commands — type in Contains, then Find</div>
            <ul className="space-y-1">
              <li><span className="font-mono text-slate-700">SPEND MORE 50</span> · <span className="font-mono text-slate-700">SPEND LESS 5</span><span className="text-slate-400"> — what Google charged, in the chosen window</span></li>
              <li><span className="font-mono text-slate-700">KEPT LESS 0</span><span className="text-slate-400"> — styles that cost more than they earned</span></li>
              <li><span className="font-mono text-slate-700">SOLD LESS 1</span> · <span className="font-mono text-slate-700">STOCK MORE 20</span><span className="text-slate-400"> — units sold in the window, and stock on the shelf</span></li>
              <li><span className="font-mono text-slate-700">SIZES LESS 5</span><span className="text-slate-400"> — sizes buyable TODAY, not in the window. Under 5 is the Thin shelf button</span></li>
              <li><span className="font-mono text-slate-700">WINTER</span> · <span className="font-mono text-slate-700">SUMMER</span><span className="text-slate-400"> — season (year-round styles show in both)</span></li>
            </ul>
          </div>
        )}

        {/* Applied narrowings + the count. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <span className="mr-1 whitespace-nowrap text-slate-500">
            {filtering ? (
              <>Rows: <span className="font-semibold text-slate-800">{sorted.length}</span><span className="text-slate-400"> of {rows.length}</span></>
            ) : (
              <><span className="font-semibold text-slate-800">{rows.length}</span><span className="text-slate-400"> styles</span></>
            )}
          </span>
          {bucket && (
            <Chip label={`Campaign: ${bucket}`} onClear={() => { setBucket(null); clearSelection(); containsRef.current?.focus(); }} />
          )}
          {season && (
            <Chip label={season} onClear={() => { setSeason(null); clearSelection(); containsRef.current?.focus(); }} />
          )}
          {qty.map((f) => (
            <Chip
              key={f.metric}
              label={`${f.metric.toUpperCase()} ${f.op} ${f.n}`}
              onClear={() => { setQty((list) => list.filter((x) => x.metric !== f.metric)); clearSelection(); containsRef.current?.focus(); }}
            />
          ))}
          {steps.map((s, i) => (
            <Chip
              key={`${s.op}-${s.term}-${i}`}
              label={`${s.op === 'not' ? '¬ ' : ''}${s.term}`}
              onClear={() => { setSteps((list) => list.filter((_, j) => j !== i)); clearSelection(); containsRef.current?.focus(); }}
            />
          ))}
        </div>
      </form>

      {flash && (
        <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{flash}</div>
      )}

      {/* ---- The grid --------------------------------------------------------------------------------------------------- */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[70vh] overflow-auto">
          {/* BORDER-SEPARATE, not collapse: `position: sticky` on a <th> does not hold under border-collapse, so the heading row
              would scroll away. Same fix as the Birkenstock grid. */}
          {/* TABLE-FIXED with an explicit column plan, and a min-width that fits an ordinary laptop (was 1100px, which forced a
              horizontal scrollbar at every realistic width — owner, 2026-09-06). Fixed layout also stops a long product title
              stretching the Style column and squeezing the money columns off the right, which is what actually caused it: the
              numbers are the point of the row and they must never be the part that gets pushed out of view. */}
          <table className="w-full min-w-[930px] table-fixed border-separate border-spacing-0 text-sm">
            <colgroup>
              <col className="w-10" />
              <col />
              <col className="w-28" />
              <col className="w-16" />
              <col className="w-14" />
              <col className="w-16" />
              <col className="w-20" />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-8" />
            </colgroup>
            <thead>
              <tr>
                {/* Row number. Position in the CURRENT sort, not an id — it renumbers when you sort or filter, which is the point:
                    it answers "how far down am I" and "how many did that narrowing leave", both of which the operator asks while
                    working a long list. */}
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">
                  #
                </th>
                <Th label="Style" col="groupid" {...{ sortKey, sortDir, onSort }} align="left" />
                <Th label="Campaign" col="campaign" {...{ sortKey, sortDir, onSort }} align="left" />
                <Th label="Sizes" col="sizes" {...{ sortKey, sortDir, onSort }} />
                {/* THE SEAM separates what the style DID from what it COST and what is left of it.
                    KEPT IS PROFIT NET OF AD SPEND, and it is the only profit figure on the grid. It began as two columns — product
                    profit and Kept, with the spend between them — which put two money figures in competition and left the reader to
                    do the subtraction. Ad spend stays beside it because "what is this costing me" is its own triage question, and
                    the two add back to product profit if it is ever wanted (also on the Kept cell's tooltip).
                    The name matches Reports > Ad Efficiency, where the same figure has always been Kept — one word, one meaning,
                    both screens (owner, 2026-09-06). */}
                <Th label="Sold" col="sold" {...{ sortKey, sortDir, onSort }} />
                <Th label="Conv." col="conv" {...{ sortKey, sortDir, onSort }} />
                <Th label="Ad spend" col="spend" {...{ sortKey, sortDir, onSort }} seam />
                <Th label="Kept" col="kept" {...{ sortKey, sortDir, onSort }} />
                <Th label="Kept / sale" col="keptper" {...{ sortKey, sortDir, onSort }} />
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
              )}
              {!loading && painted.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-400">
                  No styles left. Press Reset to start again.
                </td></tr>
              )}
              {painted.map((r, i) => {
                const w = r[win];
                const isSel = selected.has(r.groupid);
                const perSale = keptPerSale(w);
                const conv = convPct(r, win);
                // NO "Google says …" LINE HERE (owner, 2026-09-06). The row used to flag any style whose last Google-reported label
                // differed from ours, as a feed-health warning. It cannot actually be that: our copy of Google's view is only as
                // fresh as the last import, so the flag really said "the ad data I hold predates this assignment" — true of every
                // style straight after a reset, and silent about whether the feed works. A warning that fires on 13 styles for a
                // reason unrelated to the fault it names is noise.
                //
                // The comparison is still worth having WITH DATES ATTACHED, and that is what the drill's label runs already do
                // (BIRK-WINNER 29 Apr -> 5 Sep, then STANDARD 5 Sep) — there it is history rather than an unqualified alarm.
                return (
                  <tr
                    key={r.groupid}
                    // The whole row is the target — see toggleRow for the click rules. The Style link and the cut ✕ stop
                    // propagation so they keep doing their own jobs.
                    onClick={(e) => toggleRow(r.groupid, i, e)}
                    className={`cursor-pointer select-none border-b border-slate-100 ${isSel ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <td className="border-b border-slate-100 px-2 py-1.5 text-right align-top text-xs tabular-nums text-slate-400">
                      {i + 1}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1.5">
                      {/* Drill disabled (owner, 2026-09-06) in favour of freely selecting rows — not removed, see setDrill above.
                          Only the icon opens the Shopify price setter (NEW TAB, ad-payback's convention) — the rest of this cell,
                          including the name, is just row text now, because a link over the whole block was too big a target and
                          ate clicks meant for selecting the row. stopPropagation on the icon so it doesn't also toggle selection. */}
                      <div className="w-full text-left">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-800">
                          {r.groupid}
                          <Link
                            href={`/pricing/style/${encodeURIComponent(r.groupid)}?from=/google-ads`}
                            target="_blank"
                            rel="noopener"
                            onClick={(e) => e.stopPropagation()}
                            title="Open in Shopify Pricing"
                            className="text-slate-400 hover:text-brand-700"
                          >
                            <ArrowTopRightOnSquareIcon className="h-3 w-3 flex-none" />
                          </Link>
                        </span>
                        {!r.googleLive && (
                          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500" title="Not in the Google feed (googlestatus off)">off Google</span>
                        )}
                        {/* The brand prefix is stripped for display only — see styleName. The underlying title is what the filter
                            still matches, so typing BIRKENSTOCK behaves exactly as it did. */}
                        <div className="truncate text-xs text-slate-500" title={r.title || undefined}>{styleName(r.title)}</div>
                      </div>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1.5">
                      <span className="text-slate-700">{r.campaign || '—'}</span>
                    </td>
                    {/* Sizes buyable today, out of sizes listed. Amber under THIN_SIZES — an absolute count, see the constant for
                        the numbers behind it. The row's money problem is a stock problem wearing an ads costume. */}
                    <td
                      className={`border-b border-slate-100 px-2 py-1.5 text-right tabular-nums ${
                        // sizesListed 0 means the style is not in skumap at all — a data gap, not a thin shelf. It renders as a
                        // dash and must not also wear the warning colour, or the two faults become one number.
                        r.sizesListed > 0 && r.sizesInStock < THIN_SIZES ? 'font-medium text-amber-700' : 'text-slate-600'
                      }`}
                      title={`${r.sizesInStock} of ${r.sizesListed} sizes in stock · ${r.stock} units on the shelf${
                        r.sizesInStock < THIN_SIZES ? ` · under ${THIN_SIZES} buyable sizes, where clicks stop converting` : ''
                      }`}
                    >
                      {r.sizesListed === 0 ? '—' : `${r.sizesInStock}/${r.sizesListed}`}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1.5 text-right tabular-nums text-slate-600">{w.units}</td>
                    {/* Greyed below the click floor: the rate is real but too thin to act on, and that is a display caveat rather
                        than a reason to drop the row out of the sort. */}
                    <td
                      className={`border-b border-slate-100 px-2 py-1.5 text-right tabular-nums ${
                        w.clicks < CONV_MIN_CLICKS ? 'text-slate-400' : conv < 2 ? 'font-medium text-amber-700' : 'text-slate-600'
                      }`}
                      title={w.clicks < CONV_MIN_CLICKS
                        ? `${w.units} from ${w.clicks} clicks — under ${CONV_MIN_CLICKS}, too few to read much into`
                        : `${w.units} sales from ${w.clicks} clicks`}
                    >
                      {conv}%
                    </td>
                    <td className="border-b border-l border-slate-200 border-b-slate-100 px-2 py-1.5 text-right tabular-nums text-slate-600">{money(w.spend)}</td>
                    <td className={`border-b border-slate-100 px-2 py-1.5 text-right font-semibold tabular-nums ${
                      w.profitAfterSpend < 0 ? 'text-red-600' : 'text-slate-900'
                    }`} title={`£${Math.round(w.profit).toLocaleString('en-GB')} product profit, less £${Math.round(w.spend).toLocaleString('en-GB')} paid to Google`}>
                      {money(w.profitAfterSpend)}
                    </td>
                    <td className={`border-b border-slate-100 px-3 py-1.5 text-right tabular-nums ${
                      perSale < 0 ? 'text-red-600' : w.units === 0 ? 'text-slate-400' : 'text-slate-600'
                    }`} title={w.units === 0 ? 'Nothing sold in this window — see Kept for what it still cost' : `${w.units} sold`}>
                      £{perSale.toFixed(2)}
                    </td>
                    <td className="border-b border-slate-100 px-1 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); cutRow(r.groupid); }}
                        title="Cut this row from the list (Reset brings it back)"
                        aria-label={`Cut ${r.groupid}`}
                        className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Bulk assign ------------------------------------------------------------------------------------------------ */}
      {selected.size > 0 && (
        <div className="sticky bottom-0 z-20 mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-slate-700">
            {selected.size} style{selected.size === 1 ? '' : 's'} selected
          </span>
          <select
            value={assignTo}
            onChange={(e) => setAssignTo(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Move to campaign…</option>
            {assignable.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
          <button
            type="button"
            onClick={runAssign}
            disabled={!assignTo || assigning}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {assigning ? 'Moving…' : 'Move'}
          </button>
          <button
            type="button"
            onClick={cutSelected}
            title="Hide these rows from the list — Reset brings them back"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cut
          </button>
          <button type="button" onClick={clearSelection} className="text-sm text-slate-500 hover:text-slate-700">
            Clear selection
          </button>
          <span className="ml-auto text-xs text-slate-400">Reaches Google after tonight&rsquo;s feed</span>
        </div>
      )}

      {drill && <GoogleAdsDrill groupid={drill} onClose={() => setDrill(null)} />}
    </AppShell>
  );
}

// A removable narrowing. Clearing hands focus back to Contains so the next hunt starts by typing — Inventory's behaviour.
function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
      {label}
      <button type="button" onClick={onClear} className="text-slate-400 hover:text-slate-700" aria-label={`Clear ${label}`}>
        <XMarkIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

// A sortable heading. `seam` draws the hairline that separates our numbers from Google's.
function Th({ label, col, sortKey, sortDir, onSort, align = 'right', seam }: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
  seam?: boolean;
}) {
  const active = sortKey === col;
  return (
    <th className={`sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide ${seam ? 'border-l border-l-slate-300' : ''}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`flex w-full items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'} ${active ? 'text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
      >
        {label}
        {active && <span aria-hidden>{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}
