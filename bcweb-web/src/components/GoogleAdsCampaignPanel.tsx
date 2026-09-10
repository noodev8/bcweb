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
import { PlusIcon, PencilIcon, TrashIcon, ExclamationTriangleIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import {
  GoogleAdsBucket, GoogleAdsCampaign, GOOGLE_CAMPAIGN_MAX_NAME,
  googleAdsCampaignCreate, googleAdsCampaignUpdate, googleAdsCampaignDelete,
} from '@/lib/api';

function money(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
}
function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

// BLENDED BREAK-EVEN ROAS — the revenue ROAS this bucket must earn before its advertising pays for itself, which is the number that
// gets typed into the Ads UI as a tROAS target. Revenue over net profit: earn less than this multiple of spend-driving revenue and
// the goods do not cover the ads.
//
// AT BUCKET GRAIN ON PURPOSE, and this is the whole reason it lives here instead of on the grid where it started (owner,
// 2026-09-10: "how does B/E ROAS help?"). Per style it was net margin inverted — ~18% on most of the book, so it printed the same
// 5-6x down the page — and it detonated wherever profit approached zero, because the denominator was shrinking, not the finding.
// Summed over a bucket the denominator is big enough to mean something, AND a tROAS is a per-campaign setting anyway, so the figure
// and the thing it configures finally share a grain.
//
// NULL WHEN THERE IS NO PROFIT TO DEFEND (profit <= 0, or no revenue). Not Infinity and not a large number: a bucket that loses
// money before a penny of ad spend has no target that rescues it, which is a different statement from "needs 25x". Kept is where
// that loss is already reported.
function blendedBreakEven(b: GoogleAdsBucket): number | null {
  if (b.profit <= 0 || b.revenue <= 0) return null;
  return Math.round((b.revenue / b.profit) * 10) / 10;
}

// The most this account has ever actually delivered. Blended revenue ROAS over the 90 days to 5 Sep 2026 was 6.0, the best spend
// decile managed 6.3, and no margin band anywhere in the book came back above 7.6. A bucket needing more than this is asking for
// something never once achieved on any cohort — not a bidding problem, and no target fixes it.
const BE_UNREACHABLE = 10;


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
  const [editNotes, setEditNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    // Lowercased again here, not only in the input's onChange — a paste or browser autofill can land a value the
    // handler never saw, and the name is the key everything else joins on.
    const res = await googleAdsCampaignCreate({ name: newName.trim().toLowerCase(), notes: newNotes.trim() || undefined });
    setBusy(false);
    if (!res.success) { setError(res.error || 'Could not create the campaign'); return; }
    setAdding(false); setNewName(''); setNewNotes('');
    onChanged();
  }

  // ONE SAVE FOR BOTH FIELDS. The route already took `newName` and `notes` in a single call and applies them in one transaction, so
  // splitting them into two buttons would be two round-trips and two chances to half-apply an edit the operator made as one.
  //
  // `notes` is sent ALWAYS, not only when changed, and that is what makes clearing the text possible: the route reads an empty
  // string as "blank the notes" and only `undefined` as "leave them alone". Sending it conditionally would mean a note could be
  // written and corrected but never removed.
  async function saveEdit(from: string) {
    setBusy(true); setError(null);
    const res = await googleAdsCampaignUpdate({
      name: from,
      newName: editName.trim().toLowerCase(),
      notes: editNotes.trim(),
    });
    setBusy(false);
    if (!res.success) { setError(res.error || 'Could not save the campaign'); return; }
    setEditing(null);
    onChanged();
  }

  // TWO-STEP, NOT A DIALOG. The app uses no window.confirm anywhere and a modal for one irreversible click would be the only one on
  // the screen. Arming turns the bin into the word "Delete?" in place, so the confirm sits exactly where the click landed and
  // dismisses itself the moment attention moves — clicking anything else, or the same row again.
  const [armed, setArmed] = useState<string | null>(null);

  async function remove(name: string) {
    setBusy(true); setError(null);
    const res = await googleAdsCampaignDelete({ name });
    setBusy(false);
    setArmed(null);
    // The server owns every refusal here and each one carries its own remedy — how many styles are in the way, or that the name has
    // Google history and should be archived instead. Passed through untouched rather than flattened into "could not delete".
    if (!res.success) { setError(res.error || 'Could not delete the campaign'); return; }
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
                <p className="text-xs text-slate-400">{windowLabel}</p>
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
          <form onSubmit={create} className="border-b border-slate-200 bg-slate-50 px-4 pb-7 pt-3">
            {/* items-end aligns the BOTTOMS of the columns, so anything hanging below an input pushes its neighbours down.
                The character counter is therefore taken out of flow (absolute) and the form reserves room for it with pb-7:
                every input in the row then sits on the same line, counter or not. */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="relative">
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
                {/* Campaign names are lowercase by convention — forced as you type so a shifted key never creates a second
                    campaign that differs from an existing one only by case. */}
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value.toLowerCase())}
                  autoFocus
                  placeholder="e.g. birk-summer"
                  className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                {/* The 20-character limit is the database column's width, not a preference. Counted as you type so it is never
                    discovered by finding a truncated label in the Google Ads UI. */}
                <div className={`absolute left-0 top-full mt-1 text-xs tabular-nums ${overLimit ? 'font-medium text-red-600' : 'text-slate-400'}`}>
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
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 text-left font-semibold">Campaign</th>
                <th className="px-2 py-2 text-right font-semibold">Styles</th>
                <th className="px-2 py-2 text-right font-semibold">Stock</th>
                <th className="px-2 py-2 text-right font-semibold">Units</th>
                <th className="px-2 py-2 text-right font-semibold">Profit</th>
                <th className="px-2 py-2 text-right font-semibold">Spend</th>
                <th className="px-2 py-2 text-right font-semibold">Kept</th>
                <th
                  className="px-2 py-2 text-right font-semibold"
                  title="What share of a campaign's profit went to Google — lower is better, 100% is break-even. The column to compare campaigns on, since Kept rewards size. Figures are for the styles in each campaign TODAY over the chosen window: a style brings its history with it when you move it."
                >Ad take</th>
                {/* The SETTING, where every other column is an outcome — so it sits last, after the figures that justify it. */}
                <th
                  className="px-4 py-2 text-right font-semibold"
                  title="Break-even ROAS — the revenue ROAS this campaign must earn before its ads pay for themselves. Ours, not Google's: these styles' revenue divided by their net profit. This is the number to set as the campaign's tROAS target, with headroom on top."
                >B/E ROAS</th>
                <th className="w-20 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => {
                const active = activeBucket === b.name;
                const be = blendedBreakEven(b);
                return (
                  <tr
                    key={b.name}
                    className={`border-b border-slate-100 last:border-0 ${active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-4 py-2">
                      {editing === b.name ? (
                        // Stacked, mirroring how the row READS when it is not being edited — name on top, notes in smaller grey
                        // underneath. The notes field is deliberately unconstrained: it is free text in the database with no length
                        // limit, unlike the name, which is varchar(20) and shipped to Google as a label.
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value.toLowerCase())}
                              autoFocus
                              maxLength={GOOGLE_CAMPAIGN_MAX_NAME}
                              className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
                            />
                            <button type="button" onClick={() => saveEdit(b.name)} disabled={busy} className="text-xs font-medium text-brand-600 hover:text-brand-700">Save</button>
                            <button type="button" onClick={() => setEditing(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                          </div>
                          <input
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            placeholder="What this bucket is for (optional)"
                            title="Free text. Clear it to remove the note."
                            className="w-full max-w-md rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
                          />
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
                    {/* Last column, where the eye lands: this is what campaigns get compared on. Red only at 100%+, where the ads
                        have outrun the profit — the same threshold that turns Kept red, so the two never disagree. Everything below
                        that is slate: a number to compare, not a warning light. */}
                    <td className={`px-2 py-2 text-right tabular-nums ${b.adTake !== null && b.adTake >= 100 ? 'text-red-600' : 'text-slate-600'}`}>
                      {b.adTake === null ? '—' : `${b.adTake.toFixed(0)}%`}
                    </td>
                    {/* Amber above BE_UNREACHABLE, dash when there is no margin to defend at all. Two states, not three: the grid's
                        old "too few units to trust the margin" grey does not apply to a bucket, which is the aggregate that made
                        the sample big enough in the first place. */}
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${
                        be === null ? 'text-slate-400'
                          : be > BE_UNREACHABLE ? 'font-medium text-amber-700'
                          : 'text-slate-600'
                      }`}
                      title={
                        be === null
                          ? (b.units === 0
                              ? 'Nothing sold in this window — no margin to measure'
                              : 'These styles lost money before a penny of ad spend, so no ROAS target makes the bucket pay. Reprice or split it.')
                          : `${((b.profit / b.revenue) * 100).toFixed(1)}% net margin — needs ${be.toFixed(1)}x revenue ROAS to break even.` +
                            (be > BE_UNREACHABLE
                              ? ` Above ${BE_UNREACHABLE}x, which this account has never delivered on any cohort.`
                              : ' Set the campaign tROAS above this, not at it.')
                      }
                    >
                      {be === null ? '—' : `${be.toFixed(1)}x`}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {/* EVERY MANAGED BUCKET IS EDITABLE (owner, 2026-09-07). 'standard' and 'pause' used to be excluded here and
                          refused by both routes, on the basis that other code depended on the literal names. It does not:
                          product-create.js seeds 'new', and 'pause' is hard-coded nowhere. The guard outlived the thing it guarded.
                          `managed` still gates this — an unmanaged name has no google_campaign row to rename or delete. */}
                      {b.managed && editing !== b.name && (
                        // Leaving the row disarms a pending delete. Without it "Delete?" would stay armed indefinitely with no way
                        // back except deleting something else, and an irreversible action must never be the only exit from a state.
                        <div className="flex justify-end gap-1" onMouseLeave={() => setArmed((a) => (a === b.name ? null : a))}>
                          <button
                            type="button"
                            title="Rename"
                            onClick={() => { setEditing(b.name); setEditName(b.name); setEditNotes(b.notes || ''); setError(null); }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          {/* ARCHIVE IS GONE FROM THE UI (owner, 2026-09-07), NOT FROM THE SERVER. google-ads-campaign-update still
                              accepts `archived`, so nothing is lost and it can come back as one button.

                              It was removed because two buttons offering "make this bucket go away" is one too many, and the choice
                              between them turned on a distinction that turned out not to matter: whether Google had ever reported
                              the name. It does not — the report tables key on a text label with no foreign key, so deleting the
                              definition leaves them readable. Delete is now the single, unconditional way to remove a bucket, and
                              whether to use it is the operator's call rather than the server's.

                              THE ARCHIVED STYLING BELOW STAYS. No bucket is archived today, but if one ever is (an older row, or a
                              direct call) it must still render, struck through, rather than vanish — a hidden bucket whose label
                              keeps going out in the feed is precisely the silent state this module exists to end. Note there is now
                              no way to UN-archive from the screen; that needs the button back. */}
                          {armed === b.name ? (
                            <button
                              type="button"
                              title={`Permanently delete "${b.name}". Its assignment history is kept.`}
                              onClick={() => remove(b.name)}
                              disabled={busy}
                              className="rounded px-1.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                            >
                              Delete?
                            </button>
                          ) : (
                            <button
                              type="button"
                              title="Delete"
                              onClick={() => { setArmed(b.name); setError(null); }}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
                <th className="px-2 py-2 text-right font-semibold" title="A bid or quality problem, not a budget one.">Lost to rank</th>
                <th className="px-4 py-2 text-right font-semibold" title="Near zero means spending more buys nothing — the impressions are already being won.">Lost to budget</th>
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
      </div>
      )}
    </section>
  );
}
