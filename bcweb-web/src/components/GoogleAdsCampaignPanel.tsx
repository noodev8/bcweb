'use client';
/*
=======================================================================================================================================
Component: GoogleAdsCampaignPanel
=======================================================================================================================================
Purpose: The campaign side of the Google Ads screen. Two lists, kept apart on purpose, plus the actions that manage the first one.

THE TWO LISTS ARE NOT THE SAME THING AND MERGING THEM WOULD INVENT NUMBERS
  Your campaigns   — the buckets this screen writes (skusummary.googlecampaign, shipped as Google's custom_label_0). A bucket is a
                     SET OF STYLES. Its money is real, summed from its members. It has NO impression share, because it is not a
                     campaign in Google's account — it is a label a campaign may or may not be scoped to.
  In Google Ads    — the actual campaigns, from the daily report. Impression share and lost-IS exist ONLY here.

Today there is one live Google campaign holding every bucket, which is exactly the situation being decided. When the account is split
so a campaign is scoped to one label, the two lists will line up by name — until then, showing them as one table would put an
impression share against a bucket that does not have one.

WHY LOST-TO-BUDGET IS THE COLUMN TO READ FIRST
August 2026: 91.9% impression share, 8.1% lost to rank, **0.0% lost to budget**. The account is not budget-constrained — moving budget
between campaigns cannot buy impressions that are already being won. What a split buys is separate tROAS control. The earlier splits
failed for reasons visible in this same column: IVES lost 78.4% of its impressions to budget (starved, not bad) and BIRK-WINNER lost
40.2% to rank (a bid problem a small campaign made worse).

THE FIGURES ARE CURRENT MEMBERSHIP OVER A PAST WINDOW, AND THE PANEL SAYS SO
A bucket's row reads "what the styles in it TODAY did over the window", not "what this bucket earned at the time". A style moved
yesterday brings its whole history with it. There is no honest alternative from this data, so the panel states the basis rather than
letting it be assumed.
=======================================================================================================================================
*/

