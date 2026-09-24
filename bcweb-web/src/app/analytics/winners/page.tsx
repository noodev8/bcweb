'use client';
/*
=======================================================================================================================================
Page: /analytics/winners  (Reports — Winners)
=======================================================================================================================================
Purpose: THE RANGE BY PORTFOLIO STATUS, AND WHETHER IT IS MOVING. Every style carries a STORED tag — WINNERS | STEADY | NEW |
         HARVEST | LOSERS (skusummary.portfolio_status) — and this screen counts them, splits the winners by brand, and draws how
         the five have moved across recorded Updates.

REBUILT 2026-09-24 AROUND THE STORED TAGS (owner): "Instead of determining the WINNERS all the time, lets tag it in the database",
then "remove the current headline stats and code. Replace them with our new stats. Shape it as winners having the bigger box.
Have the graph include all our status to track progress." The old screen — a live hero count (which also counted deleted styles),
RANGE and ADDED headlines, revenue / units / more-on-the-way boxes, and a winners-vs-range trend — is gone; it is in git history,
and GET /portfolio-winners still serves its data untouched. NOTHING ON THIS SCREEN IS COMPUTED LIVE: it reads GET /portfolio-status
only, so no figure here can disagree with the tag the repricer will filter on.

THE RULES, first match wins (bcweb-server/utils/portfolioStatus.js): WINNERS > £1,500 gross revenue in 12 months → STEADY sold in
the last 3 months → NEW created under 90 days ago → HARVEST out of season (Summer Apr–Aug, Winter Sep–Mar; 'Any' never) → LOSERS.

THE DIAL STAYS, "JUST FOR SCREEN REPORTING" (owner, 2026-09-24). It filters the TAGGED winners on the revenue stamped beside the tag
at the last Update: at £1,500 it is exactly the tag count, at £2,500+ a subset. It moves the WINNERS box and the brand list and
nothing else — the other four statuses have no bar, and the graph records the tag. It is view state only; nothing is sent anywhere.

THE BRANDS STAY TOO ("now or later I want to see the brands"). Winners and units side by side because they disagree — a brand with
many modest winners and a brand with few huge ones are different businesses.

EVERY CARD OPENS ITS LIST ON REPRICING (2026-09-24): /pricing/<STATUS>?by=status — ONE unsplit list of the status's in-stock
styles (no Selling / Stuck), with "← Winners" back here. The list counts the out-of-stock ones it leaves out, which is why it can be
shorter than the card. Repricing's own first tab (Status, which replaced Top earners) opens the same lists.

ONE BUTTON: "Update now" re-tags every style AND records today's point on the status graph, in one transaction (it also still
writes the old portfolio_snapshot row, which nothing draws). Pressing twice in a day overwrites today's point, never appends.

COLOUR. The page is slate; the five status hues exist only because the graph needs to tell five lines apart, and each box wears its
line's colour as a small dot so the hue is a key, not decoration. Categorical slots 1–5 of the dataviz reference palette, validated
(adjacent CVD ΔE ≥ 9.1). Three sit under 3:1 on white, so every line also carries a direct text label at its end — identity is
never colour alone.

Guarded by AppShell. Consumes GET /portfolio-status and POST /portfolio-snapshot-update.
=======================================================================================================================================
*/

import { Suspense, useMemo, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import {
  getPortfolioStatus,
  updatePortfolioSnapshot,
  PORTFOLIO_STATUSES,
  type PortfolioStatusName,
  type PortfolioStatusPoint,
  type PortfolioStatusCount,
} from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import Link from 'next/link';
import { STATUS_COLOR, STATUS_RULE, statusListHref } from '@/lib/portfolioStatusUi';

// Whole pounds — the dial marks are round amounts and pence would be noise.
function money(v: number): string {
  return `£${Math.round(v).toLocaleString('en-GB')}`;
}

// 'YYYY-MM-DD' -> '24 Sep'. Built from the string parts, never `new Date(...)` — pg DATEs are cast to text precisely so no timezone
// can shift the day (CLAUDE.md: the DB session runs UTC, the box BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : iso || '—';
}

