'use client';
/*
=======================================================================================================================================
Component: StatusTrendChart
=======================================================================================================================================
Purpose: The portfolio status trend — five lines (WINNERS | STEADY | NEW | HARVEST | LOSERS), one point per recorded "Update now" day.
         Moved out of the Winners screen (retired 2026-09-25); drawn on Repricing's Status tab. The caller picks the rows (all channels, or one
         channel's counts) — the chart just draws what it is given.
=======================================================================================================================================
*/

import { useState, type MouseEvent, type ReactNode } from 'react';
import { PORTFOLIO_STATUSES, type PortfolioStatusName, type PortfolioStatusPoint } from '@/lib/api';
import { STATUS_COLOR } from '@/lib/portfolioStatusUi';

// 'YYYY-MM-DD' -> '24 Sep', from the string parts — never new Date (CLAUDE.md: a pg DATE must not be timezone-shifted).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : iso || '—';
}

function Dot({ status }: { status: PortfolioStatusName }) {
  return <span className="inline-block h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: STATUS_COLOR[status] }} />;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// THE STATUS TREND — five lines on ONE axis (all are counts of styles), one per recorded Update day. Hover anywhere for a crosshair
// and all five values on that day. Each line ends in a text label (status + count) in slate ink: three of the five hues sit under
// 3:1 on white, so the label, not the colour, carries identity. Labels are nudged apart when two lines end close together.
// ---------------------------------------------------------------------------------------------------------------------------------
export default function StatusTrendChart({ rows, showTotal = true, headerExtra = null }: {
  rows: PortfolioStatusPoint[];
  showTotal?: boolean;          // the tooltip's "N in total" — off for a per-channel reading, where the all-channel total would
                                // be a cross-channel figure (owner, 2026-09-25: the Shopify / Amazon split stays clean)
  headerExtra?: ReactNode;      // e.g. a channel switch, drawn beside the title
}) {
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
        {headerExtra}
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
            {showTotal && <p className="mt-1 border-t border-slate-100 pt-1 tabular-nums text-slate-400">{h.total} in total</p>}
          </div>
        )}
      </div>
    </div>
  );
}