import { useState } from 'react';
import { PlusIcon, PencilIcon, ArchiveBoxIcon, ExclamationTriangleIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import {
  GoogleAdsBucket, GoogleAdsCampaign, GOOGLE_CAMPAIGN_MAX_NAME,
  googleAdsCampaignCreate, googleAdsCampaignUpdate,
} from '@/lib/api';

function money(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
}
function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

// Names that carry behaviour elsewhere and cannot be renamed or archived (the server enforces this too; the UI just doesn't offer it).
const PROTECTED = new Set(['standard', 'pause']);

// Whether the panel is expanded, remembered per browser. It is COLLAPSED BY DEFAULT (owner, 2026-09-06): the two tables plus their
// footnotes took about 40% of the page and pushed the filter bar below the fold, so the screen opened on context instead of on the
// work. Collapsed, the header line still carries the numbers worth glancing at, and one click brings the detail back.
//
// Read in a LAZY INITIALISER rather than a mount effect, following GoodsInStation: that is safe here specifically because AppShell
// renders a splash instead of its children until auth has hydrated, so this component never renders on the server and there is no
// first paint for a stored value to disagree with. The `typeof window` guard is belt and braces for that assumption changing.
// localStorage also throws outright in some contexts (private windows, blocked site data) — a preference is never worth breaking the
// page for.
const OPEN_KEY = 'bc_googleads_campaigns_open';
function readOpen(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

interface Props {
  buckets: GoogleAdsBucket[];
  adsCampaigns: GoogleAdsCampaign[];
  windowLabel: string;
  onChanged: () => void;              // re-fetch after a create / rename / archive
  onFilterBucket: (name: string) => void;  // click a bucket row -> narrow the grid to it
  activeBucket: string | null;
}

export default function GoogleAdsCampaignPanel({
  buckets, adsCampaigns, windowLabel, onChanged, onFilterBucket, activeBucket,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await googleAdsCampaignCreate({ name: newName.trim(), notes: newNotes.trim() || undefined });
    setBusy(false);
    if (!res.success) { setError(res.error || 'Could not create the campaign'); return; }
    setAdding(false); setNewName(''); setNewNotes('');
    onChanged();
  }

  async function rename(from: string) {
    setBusy(true); setError(null);
    const res = await googleAdsCampaignUpdate({ name: from, newName: editName.trim() });
    setBusy(false);
    if (!res.success) { setError(res.error || 'Could not rename the campaign'); return; }
    setEditing(null);
    onChanged();
  }

  async function archive(name: string, archived: boolean) {
    setBusy(true); setError(null);
    const res = await googleAdsCampaignUpdate({ name, archived });
    setBusy(false);
    // The server refuses to archive a bucket that still holds styles, and its message says how many are in the way. Surfaced as-is:
    // it is more useful than anything this component could compose.
    if (!res.success) { setError(res.error || 'Could not archive the campaign'); return; }
    onChanged();
  }

  const overLimit = newName.trim().length > GOOGLE_CAMPAIGN_MAX_NAME;

  const [open, setOpen] = useState(readOpen);
  function toggle() {
    setOpen((v) => {
      const next = !v;
      try { window.localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* preference only */ }
      return next;
    });
  }

  // What the collapsed header has to carry: enough to not need opening for a glance. Live buckets only — an archived one holds
  // nothing by definition (the server refuses to archive a bucket with members).
  const live = buckets.filter((b) => !b.archived);
  const totals = live.reduce(
    (a, b) => ({ styles: a.styles + b.styles, spend: a.spend + b.spend, kept: a.kept + b.profitAfterSpend }),
    { styles: 0, spend: 0, kept: 0 }
  );

  return (
    <section className="space-y-4">
      {/* ---- OUR buckets ------------------------------------------------------------------------------------------------- */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <ChevronDownIcon className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />
            <div className="min-w-0">
              <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">Your campaigns</h2>
              {/* Collapsed, this line IS the panel. Expanded, it would just repeat the table underneath, so it steps back to the
                  caption it was before. */}
              {open ? (
                <p className="text-xs text-slate-400">Styles in each bucket today, over {windowLabel.toLowerCase()}</p>
              ) : (
                <p className="truncate text-xs text-slate-500">
                  {live.length} campaign{live.length === 1 ? '' : 's'} · {totals.styles} styles ·{' '}
                  {money(totals.spend)} spend · <span className={totals.kept < 0 ? 'font-medium text-red-600' : 'font-medium text-slate-700'}>{money(totals.kept)} kept</span>
                </p>
              )}
            </div>
          </button>
          <button
            type="button"
            onClick={() => { setAdding((v) => !v); setError(null); if (!open) toggle(); }}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <PlusIcon className="h-4 w-4" />
            New campaign
          </button>
        </div>
        {open && (<>

        {adding && (
          <form onSubmit={create} className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                  placeholder="e.g. BIRK-SUMMER"
                  className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                {/* The 20-character limit is the database column's width, not a preference. Counted as you type so it is never
                    discovered by finding a truncated label in the Google Ads UI. */}
                <div className={`mt-1 text-xs tabular-nums ${overLimit ? 'font-medium text-red-600' : 'text-slate-400'}`}>
                  {newName.trim().length} / {GOOGLE_CAMPAIGN_MAX_NAME} characters
                </div>
              </div>
              <div className="min-w-[220px] flex-1">
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Notes (optional)</label>
                <input
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="What this bucket is for"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <button
                type="submit"
                disabled={busy || !newName.trim() || overLimit}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
              >
                Create
              </button>
              <button type="button" onClick={() => { setAdding(false); setError(null); }} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700">
                Cancel
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 text-left font-semibold">Campaign</th>
                <th className="px-2 py-2 text-right font-semibold">Styles</th>
                <th className="px-2 py-2 text-right font-semibold">Stock</th>
                <th className="px-2 py-2 text-right font-semibold">Units</th>
                <th className="px-2 py-2 text-right font-semibold">Profit</th>
                <th className="px-2 py-2 text-right font-semibold">Spend</th>
                <th className="px-2 py-2 text-right font-semibold">Kept</th>
                <th className="px-4 py-2 text-right font-semibold">ROAS</th>
                <th className="w-20 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => {
                const active = activeBucket === b.name;
                return (
                  <tr
                    key={b.name}
                    className={`border-b border-slate-100 last:border-0 ${active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-4 py-2">
                      {editing === b.name ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                            maxLength={GOOGLE_CAMPAIGN_MAX_NAME}
                            className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
                          />
                          <button type="button" onClick={() => rename(b.name)} disabled={busy} className="text-xs font-medium text-brand-600 hover:text-brand-700">Save</button>
                          <button type="button" onClick={() => setEditing(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => onFilterBucket(b.name)} className="group text-left">
                          <span className={`font-medium ${b.archived ? 'text-slate-400 line-through' : 'text-slate-800 group-hover:text-brand-700'}`}>
                            {b.name}
                          </span>
                          {/* An unmanaged name is on skusummary but absent from the controlled list — almost always a typo, and a typo
                              here reaches Google and matches nothing. Flagged rather than hidden. */}
                          {!b.managed && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                              <ExclamationTriangleIcon className="h-3 w-3" /> not in list
                            </span>
                          )}
                          {b.notes && <div className="text-xs text-slate-400">{b.notes}</div>}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-700">{b.styles}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-500">{b.stock.toLocaleString('en-GB')}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-500">{b.units.toLocaleString('en-GB')}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-700">{money(b.profit)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-700">{money(b.spend)}</td>
                    <td className={`px-2 py-2 text-right font-semibold tabular-nums ${b.profitAfterSpend < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                      {money(b.profitAfterSpend)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{b.roas === null ? '—' : `${b.roas.toFixed(1)}×`}</td>
                    <td className="px-2 py-2 text-right">
                      {!PROTECTED.has(b.name.toLowerCase()) && b.managed && editing !== b.name && (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            title="Rename"
                            onClick={() => { setEditing(b.name); setEditName(b.name); setError(null); }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title={b.archived ? 'Un-archive' : 'Archive'}
                            onClick={() => archive(b.name, !b.archived)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          >
                            <ArchiveBoxIcon className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
          Figures are for the styles in each campaign <span className="font-medium">today</span>, over the chosen window — a style
          brings its history with it when you move it.
        </p>
        </>)}
      </div>

      {/* ---- GOOGLE'S campaigns ------------------------------------------------------------------------------------------
          ONE CAMPAIGN GETS ONE LINE, not a panel. There is exactly one live Google campaign today and there will be until the
          account is actually split, so a bordered card with a heading, a table and a footnote was spending a whole block of the page
          on four numbers (owner, 2026-09-06). The numbers themselves still matter — lost-to-budget is the figure that says whether
          splitting can buy anything — so they stay in full; only the furniture goes. It becomes a table again the moment there is
          more than one campaign to compare, which is the only situation a table was ever earning its space in. */}
      {adsCampaigns.length <= 1 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm">
          {adsCampaigns.length === 0 ? (
            <span className="text-slate-400">No campaign report imported for this window yet.</span>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">In Google Ads</span>
              <span className="font-medium text-slate-800">{adsCampaigns[0].campaign}</span>
              <span className="tabular-nums text-slate-600">{money(adsCampaigns[0].cost)} spend</span>
              {/* The censored-day count used to sit here as its own "N days withheld" note (dropped, owner 2026-09-06). It is a
                  caveat on the impression share, not a fact about the campaign, so it belongs on that figure's tooltip. */}
              <span
                className="tabular-nums text-slate-600"
                title={adsCampaigns[0].censoredDays > 0
                  ? `Averaged over the days Google reported a figure. It withheld the share on ${adsCampaigns[0].censoredDays} day${adsCampaigns[0].censoredDays === 1 ? '' : 's'} in this window; those are left out rather than counted as zero.`
                  : undefined}
              >
                {pct(adsCampaigns[0].searchImpShare)} impr. share
              </span>
              <span className="tabular-nums text-slate-500">{pct(adsCampaigns[0].lostIsRank)} lost to rank</span>
              <span
                className={`tabular-nums ${adsCampaigns[0].lostIsBudget !== null && adsCampaigns[0].lostIsBudget >= 10 ? 'font-medium text-amber-700' : 'text-slate-500'}`}
                title="Near zero means spending more buys nothing — the impressions are already being won."
              >
                {pct(adsCampaigns[0].lostIsBudget)} lost to budget
              </span>
            </div>
          )}
        </div>
      ) : (
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">In Google Ads</h2>
          <p className="text-xs text-slate-400">
            Impression share only exists at this level — a campaign here can hold several of your buckets
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 text-left font-semibold">Campaign</th>
                <th className="px-2 py-2 text-right font-semibold">Days</th>
                <th className="px-2 py-2 text-right font-semibold">Spend</th>
                <th className="px-2 py-2 text-right font-semibold">Clicks</th>
                <th className="px-2 py-2 text-right font-semibold">Impr. share</th>
                <th className="px-2 py-2 text-right font-semibold">Lost to rank</th>
                <th className="px-4 py-2 text-right font-semibold">Lost to budget</th>
              </tr>
            </thead>
            <tbody>
              {adsCampaigns.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">
                  No campaign report imported for this window yet.
                </td></tr>
              )}
              {adsCampaigns.map((c) => (
                <tr key={c.campaign} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">{c.campaign}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">{c.days}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-700">{money(c.cost)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">{c.clicks.toLocaleString('en-GB')}</td>
                  {/* Averaged over the days Google actually reported a figure — see the one-line version above for why the censored
                      count lives on this tooltip rather than beside the campaign name. */}
                  <td
                    className="px-2 py-2 text-right tabular-nums text-slate-700"
                    title={c.censoredDays > 0
                      ? `Averaged over the days Google reported a figure. It withheld the share on ${c.censoredDays} day${c.censoredDays === 1 ? '' : 's'} in this window; those are left out rather than counted as zero.`
                      : undefined}
                  >
                    {pct(c.searchImpShare)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">{pct(c.lostIsRank)}</td>
                  {/* The decision column. 0% here means more budget buys nothing — the impressions are already being won. */}
                  <td className="px-4 py-2 text-right">
                    <span className={`font-semibold tabular-nums ${
                      c.lostIsBudget === null ? 'text-slate-400'
                        : c.lostIsBudget >= 10 ? 'text-amber-700'
                        : 'text-slate-900'}`}
                    >
                      {pct(c.lostIsBudget)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
          Lost to <span className="font-medium">budget</span> near zero means spending more buys nothing — the impressions are already
          being won. Lost to <span className="font-medium">rank</span> is a bid or quality problem instead.
        </p>
      </div>
      )}
    </section>
  );
}
