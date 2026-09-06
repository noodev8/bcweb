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
and the typed commands differ because the questions do — this screen asks about SPEND and KEPT, not shelf sizes.

WHY THE DEFAULT SORT IS "KEPT", WORST FIRST
Every other list in this platform opens on something neutral. This one opens on the money it is losing, because that is the job: over
the 30 days to 5 Sep 2026, 55 styles cost more in ads than they made in profit — £1,578 of spend against £676 of profit — and another
78 drew spend having sold nothing at all. Those rows are the reason to open the screen, so they are what it opens on.

ALL FOUR WINDOWS SHIP IN ONE PAYLOAD (see the route header), so the window switch is a display change with no round-trip — the same
trade birk-stock makes with LIVE / FULL. Only the 30-day window has a like-for-like year-ago partner, so the comparison bar appears
there and is dropped rather than faked on the others.
=======================================================================================================================================
*/

import { useCallback, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, ArrowPathIcon, XMarkIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
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
// The metrics are this screen's questions: SPEND (what Google charged), KEPT (profit after that), STOCK, SOLD. All four compare
// against the CURRENTLY SELECTED WINDOW, so "SPEND MORE 50" means something different on 30d and 365d — which is correct, and the
// active chip names the window so it is never ambiguous.
type QtyMetric = 'spend' | 'kept' | 'stock' | 'sold';
interface QtyFilter { metric: QtyMetric; op: 'less' | 'more'; n: number }

function metricValue(r: GoogleAdsStyleRow, w: GoogleAdsWindowKey, metric: QtyMetric): number {
  if (metric === 'stock') return r.stock;
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

function applyCriteria(indexed: IndexedRow[], c: Criteria, w: GoogleAdsWindowKey): IndexedRow[] {
  let out = indexed;
  for (const s of c.steps) {
    const t = s.term.toLowerCase();
    // CONTAINS is a plain substring (operators type partials: "ARIZ" must find Arizona). DOES NOT CONTAIN is its exact mirror — the
    // legacy PowerBuilder rule, and the one Inventory settled on after a whole-word variant broke ¬WOMEN.
    out = s.op === 'has' ? out.filter((x) => x.hay.includes(t)) : out.filter((x) => !x.hay.includes(t));
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
  const m = upper.match(/^(SPEND|KEPT|STOCK|SOLD)\s+(LESS|MORE)\s+(-?\d+(?:\.\d+)?)$/);
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
    // Sorted on the SHARE of the run in stock, not the count: 4 of 11 is a worse shelf than 4 of 5, and the count alone hides that.
    case 'sizes': return r.sizesListed > 0 ? r.sizesInStock / r.sizesListed : 1;
    case 'sold': return win.units;
    case 'conv': { const c = convPct(r, w); return c === null ? Number.POSITIVE_INFINITY : c; }
    case 'spend': return win.spend;
    // KEPT is profit after ad spend — the grid shows no other kind of profit (owner, 2026-09-06: the column was called Profit, and
    // renaming it matches Reports > Ad Efficiency, where the same figure has always been Kept).
    case 'kept': return win.profitAfterSpend;
    // A style with nothing sold has no per-sale figure. Sent to the far end so it never sits among real ones.
    case 'keptper': { const v = keptPerSale(win); return v === null ? Number.POSITIVE_INFINITY : v; }
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
// Null when nothing sold: there is no per-sale figure for no sales, and a style that spent money selling none is already damned by
// its Kept column.
// Clicks that turned into a sale. THE column that says WHY a row is expensive, and it costs nothing — `clicks` was already in the
// payload and simply was not drawn.
//
// It separates two faults that look identical on money alone. Measured on the same day (2026-09-06), five styles with the biggest
// ad spend all drew 117-212 clicks at 42-71p each — Google treated them identically — and converted at 9.0%, 4.8%, 3.9%, 1.4% and
// 0.9%. The 10x spread in conversion, not the bidding, is the whole difference between a style that keeps 46% of its profit and one
// that loses four times it. Sorted ascending by default: the worst converter is the row to look at.
//
// Null below a click floor. One sale on three clicks is 33% and means nothing; printing it would put noise at the top of the sort.
const CONV_MIN_CLICKS = 20;
function convPct(r: GoogleAdsStyleRow, w: GoogleAdsWindowKey): number | null {
  const win = r[w];
  if (win.clicks < CONV_MIN_CLICKS) return null;
  return Math.round((win.units / win.clicks) * 1000) / 10;
}

function keptPerSale(w: GoogleAdsWindow): number | null {
  if (w.units <= 0) return null;
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
  const days = win === 'd30' ? 30 : win === 'd90' ? 90 : 365;
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
  const [drill, setDrill] = useState<string | null>(null);

  const [assignTo, setAssignTo] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const indexed = useMemo<IndexedRow[]>(() => rows.map((row) => ({ row, hay: haystack(row) })), [rows]);

  const criteria: Criteria = useMemo(
    () => ({ steps, qty, season, bucket }),
    [steps, qty, season, bucket]
  );
  const filtering = steps.length > 0 || qty.length > 0 || season !== null || bucket !== null;

  const visible = useMemo(
    () => applyCriteria(indexed, criteria, win).map((x) => x.row),
    [indexed, criteria, win]
  );

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
  // A changed filter or window invalidates the selection — the rows it referred to may no longer be on screen, and a bulk assign
  // that quietly included something you can no longer see is the worst thing this screen could do.
  const clearSelection = useCallback(() => { setSelected(new Set()); }, []);

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
      const narrowed = applyCriteria(indexed, { ...criteria, steps: [...steps, ...next], qty: nextQty, season: nextSeason }, win);
      setSteps(narrowed.length === 0 && filtering ? next : [...steps, ...next]);
    }
    setQty(nextQty);
    setSeason(nextSeason);
    setContains('');
    setNotContains('');
    clearSelection();
  }, [contains, notContains, qty, season, steps, indexed, criteria, filtering, win, clearSelection]);

  // Enter applies the boxes. Explicit rather than relying on the form's implicit submission: with two text inputs and no submit
  // button, browsers do NOT reliably submit on Enter — and this form deliberately has no Find button.
  const onEnter = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    onFind(e);
  }, [onFind]);

  const onReset = useCallback(() => {
    setSteps([]); setQty([]); setSeason(null); setBucket(null);
    setContains(''); setNotContains(''); setDrill(null);
    clearSelection();
    stylesQ.refresh();
    campaignsQ.refresh();
    containsRef.current?.focus();
  }, [clearSelection, stylesQ, campaignsQ]);

  const onSort = useCallback((key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(DEFAULT_DIR[key]); }
  }, [sortKey]);

  const toggleRow = useCallback((groupid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupid)) next.delete(groupid); else next.add(groupid);
      return next;
    });
  }, []);

  const allPaintedSelected = painted.length > 0 && painted.every((r) => selected.has(r.groupid));
  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (painted.length > 0 && painted.every((r) => prev.has(r.groupid))) {
        const next = new Set(prev);
        for (const r of painted) next.delete(r.groupid);
        return next;
      }
      const next = new Set(prev);
      for (const r of painted) next.add(r.groupid);
      return next;
    });
  }, [painted]);

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
            // Only the 30-day window has a like-for-like partner a year back. Comparing 365 days against 30 would be a fake.
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
            <Chip label={`Campaign: ${bucket}`} onClear={() => { setBucket(null); containsRef.current?.focus(); }} />
          )}
          {season && (
            <Chip label={season} onClear={() => { setSeason(null); containsRef.current?.focus(); }} />
          )}
          {qty.map((f) => (
            <Chip
              key={f.metric}
              label={`${f.metric.toUpperCase()} ${f.op} ${f.n}`}
              onClear={() => { setQty((list) => list.filter((x) => x.metric !== f.metric)); containsRef.current?.focus(); }}
            />
          ))}
          {steps.map((s, i) => (
            <Chip
              key={`${s.op}-${s.term}-${i}`}
              label={`${s.op === 'not' ? '¬ ' : ''}${s.term}`}
              onClear={() => { setSteps((list) => list.filter((_, j) => j !== i)); containsRef.current?.focus(); }}
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
          <table className="w-full min-w-[880px] table-fixed border-separate border-spacing-0 text-sm">
            <colgroup>
              <col className="w-9" />
              <col />
              <col className="w-28" />
              <col className="w-16" />
              <col className="w-14" />
              <col className="w-16" />
              <col className="w-20" />
              <col className="w-24" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={allPaintedSelected}
                    onChange={toggleAll}
                    aria-label="Select all shown"
                    className="h-4 w-4 rounded border-slate-300"
                  />
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
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
              )}
              {!loading && painted.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400">
                  No styles match. Clear a step or press Reset.
                </td></tr>
              )}
              {painted.map((r) => {
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
                    className={`border-b border-slate-100 ${isSel ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <td className="border-b border-slate-100 px-2 py-1.5 align-top">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleRow(r.groupid)}
                        aria-label={`Select ${r.groupid}`}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1.5">
                      <button type="button" onClick={() => setDrill(r.groupid)} className="block w-full text-left">
                        <span className="font-medium text-slate-800 hover:text-brand-700">{r.groupid}</span>
                        {!r.googleLive && (
                          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500" title="Not in the Google feed (googlestatus off)">off Google</span>
                        )}
                        {/* The brand prefix is stripped for display only — see styleName. The underlying title is what the filter
                            still matches, so typing BIRKENSTOCK behaves exactly as it did. */}
                        <div className="truncate text-xs text-slate-500" title={r.title || undefined}>{styleName(r.title)}</div>
                      </button>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1.5">
                      <span className="text-slate-700">{r.campaign || '—'}</span>
                    </td>
                    {/* Sizes in stock out of sizes listed. Amber under half the run: that is the level at which a click is more
                        likely than not to find nothing, and the row's money problem is a stock problem wearing an ads costume. */}
                    <td
                      className={`border-b border-slate-100 px-2 py-1.5 text-right tabular-nums ${
                        r.sizesListed > 0 && r.sizesInStock / r.sizesListed < 0.5 ? 'font-medium text-amber-700' : 'text-slate-600'
                      }`}
                      title={`${r.sizesInStock} of ${r.sizesListed} sizes in stock · ${r.stock} units on the shelf`}
                    >
                      {r.sizesListed === 0 ? '—' : `${r.sizesInStock}/${r.sizesListed}`}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1.5 text-right tabular-nums text-slate-600">{w.units}</td>
                    <td
                      className={`border-b border-slate-100 px-2 py-1.5 text-right tabular-nums ${
                        conv === null ? 'text-slate-400' : conv < 2 ? 'font-medium text-amber-700' : 'text-slate-600'
                      }`}
                      title={conv === null
                        ? `Under ${CONV_MIN_CLICKS} clicks in this window — too few to read a rate from`
                        : `${w.units} sales from ${w.clicks} clicks`}
                    >
                      {conv === null ? '—' : `${conv}%`}
                    </td>
                    <td className="border-b border-l border-slate-200 border-b-slate-100 px-2 py-1.5 text-right tabular-nums text-slate-600">{money(w.spend)}</td>
                    <td className={`border-b border-slate-100 px-2 py-1.5 text-right font-semibold tabular-nums ${
                      w.profitAfterSpend < 0 ? 'text-red-600' : 'text-slate-900'
                    }`} title={`£${Math.round(w.profit).toLocaleString('en-GB')} product profit, less £${Math.round(w.spend).toLocaleString('en-GB')} paid to Google`}>
                      {money(w.profitAfterSpend)}
                    </td>
                    <td className={`border-b border-slate-100 px-3 py-1.5 text-right tabular-nums ${
                      perSale === null ? 'text-slate-400' : perSale < 0 ? 'text-red-600' : 'text-slate-600'
                    }`} title={perSale === null ? 'Nothing sold in this window' : `${w.units} sold`}>
                      {perSale === null ? '—' : `£${perSale.toFixed(2)}`}
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
          <button type="button" onClick={() => setSelected(new Set())} className="text-sm text-slate-500 hover:text-slate-700">
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
