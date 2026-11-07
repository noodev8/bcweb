'use client';
/*
=======================================================================================================================================
Page: /seo — SEO work list (owner, 2026-11-07; a tile in the dashboard's Google group)
=======================================================================================================================================
Purpose: what to work on for free Google clicks. The owner asked for a screen "to help communicate my questions to you and to help me
understand what to work on" — the WORK LIST first, ONE ROW PER STYLE (Arizona, Madrid, Gizeh…, all its colour pages added together),
because the idea being tested is to write a style's description once and use it on every colour (docs/seo/PLAN.md).

Why the Words column leads the explanation: the 165 live Birkenstock pages carry ~87 words, mostly Birkenstock's own marketing copy
that other retailers use word-for-word; the one page of ours that climbed to #1 (the size-6 blog) had 490 words of our own clear answer.

Columns (Search Console, last 28 days to its last complete day; profit from sales):
  Pages · Words (median description length) · Searches (times a page was shown on Google) · Clicks · Position (average place on
  Google, lower is better — a diagnostic, never the score) · Profit 12m (Shopify, net of returns).
Sorted by profit by default; every column header sorts. Click a style: its pages (each opens on the shop in a new tab) and the
searches its pages showed for. READ ONLY — nothing on this screen changes anything. Server: GET /seo-styles.
=======================================================================================================================================
*/

import { Fragment, useMemo, useState } from 'react';
import { ChevronRightIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSeoStyles, type SeoStyleRow } from '@/lib/api';

type SortKey = 'style' | 'pages' | 'words' | 'impressions' | 'clicks' | 'position' | 'profit';

const COLS: { key: SortKey; label: string; title: string; align: 'left' | 'right' }[] = [
  { key: 'style', label: 'Style', title: 'Birkenstock style — all its colour pages together', align: 'left' },
  { key: 'pages', label: 'Pages', title: 'Product pages live on the shop (one per colour / width)', align: 'right' },
  { key: 'words', label: 'Words', title: 'Typical description length (median across its pages)', align: 'right' },
  { key: 'impressions', label: 'Searches', title: 'Times one of its pages was shown on Google, last 28 days', align: 'right' },
  { key: 'clicks', label: 'Clicks', title: 'Times someone clicked through from Google, last 28 days', align: 'right' },
  { key: 'position', label: 'Position', title: 'Average place on Google (1 = top). Lower is better', align: 'right' },
  { key: 'profit', label: 'Profit 12m', title: 'Shopify profit over 12 months, net of returns', align: 'right' },
];

const n = (v: number) => v.toLocaleString('en-GB');
const pos = (v: number | null) => (v == null ? '—' : v.toFixed(1));
const gbp = (v: number) => `${v < 0 ? '−' : ''}£${Math.abs(v).toLocaleString('en-GB')}`;
// '2026-11-04' → '4 Nov' (text, never a Date — CLAUDE.md BST day-shift)
const day = (s: string | null) => {
  if (!s) return '—';
  const [, m, d] = s.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
};

