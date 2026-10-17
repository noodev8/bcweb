'use client';
/*
=======================================================================================================================================
Page: /slider/[id] — one Pricing Slider group
=======================================================================================================================================
Purpose: Everything about one slider (owner, 2026-10-17): its rules (edit, pause / resume, end, delete), its products and where each
         stands, adding and removing products, Reset to RRP, and its log. Consumes GET /slider-group.

THE PRODUCTS TABLE — live first (sliding, found, at floor), with "Show the N that left" for the history:
  Now        the current price on the channel and its % of RRP. "Priced outside the slider" = it isn't what the slider last set (someone
             repriced it on another screen); the next move will take it out rather than fight it.
  Floor      floor % of RRP, or break-even when the group ticks it and break-even is higher (marked BE).
  Next move  the price and the day it's due. The first move is due straight away; with Start from RRP it's the lift back to RRP.
  Floor by   the day it reaches the floor if every move is made on time and nothing sells.
  Sold       units sold on this channel since it joined (shop-counter sales don't count for a Shopify slider).

TICK + ACT (live products only): Reset to RRP — each ticked product back to RRP and out of the slider, ONE CALL PER PRODUCT
         (POST /slider-reset) like bulk Apply, so each Shopify push fires and reports on its own; on Amazon each reset joins the team's
         upload basket, whose download button sits in the title row here exactly as on the Amazon pricing pages. Remove — out of the
         slider, price left as it is.

MOVE PRICES (Shopify sliders; owner: no cron — every move is a button press). The button carries out what each due product's Next move
         says — a cut, the lift back to RRP, or settling one that sold (holds), reached the floor (holds) or was priced by hand on another
         screen (leaves). ONE CALL PER PRODUCT (POST /slider-step), like bulk Apply, so each Shopify push fires and reports on its own; the
         server re-decides each one inside its transaction (bcweb-server/utils/slider.js → decide), so a stale page or two people pressing
         at once can't move a price twice. A product with no stock WAITS (it can't sell, so a cut only gives margin away) and is due the
         moment stock arrives; a late press makes one move, not a catch-up. The confirm sits on its own row so a double click on the button
         can't land on it. Amazon sliders move through the upload basket — the next step of the build.

The product's code links to its Shopify / Amazon price screen, with ?from= so ← Back returns here.
=======================================================================================================================================
*/

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { mutate as mutateGlobal } from 'swr';
import { PlusIcon, PencilSquareIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import ChannelBadge from '@/components/ChannelBadge';
import SliderRulesForm from '@/components/SliderRulesForm';
import SliderAddPanel from '@/components/SliderAddPanel';
import AmzBasketBar, { AmzUploadButton } from '@/components/AmzBasketBar';
import { AmzBasketProvider, useAmzBasket, AmzBasketItem } from '@/contexts/AmzBasketContext';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getSliderGroup, removeFromSlider, resetSliderMember, setSliderGroupState, stepSliderMember,
  SliderAction, SliderGroupAction, SliderGroupDetail, SliderMember,
} from '@/lib/api';
import {
  ACTION_TALLY, DUE_ACTIONS, EVENT_LABEL, GROUP_STATE_COLOR, GROUP_STATE_LABEL, MEMBER_STATE_COLOR, MEMBER_STATE_LABEL,
  fmtDay, fmtWhen, isDue, money, rulesSummary,
} from '@/lib/sliderUi';

// The Next move column for a due product that the press settles rather than cuts.
const SETTLE_NOTE: Partial<Record<SliderAction, [string, string]>> = {
  found: ['Sold — holds at this price', 'text-emerald-700'],
  hold: ['Sold — holds another interval', 'text-emerald-700'],
  floor: ['At the floor — holds', 'text-amber-700'],
  repriced: ['Priced by hand — leaves the slider', 'text-amber-700'],
};

// A failed live push. Honest about the state: the price is saved here, Shopify still shows the old one. (Re-Applying the same price
// on the price screen would NOT retry — W1 logs a same-price Apply as a hold and sends Shopify nothing.)
const PUSH_FAILED = (keys: string[]) =>
  `Shopify didn't take ${keys.length} (${keys.join(', ')}) — the new price is saved here but the website still shows the old one`;