// A card opens its status's list on Repricing (the one unsplit list, /pricing/<STATUS>?by=status), whose "← Winners" returns here.
const cardHref = (s: PortfolioStatusName) => statusListHref(s, '/analytics/winners', 'Winners');

const pct1 = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : null);

export default function WinnersPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <WinnersPageInner />
    </Suspense>
  );
}

function WinnersPageInner() {
  const searchParams = useSearchParams();
  const backHref = searchParams.get('from') || '/analytics';
  const backLabel = searchParams.get('back') || 'Reports';

  const { logout } = useAuth();
  const [updating, setUpdating] = useState(false);
  // Kept apart from the query's own error so a failed Update doesn't tear down a screen that loaded fine.
  const [actionError, setActionError] = useState<string | null>(null);

  const q = useApiQuery('portfolio-status', () => getPortfolioStatus());
  const status = q.data?.status;
  const winners = useMemo(() => q.data?.winners ?? [], [q.data]);
  const history = q.data?.history ?? [];
  const bars = q.data?.bars ?? [];
  const trackedBar = bars[0] ?? null;

  // WHICH BAR IS ON SCREEN. null = the tag's own bar. View state only.
  const [bar, setBar] = useState<number | null>(null);
  const selBar = bar ?? trackedBar;
  const offTracked = selBar !== null && trackedBar !== null && selBar !== trackedBar;

  // The tagged winners at the selected bar — a filter on the STAMPED revenue. At the tracked bar this is every tagged winner.
  const winnersAtBar = useMemo(
    () => (offTracked && selBar !== null ? winners.filter((w) => w.revenue12m > selBar) : winners),
    [winners, offTracked, selBar]
  );

  const brands = useMemo(() => {
    const m = new Map<string, { brand: string; winners: number; units: number }>();
    for (const w of winnersAtBar) {
      const key = (w.brand || '').trim() || 'Unbranded';
      const b = m.get(key) || { brand: key, winners: 0, units: 0 };
      b.winners += 1;
      b.units += w.units12m;
      m.set(key, b);
    }
    return [...m.values()].sort((a, b) => b.winners - a.winners || b.units - a.units);
  }, [winnersAtBar]);
  const topBrandWinners = Math.max(1, ...brands.map((b) => b.winners));

  const total = status?.total ?? 0;
  const neverRun = !q.isLoading && status !== undefined && status.updatedAt === null;
  const byStatus = new Map((status?.statuses ?? []).map((s) => [s.status, s]));
  const countOf = (s: PortfolioStatusName) => byStatus.get(s)?.count ?? 0;
  const winnerCount = offTracked ? winnersAtBar.length : countOf('WINNERS');

  // Movement since the previous recorded Update. The last history point IS the current tagging (same press), so compare it with
  // the one before. Neutral ink for every status: "more HARVEST" is the calendar, not a verdict.
  const prevPoint = history.length > 1 ? history[history.length - 2] : null;
  const since = (s: PortfolioStatusName): number | null => (prevPoint ? countOf(s) - prevPoint[s] : null);

  const when = status?.updatedAt ? `${shortDate(status.updatedAt)}, ${status.updatedAt.slice(11, 16)}` : null;

  // NO SUCCESS BANNER — the boxes, the "tagged" time and the graph all change when the refresh lands; that is the confirmation.
  async function onUpdate() {
    setUpdating(true);
    setActionError(null);
    const res = await updatePortfolioSnapshot();
    if (res.success) {
      await q.refresh();
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setActionError(res.error || 'Failed to update');
    }
    setUpdating(false);
  }

  // No `title` on AppShell — the screen names itself through the WINNERS box, the one word that matters most.
  return (
    <AppShell backHref={backHref} backLabel={backLabel}>
      {actionError && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}

      {/* THE DIAL — written as a sentence, the definition read aloud. Moves the WINNERS box and the brands only. */}
      {bars.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-slate-500">A winner turns over more than</span>
          <div className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1 shadow-sm">
            {bars.map((b) => (
              <button
                key={b}
                onClick={() => setBar(b)}
                aria-pressed={selBar === b}
                className={
                  selBar === b
                    ? 'rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-white tabular-nums'
                    : 'rounded px-3 py-1.5 text-sm text-slate-600 tabular-nums transition hover:bg-slate-50'
                }
              >
                {money(b)}
              </button>
            ))}
          </div>
          <span className="text-sm text-slate-500">in 12 months</span>
        </div>
      )}

      {/* THE TOTAL AND THE BUTTON, above the boxes they describe. The total is the whole catalogue; the five boxes sum to it. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-slate-600">
          {q.isLoading || !status ? (
            ' '
          ) : (
            <>
              <span className="text-lg font-semibold tabular-nums text-slate-900">{total.toLocaleString('en-GB')}</span> styles
              in total
              <span className="text-xs text-slate-400">
                {when && ` · tagged ${when}`}
                {status.addedSince > 0 && ` · ${status.addedSince} added since`}
                {status.untagged > 0 && ` · ${status.untagged} not tagged yet`}
              </span>
            </>
          )}
        </p>
        <button
          onClick={onUpdate}
          disabled={updating || q.isLoading}
          className="ml-auto rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {updating ? 'Updating…' : 'Update now'}
        </button>
      </div>

      {neverRun ? (
        <p className="mb-6 rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No styles tagged yet — press <span className="font-medium">Update now</span> to set them.
        </p>
      ) : (
        /* WINNERS IS THE HERO — half the width, two rows tall, twice the type. The other four are its siblings in a 2×2. */
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:grid-rows-2">
          {/* Every card opens its status's list on Repricing (owner, 2026-09-24). The list is always the TAGGED set — the dial is a
              reading, so at £2,500 the WINNERS card still opens all tagged winners; the list says so by being the tag. */}
          <Link
            href={cardHref('WINNERS')}
            className="group col-span-2 flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 sm:p-8 lg:row-span-2"
          >
            {q.isLoading ? (
              <div className="h-36 animate-pulse rounded bg-slate-100" />
            ) : (
              <>
                <div className="flex items-baseline gap-4">
                  <span className="text-7xl font-semibold tabular-nums leading-none text-slate-900 sm:text-8xl">
                    {winnerCount.toLocaleString('en-GB')}
                  </span>
                  <span className="text-2xl tabular-nums text-slate-500">
                    {pct1(winnerCount, total) === null ? '—' : `${pct1(winnerCount, total)}%`}
                  </span>
                </div>
                <p className="mt-3 flex items-center gap-2 text-xl text-slate-600">
                  <Dot status="WINNERS" /> winners
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  {offTracked && selBar !== null
                    ? `over ${money(selBar)} in 12 months — ${countOf('WINNERS')} tagged at ${money(trackedBar ?? 0)}`
                    : STATUS_RULE.WINNERS}
                </p>
                {!offTracked && <Since value={since('WINNERS')} date={prevPoint?.date} />}
                <RepriceHint />
              </>
            )}
          </Link>

          {/* GREYED WHEN THE DIAL IS OFF £1,500 (owner, 2026-09-24: "we shouldn't show the other stats or we should grey them to
              make it clear"). These four have no bar — they are the tag, which is always the £1,500 test — so beside a £2,500
              winner count they would read as if they belonged to it. Greyed rather than hidden so the layout does not jump. */}
          {(['STEADY', 'NEW', 'HARVEST', 'LOSERS'] as const).map((s) => (
            <StatusBox
              key={s}
              status={s}
              row={byStatus.get(s)}
              loading={q.isLoading}
              since={since(s)}
              sinceDate={prevPoint?.date}
              dimmed={offTracked}
            />
          ))}
        </div>
      )}

      {/* WINNERS BY BRAND, at the dial's bar. Winners and units together BECAUSE they disagree. */}
      {brands.length > 0 && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-baseline justify-between text-xs text-slate-400">
            <span>winners by brand{offTracked && selBar !== null ? `, over ${money(selBar)}` : ''}</span>
            <span>units shifted</span>
          </div>
          <ul className="grid grid-cols-1 gap-x-8 gap-y-1.5 md:grid-cols-2">
            {brands.map((b) => (
              <li key={b.brand} className="flex items-center gap-3 text-sm">
                <span className="w-28 flex-none truncate text-slate-600" title={b.brand}>{b.brand}</span>
                <span className="w-6 flex-none text-right font-medium tabular-nums text-slate-900">{b.winners}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-slate-400"
                    style={{ width: `${Math.max(2, (b.winners / topBrandWinners) * 100)}%` }}
                  />
                </span>
                <span className="w-14 flex-none text-right tabular-nums text-slate-400">{b.units.toLocaleString('en-GB')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* PROGRESS — all five statuses across recorded Updates. */}
      {/* Greyed off £1,500 for the same reason as the four boxes: it records the tag, not the dial. */}
      {history.length > 1 ? (
        <div
          className={offTracked ? 'pointer-events-none opacity-40 grayscale transition' : 'transition'}
          aria-disabled={offTracked}
          title={offTracked ? 'Tagged at £1,500 — not affected by the dial' : undefined}
        >
          <StatusTrendChart rows={history} />
        </div>
      ) : history.length === 1 ? (
        <p className="text-xs text-slate-400">
          One reading so far ({shortDate(history[0].date)}). The graph appears once there are two — press Update now on another day.
        </p>
      ) : null}
    </AppShell>
  );
}

function Dot({ status }: { status: PortfolioStatusName }) {
  return <span className="inline-block h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: STATUS_COLOR[status] }} />;
}

// Movement since the previous recorded Update, in neutral ink. Hidden until there are two readings.
function Since({ value, date }: { value: number | null; date: string | undefined }) {
  if (value === null || !date) return null;
  return (
    <p className="mt-1 text-xs tabular-nums text-slate-400">
      {value === 0 ? 'no change' : `${value > 0 ? '+' : '−'}${Math.abs(value)}`} since {shortDate(date)}
    </p>
  );
}

function StatusBox({
  status,
  row,
  loading,
  since,
  sinceDate,
  dimmed = false,
}: {
  status: PortfolioStatusName;
  row: PortfolioStatusCount | undefined;
  loading: boolean;
  since: number | null;
  sinceDate: string | undefined;
  dimmed?: boolean;               // the dial is off £1,500 — this count is the tag, not the dial's reading
}) {
  // A link to the status's Repricing list. Still a link when dimmed — the dim says "not what the dial is reading", not "unavailable".
  return (
    <Link
      href={cardHref(status)}
      className={`group flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 ${dimmed ? 'opacity-40 grayscale' : ''}`}
      title={dimmed ? 'Tagged at £1,500 — not affected by the dial' : undefined}
    >
      <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500">
        <Dot status={status} /> {status}
      </p>
      {loading ? (
        <div className="mt-2 h-9 animate-pulse rounded bg-slate-100" />
      ) : (
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums text-slate-900">{(row?.count ?? 0).toLocaleString('en-GB')}</span>
          <span className="text-sm tabular-nums text-slate-500">{row?.pct == null ? '—' : `${row.pct}%`}</span>
        </div>
      )}
      <p className="mt-1 text-xs text-slate-400">{STATUS_RULE[status]}</p>
      <Since value={since} date={sinceDate} />
      <RepriceHint />
    </Link>
  );
}

// The quiet cue that a card opens somewhere. Pinned to the card's foot (mt-auto) and brightened on hover, so the cards still read
// as figures first — the same restraint as the rest of the page.
function RepriceHint() {
  return (
    <span className="mt-auto pt-2 text-right text-xs text-slate-300 transition group-hover:text-slate-600">Reprice →</span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// THE STATUS TREND — five lines on ONE axis (all are counts of styles), one per recorded Update day. Hover anywhere for a crosshair
// and all five values on that day. Each line ends in a text label (status + count) in slate ink: three of the five hues sit under
// 3:1 on white, so the label, not the colour, carries identity. Labels are nudged apart when two lines end close together.
// ---------------------------------------------------------------------------------------------------------------------------------
function StatusTrendChart({ rows }: { rows: PortfolioStatusPoint[] }) {
  const W = 760, H = 260, padL = 36, padR = 104, padT = 12, padB = 24;
  const n = rows.length;
  const [hover, setHover] = useState<number | null>(null);

  const maxY = Math.max(1, ...rows.flatMap((r) => PORTFOLIO_STATUSES.map((s) => r[s]))) * 1.1;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);

  // End labels, de-collided: sort by y, then push each at least 13px below the one above.
  const last = rows[n - 1];
  const labels = PORTFOLIO_STATUSES.map((s) => ({ s, y: y(last[s]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 13);

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  }

  const h = hover === null ? null : rows[hover];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Status over time</span>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          {PORTFOLIO_STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ backgroundColor: STATUS_COLOR[s] }} /> {s.toLowerCase()}
            </span>
          ))}
        </span>
      </div>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ minWidth: 480 }}
          role="img"
          aria-label="Styles in each portfolio status over time"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {[0, Math.round(maxY / 2), Math.round(maxY)].map((v) => (
            <g key={`g${v}`}>
              <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#f1f5f9" />
              <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
            </g>
          ))}

          {rows.map((r, i) => {
            const step = Math.max(1, Math.ceil(n / 6));
            if (i % step !== 0 && i !== n - 1) return null;
            return (
              <text key={`x${r.date}`} x={x(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">
                {shortDate(r.date)}
              </text>
            );
          })}

          {hover !== null && <line x1={x(hover)} y1={padT} x2={x(hover)} y2={H - padB} stroke="#cbd5e1" />}

          {PORTFOLIO_STATUSES.map((s) => (
            <g key={s}>
              <polyline
                points={rows.map((r, i) => `${x(i)},${y(r[s])}`).join(' ')}
                fill="none"
                stroke={STATUS_COLOR[s]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* The end marker, with a surface ring so overlapping ends stay separable. */}
              <circle cx={x(n - 1)} cy={y(last[s])} r={4} fill={STATUS_COLOR[s]} stroke="#fff" strokeWidth={2} />
              {hover !== null && (
                <circle cx={x(hover)} cy={y(rows[hover][s])} r={4} fill={STATUS_COLOR[s]} stroke="#fff" strokeWidth={2} />
              )}
            </g>
          ))}

          {labels.map(({ s, y: ly }) => (
            <text key={`l${s}`} x={x(n - 1) + 10} y={ly + 3} fontSize="10" fill="#475569">
              {s.toLowerCase()} {last[s]}
            </text>
          ))}
        </svg>

        {h && hover !== null && (
          <div
            className="pointer-events-none absolute top-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              // Right half opens leftwards, so the box never runs off the card. `>=` with (n - 1): with two readings the last
              // point is index 1 and `hover > n / 2` let it open rightwards, clipped, with a scrollbar.
              transform: hover >= (n - 1) / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            }}
          >
            <p className="mb-1 font-medium text-slate-700">{shortDate(h.date)}</p>
            {PORTFOLIO_STATUSES.map((s) => (
              <p key={s} className="flex items-center gap-2 tabular-nums text-slate-600">
                <Dot status={s} />
                <span className="w-16">{s.toLowerCase()}</span>
                <span className="ml-auto font-medium text-slate-900">{h[s]}</span>
              </p>
            ))}
            <p className="mt-1 border-t border-slate-100 pt-1 tabular-nums text-slate-400">{h.total} in total</p>
          </div>
        )}
      </div>
    </div>
  );
}