export default function SeoPage() {
  const q = useApiQuery('seo-styles', () => getSeoStyles());
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'profit', desc: true });
  const [openStyle, setOpenStyle] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = [...(q.data?.rows ?? [])];
    const { key, desc } = sort;
    list.sort((a, b) => {
      if (key === 'style') return desc ? b.style.localeCompare(a.style) : a.style.localeCompare(b.style);
      // Blanks (no searches → no position, no description → no words) always sink to the bottom.
      const av = a[key]; const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return desc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
    return list;
  }, [q.data, sort]);

  function sortBy(key: SortKey) {
    // First click: biggest first — except Style (A–Z) and Position (best, i.e. lowest, first).
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: !(key === 'style' || key === 'position') }));
  }

  return (
    <AppShell title="SEO work list">
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {q.isLoading && <p className="text-sm text-slate-400">Loading… (reading Google Search Console)</p>}

      {q.data && (
        <>
          <div className="mb-4 text-sm text-slate-500">
            <p>
              Birkenstock styles, all their colour pages together. Google figures are the last {q.data.window_days} days to{' '}
              {day(q.data.data_to)}; descriptions as fetched from Shopify on {day(q.data.descriptions_fetched)}.
            </p>
            <p className="mt-0.5">Click a style for its pages and what people searched. Nothing here changes anything.</p>
          </div>

          <div className="overflow-clip rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white text-[11px] uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]">
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} title={c.title} className={'px-3 py-2.5 font-medium ' + (c.align === 'right' ? 'text-right' : 'pl-4 text-left')}>
                      <button type="button" onClick={() => sortBy(c.key)} className="uppercase tracking-wide hover:text-slate-800">
                        {c.label}{sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = openStyle === r.style;
                  return (
                    <Fragment key={r.style}>
                      <tr
                        onClick={() => setOpenStyle(isOpen ? null : r.style)}
                        aria-expanded={isOpen}
                        className={'cursor-pointer border-b border-slate-100 ' + (isOpen ? 'bg-slate-50' : 'hover:bg-slate-50')}
                      >
                        <td className="py-2 pl-4 pr-3">
                          <div className="flex items-center gap-1 font-semibold text-slate-900">
                            <ChevronRightIcon className={'h-4 w-4 shrink-0 text-slate-400 transition-transform ' + (isOpen ? 'rotate-90' : '')} />
                            {r.style.charAt(0) + r.style.slice(1).toLowerCase()}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.pages}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.words ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{n(r.impressions)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.clicks || <span className="text-slate-300">·</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pos(r.position)}</td>
                        <td className="px-3 py-2 pr-4 text-right font-medium tabular-nums text-slate-800">{gbp(r.profit)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <td colSpan={COLS.length} className="px-4 pb-4 pt-1">
                            <StylePanel row={r} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}

// THE DROP-DOWN for one style: its pages (most searched first) and the searches they showed for.
function StylePanel({ row }: { row: SeoStyleRow }) {
  return (
    <div className="grid gap-6 rounded-lg border border-slate-200 bg-white p-4 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-1.5 text-sm font-medium text-slate-700">Its pages</p>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="py-1.5 pr-3 text-left font-medium">Page</th>
              <th className="py-1.5 pr-3 text-right font-medium">Words</th>
              <th className="py-1.5 pr-3 text-right font-medium">Searches</th>
              <th className="py-1.5 pr-3 text-right font-medium">Clicks</th>
              <th className="py-1.5 text-right font-medium">Position</th>
            </tr>
          </thead>
          <tbody>
            {row.page_list.map((p) => (
              <tr key={p.handle} className="border-b border-slate-100 last:border-0">
                <td className="whitespace-nowrap py-1.5 pr-3">
                  <a
                    href={`https://brookfieldcomfort.com/products/${p.handle}`}
                    target="_blank"
                    rel="noreferrer"
                    title={p.handle}
                    className="flex items-center gap-1 text-slate-700 hover:text-brand-700"
                  >
                    <span className="font-mono text-[13px] font-medium">{p.groupid}</span>
                    <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  </a>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{p.words ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{p.impressions ? n(p.impressions) : <span className="text-slate-300">·</span>}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{p.clicks || <span className="text-slate-300">·</span>}</td>
                <td className="py-1.5 text-right tabular-nums">{pos(p.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="min-w-0">
        <p className="mb-1.5 text-sm font-medium text-slate-700">What people searched</p>
        {row.queries.length === 0 ? (
          <p className="text-sm text-slate-400">No named searches in the last 28 days (Google hides rare ones).</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-1.5 pr-3 text-left font-medium">Search</th>
                <th className="py-1.5 pr-3 text-right font-medium">Shown</th>
                <th className="py-1.5 pr-3 text-right font-medium">Clicks</th>
                <th className="py-1.5 text-right font-medium">Position</th>
              </tr>
            </thead>
            <tbody>
              {row.queries.map((s) => (
                <tr key={s.query} className="border-b border-slate-100 last:border-0">
                  <td className="max-w-0 truncate py-1.5 pr-3 text-slate-700" title={s.query}>{s.query}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{n(s.impressions)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{s.clicks || <span className="text-slate-300">·</span>}</td>
                  <td className="py-1.5 text-right tabular-nums">{pos(s.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-slate-400">Searches add up across all its pages. Google hides rare searches, so these won’t sum to the page totals.</p>
      </div>
    </div>
  );
}