// "9 cuts · 1 back to RRP · 2 sold — hold another interval"
function tally(counts: Partial<Record<SliderAction, number>>): string {
  return DUE_ACTIONS.filter((a) => counts[a]).map((a) => `${counts[a]} ${ACTION_TALLY[a][counts[a] === 1 ? 0 : 1]}`).join(' · ');
}

export default function SliderGroupPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <SliderGroupLoader />
    </Suspense>
  );
}

// Loads the group, then mounts the body — inside the Amazon upload basket for an Amazon slider, so a reset lands in the same team basket
// the Amazon pricing pages use (the provider rebuilds it from the log, so nothing is lost between screens).
function SliderGroupLoader() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const valid = Number.isInteger(id) && id > 0;
  const q = useApiQuery(valid ? ['slider-group', id] : null, () => getSliderGroup(id));

  if (!valid || q.error) {
    return (
      <AppShell title="Pricing Slider" backHref="/slider" backLabel="Pricing Slider">
        <p className="text-sm text-red-700">{!valid ? 'Not a slider.' : q.error?.message}</p>
      </AppShell>
    );
  }
  if (!q.data) {
    return (
      <AppShell title="Pricing Slider" backHref="/slider" backLabel="Pricing Slider">
        <p className="text-sm text-slate-400">Loading…</p>
      </AppShell>
    );
  }
  const refresh = async () => {
    await q.refresh();
    mutateGlobal('slider-groups');   // the home list's counts
  };
  if (q.data.group.channel === 'AMZ') {
    return (
      <AmzBasketProvider>
        <AmzBody data={q.data} refresh={refresh} busy={q.busy} />
      </AmzBasketProvider>
    );
  }
  return <SliderBody data={q.data} refresh={refresh} busy={q.busy} />;
}

function AmzBody(props: BodyProps) {
  const { add } = useAmzBasket();
  return <SliderBody {...props} basketAdd={add} />;
}

interface BodyProps {
  data: SliderGroupDetail;
  refresh: () => Promise<void>;
  busy: boolean;
  basketAdd?: (item: AmzBasketItem) => void;
}

function SliderBody({ data, refresh, busy: loading, basketAdd }: BodyProps) {
  const router = useRouter();
  const { group, members, events, today } = data;
  const amz = group.channel === 'AMZ';
  const ended = group.state === 'ended';
  const selfUrl = `/slider/${group.id}`;

  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showLeft, setShowLeft] = useState(false);
  const [confirm, setConfirm] = useState<'end' | 'delete' | 'reset' | 'move' | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ verb: string; done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  const live = useMemo(() => members.filter((m) => m.live), [members]);
  const left = useMemo(() => members.filter((m) => !m.live), [members]);
  const shown = showLeft ? members : live;
  const pickedLive = live.filter((m) => picked.has(m.id));
  const allPicked = live.length > 0 && pickedLive.length === live.length;

  const sliding = live.filter((m) => m.state === 'sliding');
  // What the server's decide() says the next press acts on (nothing while paused), and what's due but waiting for stock.
  const dueRows = useMemo(() => live.filter(isDue), [live]);
  const dueNow = dueRows.length;
  const dueTally = useMemo(() => {
    const c: Partial<Record<SliderAction, number>> = {};
    for (const m of dueRows) { const a = m.action as SliderAction; c[a] = (c[a] || 0) + 1; }
    return tally(c);
  }, [dueRows]);
  const noStock = live.filter((m) => m.action === 'no_stock').length;
  const floorDates = sliding.map((m) => m.floor_by).filter((d): d is string => !!d).sort();
  const floorBy = floorDates.length ? floorDates[floorDates.length - 1] : null;
  const offTrack = live.filter((m) => m.off_track).length;

  // ---- group actions -------------------------------------------------------------------------------------------------------------
  async function groupAction(action: SliderGroupAction) {
    setBusy(true); setMsg(null); setConfirm(null);
    const r = await setSliderGroupState(group.id, action);
    setBusy(false);
    if (!(r.success && r.data)) { setMsg({ text: r.error || 'Could not update the slider', bad: true }); return; }
    if (action === 'delete') { mutateGlobal('slider-groups'); router.push('/slider'); return; }
    if (action === 'end') setMsg({ text: `Ended — ${r.data.left} product${r.data.left === 1 ? '' : 's'} left at their current price`, bad: false });
    await refresh();
  }

  // ---- member actions ------------------------------------------------------------------------------------------------------------
  async function onRemove() {
    if (pickedLive.length === 0) return;
    setBusy(true); setMsg(null);
    const r = await removeFromSlider(group.id, pickedLive.map((m) => m.id));
    setBusy(false);
    if (!(r.success && r.data)) { setMsg({ text: r.error || 'Could not remove', bad: true }); return; }
    setMsg({ text: `Removed ${r.data.removed.length} — ${r.data.removed.length === 1 ? 'its price is as it was' : 'their prices are as they were'}`, bad: false });
    setPicked(new Set());
    await refresh();
  }

  // One call per product (like bulk Apply), so every Shopify push fires and reports on its own row.
  async function onReset() {
    const rows = pickedLive;
    if (rows.length === 0) return;
    setConfirm(null); setBusy(true); setMsg(null);
    let changed = 0; let already = 0;
    const pushFailed: string[] = [];
    const errors: string[] = [];
    setProgress({ verb: 'Resetting', done: 0, total: rows.length });
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i];
      const r = await resetSliderMember(m.id);
      if (r.success && r.data) {
        if (r.data.changed) changed++; else already++;
        if (r.data.shopify && r.data.shopify.pushed === false) pushFailed.push(m.key);
        const b = r.data.basket;
        if (b && b.amz_sku && basketAdd) basketAdd({ ...b, amz_sku: b.amz_sku });
      } else {
        errors.push(`${m.key}: ${r.error || 'failed'}`);
      }
      setProgress({ verb: 'Resetting', done: i + 1, total: rows.length });
    }
    setProgress(null); setBusy(false); setPicked(new Set());
    const parts = [`${changed} reset to RRP`];
    if (already) parts.push(`${already} already at RRP (left the slider)`);
    if (amz && changed) parts.push('in the upload basket — download and upload to Amazon');
    if (pushFailed.length) parts.push(PUSH_FAILED(pushFailed));
    if (errors.length) parts.push(`${errors.length} failed: ${errors.join('; ')}`);
    setMsg({ text: parts.join(' · '), bad: pushFailed.length > 0 || errors.length > 0 });
    await refresh();
  }

  // Move prices: every due product, one call each. The server re-decides each one, so the tally is of what it DID, not what was shown.
  async function onMove() {
    const rows = dueRows;
    if (rows.length === 0) return;
    setConfirm(null); setBusy(true); setMsg(null); setPicked(new Set());
    const done: Partial<Record<SliderAction, number>> = {};
    let notDue = 0;
    const pushFailed: string[] = [];
    const flagged: string[] = [];
    const errors: string[] = [];
    setProgress({ verb: 'Moving', done: 0, total: rows.length });
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i];
      const r = await stepSliderMember(m.id);
      if (r.success && r.data) {
        const a = r.data.action;
        if (a) done[a] = (done[a] || 0) + 1; else notDue++;
        if (r.data.shopify && r.data.shopify.pushed === false) pushFailed.push(m.key);
        if (r.data.warnings.includes('BELOW_COST')) flagged.push(m.key);
      } else {
        errors.push(`${m.key}: ${r.error || 'failed'}`);
      }
      setProgress({ verb: 'Moving', done: i + 1, total: rows.length });
    }
    setProgress(null); setBusy(false);
    const parts = [tally(done) || 'Nothing moved'];
    if (notDue) parts.push(`${notDue} no longer due (already moved, or waiting for stock)`);
    if (flagged.length) parts.push(`below cost: ${flagged.join(', ')}`);
    if (pushFailed.length) parts.push(PUSH_FAILED(pushFailed));
    if (errors.length) parts.push(`${errors.length} failed: ${errors.join('; ')}`);
    setMsg({ text: parts.join(' · '), bad: pushFailed.length > 0 || errors.length > 0 });
    await refresh();
  }

  const priceHref = (m: SliderMember) => {
    const from = `?from=${encodeURIComponent(selfUrl)}`;
    return amz ? `/amz/sku/${encodeURIComponent(m.key)}${from}` : `/pricing/style/${encodeURIComponent(m.key)}${from}`;
  };

  const btn = 'rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
  const linkBtn = 'text-sm font-medium text-slate-900 hover:underline disabled:opacity-50';
  const overdue = group.due_date && group.due_date < today && !ended;

  return (
    <AppShell title={group.name} backHref="/slider" backLabel="Pricing Slider" headerRight={amz ? <AmzUploadButton /> : undefined}>
      {amz && <AmzBasketBar />}

      {/* ---- The group ----------------------------------------------------------------------------------------------------------- */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ChannelBadge channel={amz ? 'amazon' : 'shopify'} label={amz ? 'Amazon · per size' : 'Shopify · per style'} />
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${GROUP_STATE_COLOR[group.state]}`}>{GROUP_STATE_LABEL[group.state]}</span>
            </div>
            <div className="mt-2 text-sm text-slate-700">{rulesSummary(group)}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
              <span>Due date: <span className={overdue ? 'font-medium text-red-700' : 'text-slate-700'}>{fmtDay(group.due_date, today)}</span></span>
              {!ended && <span>Last floor reached: <span className="text-slate-700">{fmtDay(floorBy, today)}</span></span>}
              <span>Created {fmtWhen(group.created_at)}{group.created_by ? ` · ${group.created_by}` : ''}</span>
              {group.ended_at && <span>Ended {fmtWhen(group.ended_at)}</span>}
            </div>
            {group.notes && <div className="mt-1 text-sm text-slate-500">{group.notes}</div>}
          </div>

          {!ended && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setEditing((v) => !v)} disabled={busy} className={`${btn} inline-flex items-center gap-1.5`}>
                <PencilSquareIcon className="h-4 w-4" /> Edit rules
              </button>
              {group.state === 'active' ? (
                <button type="button" onClick={() => groupAction('pause')} disabled={busy} className={btn} title="Nothing in this slider is due while paused; the products stay in it">Pause</button>
              ) : (
                <button type="button" onClick={() => groupAction('resume')} disabled={busy} className={btn}>Resume</button>
              )}
              <button type="button" onClick={() => setConfirm(confirm === 'end' ? null : 'end')} disabled={busy} className={btn}>End</button>
            </div>
          )}
          {!group.priced && (
            <button type="button" onClick={() => setConfirm(confirm === 'delete' ? null : 'delete')} disabled={busy} className="text-sm text-slate-400 hover:text-red-700" title="Only while the slider has never changed a price">
              Delete
            </button>
          )}
        </div>

        {/* The confirm sits on its own row, so End / Delete never move under the pointer: a double-click on Delete must not land on End. */}
        {confirm === 'end' && !ended && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">End it? Every product leaves at its current price.</span>
            <button type="button" onClick={() => groupAction('end')} disabled={busy} className="rounded-md bg-slate-800 px-3 py-1.5 font-medium text-white hover:bg-slate-900">End slider</button>
            <button type="button" onClick={() => setConfirm(null)} className="text-slate-500 hover:text-slate-800">Cancel</button>
          </div>
        )}
        {confirm === 'delete' && !group.priced && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">Delete it and its log?</span>
            <button type="button" onClick={() => groupAction('delete')} disabled={busy} className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700">Delete</button>
            <button type="button" onClick={() => setConfirm(null)} className="text-slate-500 hover:text-slate-800">Cancel</button>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span><span className="font-semibold text-slate-900">{sliding.length}</span> <span className="text-slate-500">sliding</span></span>
            <span><span className="font-semibold text-emerald-700">{live.filter((m) => m.state === 'found').length}</span> <span className="text-slate-500">found</span></span>
            <span><span className="font-semibold text-amber-700">{live.filter((m) => m.state === 'floor').length}</span> <span className="text-slate-500">at floor</span></span>
            {left.length > 0 && <span><span className="font-semibold text-slate-500">{left.length}</span> <span className="text-slate-500">left</span></span>}
            {noStock > 0 && (
              <span className="text-slate-500" title="Due, but no stock — it can't sell, so it isn't cut. It's due again the moment stock arrives.">
                <span className="font-semibold text-slate-700">{noStock}</span> waiting for stock
              </span>
            )}
            {offTrack > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <ExclamationTriangleIcon className="h-4 w-4" /> {offTrack} priced outside the slider
              </span>
            )}
          </div>
          {group.state === 'active' && live.length > 0 && (amz ? (
            dueNow > 0 && (
              <span className="text-slate-600">
                <span className="font-semibold text-slate-900">{dueNow}</span> due — Amazon moves (through the upload basket) are the next step of the build
              </span>
            )
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(confirm === 'move' ? null : 'move')}
              disabled={busy || dueNow === 0}
              title={dueNow === 0 ? 'Nothing is due today' : undefined}
              className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {dueNow > 0 ? `Move prices · ${dueNow} due` : 'Nothing due'}
            </button>
          ))}
        </div>

        {/* Own row, away from the button above, so a double click can't confirm. */}
        {confirm === 'move' && dueNow > 0 && !amz && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-700">{dueTally}. New prices go live on Shopify now.</span>
            <button type="button" onClick={onMove} disabled={busy} className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">
              Move {dueNow}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="text-slate-500 hover:text-slate-800">Cancel</button>
          </div>
        )}
      </div>

      {editing && !ended && (
        <div className="mb-4">
          <SliderRulesForm
            initial={group}
            onSaved={async () => { setEditing(false); await refresh(); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}

      {adding && !ended && (
        <div className="mb-4">
          <SliderAddPanel groupId={group.id} channel={group.channel} onAdded={refresh} onClose={() => setAdding(false)} />
        </div>
      )}

      {/* ---- The products ------------------------------------------------------------------------------------------------------- */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {!ended && !adding && (
              <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
                <PlusIcon className="h-4 w-4" /> Add products
              </button>
            )}
            <span className="text-sm text-slate-500">{pickedLive.length > 0 ? `${pickedLive.length} ticked` : live.length > 0 ? 'Tick products to reset or remove them' : ''}</span>
            {pickedLive.length > 0 && (
              confirm === 'reset' ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-slate-600">
                    Put {pickedLive.length} back to RRP{amz ? ' (into the upload basket)' : ' — live on Shopify now'} and out of the slider?
                  </span>
                  <button type="button" onClick={onReset} disabled={busy} className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">Reset {pickedLive.length}</button>
                  <button type="button" onClick={() => setConfirm(null)} className="text-slate-500 hover:text-slate-800">Cancel</button>
                </span>
              ) : (
                <>
                  <button type="button" onClick={() => setConfirm('reset')} disabled={busy} className={linkBtn}>Reset {pickedLive.length} to RRP</button>
                  <button type="button" onClick={onRemove} disabled={busy} className={linkBtn} title="Out of the slider; the price stays as it is">Remove {pickedLive.length}</button>
                </>
              )
            )}
            {progress && <span className="text-sm text-slate-500">{progress.verb} {progress.done}/{progress.total}…</span>}
            {msg && !progress && <span className={`text-sm ${msg.bad ? 'text-red-700' : 'text-slate-600'}`}>{msg.text}</span>}
          </div>
          {left.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-500">
              <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400" />
              Show the {left.length} that left
            </label>
          )}
        </div>

        {shown.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">{ended ? 'Nothing in this slider.' : 'No products yet — press Add products.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={`w-full text-sm ${loading ? 'opacity-70' : ''}`}>
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="w-8 py-2 pl-4 pr-0">
                    <input
                      type="checkbox"
                      aria-label="Tick every live product"
                      checked={allPicked}
                      disabled={busy || live.length === 0}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(live.map((m) => m.id)))}
                      className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">{amz ? 'SKU' : 'Style'}</th>
                  <th className="px-3 py-2 text-right font-medium">Now</th>
                  <th className="px-3 py-2 text-right font-medium">RRP</th>
                  <th className="px-3 py-2 text-right font-medium">Floor</th>
                  <th className="px-3 py-2 font-medium">Next move</th>
                  <th className="px-3 py-2 font-medium" title="If every move is made on time and nothing sells">Floor by</th>
                  <th className="px-3 py-2 text-right font-medium">Moves</th>
                  <th className="px-3 py-2 text-right font-medium">{amz ? 'FBA' : 'Stock'}</th>
                  <th className="px-3 py-2 text-right font-medium" title="Units sold on this channel since it joined">Sold</th>
                  <th className="px-3 py-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.id} className={`border-b border-slate-100 text-slate-700 last:border-0 ${m.live ? 'hover:bg-slate-50' : 'text-slate-400'}`}>
                    <td className="w-8 py-2 pl-4 pr-0">
                      {m.live && (
                        <input
                          type="checkbox"
                          aria-label={`Tick ${m.key}`}
                          checked={picked.has(m.id)}
                          disabled={busy}
                          onChange={() => setPicked((s) => { const nx = new Set(s); if (nx.has(m.id)) nx.delete(m.id); else nx.add(m.id); return nx; })}
                          className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                        />
                      )}
                    </td>
                    <td className="max-w-[22rem] px-3 py-2">
                      <div className="whitespace-nowrap">
                        <Link href={priceHref(m)} title={amz ? 'Amazon price' : 'Shopify price'} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                          {m.key}
                        </Link>
                        {amz && m.size && <span className="ml-2 text-xs text-slate-400">size {m.size}</span>}
                      </div>
                      {m.title && <div className="truncate text-xs text-slate-500" title={m.title}>{m.title}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div className="font-semibold text-slate-900">{money(m.now)}</div>
                      {m.now_pct_rrp !== null && <div className="text-xs text-slate-400">{m.now_pct_rrp}% RRP</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(m.rrp)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" title={m.breakeven !== null ? `Break-even ${money(m.breakeven)}` : 'Break-even unknown (no cost)'}>
                      {money(m.floor)}{m.floor_by_breakeven && <span className="ml-1 text-[10px] font-semibold text-slate-400">BE</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {m.action && SETTLE_NOTE[m.action as SliderAction] ? (
                        // Due, and the press settles it rather than cuts it (sold / floor / priced by hand).
                        <span className={`text-xs font-semibold ${SETTLE_NOTE[m.action as SliderAction]![1]}`}>{SETTLE_NOTE[m.action as SliderAction]![0]}</span>
                      ) : m.action === 'no_price' ? (
                        <span className="text-xs text-red-700" title="Its Shopify price can't be read, so the slider won't step it">Price unreadable</span>
                      ) : m.state === 'sliding' && m.next_price !== null ? (
                        group.state === 'paused' ? <span className="text-slate-400">paused</span> : (
                          <>
                            <span className="tabular-nums">{money(m.next_price)}</span>
                            {m.action === 'no_stock' ? (
                              <span className="ml-1.5 text-xs text-slate-400" title="It can't sell, so it isn't cut — due again the moment stock arrives">waits for stock</span>
                            ) : (
                              <span className={`ml-1.5 text-xs ${isDue(m) ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>
                                {isDue(m) ? 'due now' : fmtDay(m.next_due, today)}
                              </span>
                            )}
                            {m.lift && <span className="ml-1.5 text-xs text-slate-400">(back to RRP)</span>}
                          </>
                        )
                      ) : m.state === 'found' ? (
                        <span className="text-emerald-700">holding {money(m.found_price ?? m.last_price)}</span>
                      ) : m.state === 'floor' ? (
                        <span className="text-amber-700">holding at floor</span>
                      ) : m.live ? '' : <span className="whitespace-normal text-xs">{fmtWhen(m.ended_at)}{m.ended_by ? ` · ${m.ended_by}` : ''}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{m.state === 'sliding' ? fmtDay(m.floor_by, today) : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums" title={`${m.steps} made so far`}>
                      {m.state === 'sliding' ? m.moves_left : m.steps || ''}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.stock}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.sold || ''}</td>
                    <td className="px-3 py-2">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${MEMBER_STATE_COLOR[m.state]}`}>{MEMBER_STATE_LABEL[m.state]}</span>
                      {m.off_track && (
                        <div className="mt-1 whitespace-nowrap text-[11px] text-amber-700" title={`The slider last set ${money(m.last_price)}`}>
                          Priced outside the slider
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- The log --------------------------------------------------------------------------------------------------------------- */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Log</h2>
        {events.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <div className="max-h-[24rem] overflow-auto">
            <table className="w-full text-sm">
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 text-slate-700 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{fmtWhen(e.created_at)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{e.created_by || ''}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{EVENT_LABEL[e.event] || e.event}</td>
                    <td className="whitespace-nowrap px-3 py-2">{e.item || ''}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                      {e.old_price !== null && e.new_price !== null && e.old_price !== e.new_price
                        ? `${money(e.old_price)} → ${money(e.new_price)}`
                        : e.new_price !== null ? money(e.new_price) : ''}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{e.detail || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
