'use client';
/*
=======================================================================================================================================
Component: PriceEditor
=======================================================================================================================================
Purpose: Editable price block for a product (skusummary): Cost, RRP, Tax, and the base Shopify price. Saves via POST /product-price,
         which enforces the legacy rules (Cost > 0, RRP > 0, RRP >= Cost) and pushes live to Shopify (Admin API) and, if also live on
         Google, to Google Merchant Center's Content API — both when the product is on that channel.

         Two optional, light-touch extras borrowed from the pricing (harvest) screen — never required, so the normal "type price, save"
         flow is unchanged:
           - Note: a short reason for the change. It rides on the audit row, so it's only enabled when the Shopify price actually
             changes (no change = no log row = nowhere for a note to live).
           - Review: single-select day chips. Optional here (the harvest screen requires it). Picking one parks the style out of the
             pricing triage until today+N; independent of the price change.

         Self-contained: manages its own edit state + save. Mount with key={groupid} so it resets when the product changes. On a
         successful save it calls onSaved with the numbers actually written, so the parent panel can stay in sync.
=======================================================================================================================================
*/

import { useState } from 'react';
import { updateProductPrice, ProductPriceSaved, ShopifyPushResult, GooglePushResult, BirkPriceHint } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import ShopifyPushNote from '@/components/ShopifyPushNote';
import GooglePushNote from '@/components/GooglePushNote';

// Same review options as the pricing screen's PriceSetter (kept in sync deliberately).
const REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];

// Max length of the optional price-change note. Front-end only — kept short so notes stay to one tidy line on the Price Changes /
// history reports (matches the pricing setters + bulk bar, which write to the same price_change_log). The DB column is untouched.
const NOTE_MAX = 80;

interface Props {
  groupid: string;
  cost: number | null;
  rrp: number | null;
  price: number | null;
  tax: boolean;
  // Suggested RRP/cost from the birktracker order book — set only for an unpriced Birkenstock style; drives the optional prefill.
  birkPrice?: BirkPriceHint | null;
  onSaved?: (saved: ProductPriceSaved) => void;
}

// number|null -> input string ('' for null, else 2dp).
const toStr = (n: number | null) => (n === null || n === undefined ? '' : n.toFixed(2));

const moneyInputCls = 'w-full rounded-md border border-slate-300 pl-6 pr-2 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

// A £-prefixed money field. MODULE-LEVEL (not defined inside PriceEditor) so it isn't a new component type on every render — otherwise
// React would remount the input each keystroke and the field would lose focus.
function Money({ label, value, onChange, onBlur }: { label: string; value: string; onChange: (v: string) => void; onBlur?: () => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-2 text-sm text-slate-400">£</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          inputMode="decimal"
          placeholder="0.00"
          className={moneyInputCls}
        />
      </div>
    </div>
  );
}

export default function PriceEditor({ groupid, cost, rrp, price, tax, birkPrice, onSaved }: Props) {
  const { logout } = useAuth();

  // Birk order-book prefill: when this Birkenstock style is still unpriced (Cost or RRP blank/≤0) and the order book gave us a
  // suggestion, drop those numbers straight into the fields — Cost, RRP, and the Shopify Price (= RRP for a fresh product). They land
  // as UNSAVED edits (baseline stays the loaded values), so the form is pre-dirty: the operator can tweak anything, then just Save.
  const unpriced = !(Number(cost) > 0) || !(Number(rrp) > 0);
  const prefillFromBirk = !!birkPrice && unpriced && (birkPrice.rrp != null || birkPrice.cost != null);
  const loadedForm = { cost: toStr(cost), rrp: toStr(rrp), shopifyPrice: toStr(price), tax };
  const initialForm = prefillFromBirk
    ? {
        cost: birkPrice!.cost != null ? birkPrice!.cost.toFixed(2) : loadedForm.cost,
        rrp: birkPrice!.rrp != null ? birkPrice!.rrp.toFixed(2) : loadedForm.rrp,
        // Price field mirrors RRP for a new product (owner's rule); fall back to the loaded price when there's no RRP hint.
        shopifyPrice: birkPrice!.rrp != null ? birkPrice!.rrp.toFixed(2) : loadedForm.shopifyPrice,
        tax,
      }
    : loadedForm;

  const [form, setForm] = useState(initialForm);
  // Baseline is the LOADED (saved) values, not the prefill — so a prefilled form reads as dirty and Save is enabled straight away.
  const [baseline, setBaseline] = useState(() => JSON.stringify(loadedForm));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [push, setPush] = useState<ShopifyPushResult | null>(null);   // Shopify re-push outcome, when the product is live
  const [googlePush, setGooglePush] = useState<GooglePushResult | null>(null);   // Google Merchant re-push outcome, when live there
  const [savedInfo, setSavedInfo] = useState<{ logged: boolean; nextReview: string | null } | null>(null);
  // Optional extras (see header). reviewDays null = no review chosen; note '' = none.
  const [reviewDays, setReviewDays] = useState<number | null>(null);
  const [note, setNote] = useState('');

  // Has the Shopify price actually changed from what loaded? Drives whether a note is allowed (the note rides an audit row, which is
  // only written on a real price change) and whether the save will log.
  const priceChanged = (() => {
    const nw = Number(form.shopifyPrice);
    if (!Number.isFinite(nw) || nw <= 0) return false;
    if (price === null) return true;
    return Math.round(nw * 100) !== Math.round(price * 100);
  })();

  // Save is enabled by a change to any field OR a pending review/note extra.
  const dirty = JSON.stringify(form) !== baseline || reviewDays !== null || note.trim() !== '';

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
    setOk(false);
    setPush(null);
    setGooglePush(null);
    setSavedInfo(null);
  }

  // Single-select day chip.
  function pickReview(d: number) {
    setReviewDays(d);
    setOk(false);
    setSavedInfo(null);
  }
  // Explicit "None" — no review period (leaves next_shopify_price_review untouched on save).
  function setReviewNone() {
    setReviewDays(null);
    setOk(false);
    setSavedInfo(null);
  }
  // When RRP is entered, default the Shopify price to it if none set yet (blank or 0) — matches the legacy save. On blur so it doesn't
  // fight the user mid-type. Once a real Shopify price exists it's left alone.
  function defaultShopifyFromRrp() {
    setForm((p) => {
      const sp = Number(p.shopifyPrice);
      return p.shopifyPrice.trim() === '' || !(sp > 0) ? { ...p, shopifyPrice: p.rrp } : p;
    });
  }
  function reset() {
    setForm({ cost: toStr(cost), rrp: toStr(rrp), shopifyPrice: toStr(price), tax });
    setReviewDays(null);
    setNote('');
    setError(null);
    setOk(false);
    setPush(null);
    setGooglePush(null);
    setSavedInfo(null);
  }

  async function onSave() {
    // Client-side mirror of the server rules, for immediate feedback (server stays authoritative).
    const c = Number(form.cost);
    const r = Number(form.rrp);
    if (!(c > 0)) { setError('Cost is required and must be greater than 0'); return; }
    if (!(r > 0)) { setError('RRP is required and must be greater than 0'); return; }
    if (r < c) { setError('RRP cannot be less than cost'); return; }

    setSaving(true);
    setError(null);
    setOk(false);
    setPush(null);
    setGooglePush(null);
    setSavedInfo(null);
    // Only attach the note when the price actually changed (server only logs — and so only keeps a note — on a change).
    const res = await updateProductPrice(groupid, form, {
      reviewDays,
      note: priceChanged ? note.trim() : '',
    });
    if (res.success && res.data) {
      const s = res.data.saved;
      const next = { cost: toStr(s.cost), rrp: toStr(s.rrp), shopifyPrice: toStr(s.price), tax: s.tax };
      setForm(next);
      setBaseline(JSON.stringify(next));
      setReviewDays(null);
      setNote('');
      setOk(true);
      setPush(res.data.shopify ?? null);
      setGooglePush(res.data.google ?? null);
      setSavedInfo({ logged: res.data.logged, nextReview: res.data.next_review });
      onSaved?.(s);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to save price');
    }
    setSaving(false);
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">Price</h3>
        <span className="text-[11px] text-slate-400">Cost &amp; RRP required · RRP ≥ Cost</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Money label="Cost" value={form.cost} onChange={(v) => set('cost', v)} />
        <Money label="RRP" value={form.rrp} onChange={(v) => set('rrp', v)} onBlur={defaultShopifyFromRrp} />
        <Money label="Shopify Price" value={form.shopifyPrice} onChange={(v) => set('shopifyPrice', v)} />
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Tax</label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
            <input type="checkbox" checked={form.tax} onChange={(e) => set('tax', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            VAT
          </label>
        </div>
      </div>

      <p className="mt-1 text-[11px] text-slate-400">Leave Shopify Price blank to default it to RRP. If the product is live on Shopify and/or Google, saving pushes the new price there immediately.</p>

      {/* Optional extras — Note (audit) + Review (park). Both optional; the normal flow ignores them. */}
      <div className="mt-3 space-y-3 rounded-md border border-slate-100 bg-slate-50/60 p-3">
        {/* Note — only meaningful on a price change (it's stored on the audit row). */}
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Note <span className="normal-case text-slate-400">(optional)</span>
          </label>
          <input
            value={note}
            onChange={(e) => { setNote(e.target.value); setOk(false); setSavedInfo(null); }}
            disabled={!priceChanged}
            maxLength={NOTE_MAX}
            placeholder={priceChanged ? 'Why the price changed (saved to the price log)' : 'Change the Shopify price to add a note'}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          />
          {/* Live length counter — same cap as the pricing setters so notes stay to one tidy line on the Price Changes / history reports. */}
          <div className={'mt-1 text-right text-xs ' + (note.length >= NOTE_MAX ? 'text-amber-600' : 'text-slate-400')}>
            {note.length}/{NOTE_MAX}
          </div>
        </div>

        {/* Review chips — optional single-select; parks the style out of the pricing triage until then. */}
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Review in <span className="normal-case text-slate-400">(optional — hides from pricing triage until then)</span>
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Explicit None (no review) — selected by default; clears any chosen period. */}
            <button
              type="button"
              onClick={() => setReviewNone()}
              className={
                'rounded-full border px-3 py-1 text-xs ' +
                (reviewDays === null ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100')
              }
            >
              None
            </button>
            {REVIEW_CHIPS.map((d) => {
              const isSel = reviewDays === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => pickReview(d)}
                  className={
                    'rounded-full border px-3 py-1 text-xs ' +
                    (isSel ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-100')
                  }
                >
                  {d}
                </button>
              );
            })}
            <span className="text-xs text-slate-400">days</span>
          </div>
        </div>
      </div>

      {/* Save bar. */}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={!dirty || saving}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save price'}
        </button>
        {dirty && !saving && (
          <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-700">Reset</button>
        )}
        {!dirty && !saving && !ok && <span className="text-xs text-slate-400">No unsaved changes</span>}
        {ok && !dirty && (
          <span className="text-xs font-medium text-green-600">
            Saved.
            {savedInfo?.logged ? ' Change logged.' : ''}
            {savedInfo?.nextReview ? ` Review ${savedInfo.nextReview}.` : ''}
          </span>
        )}
        {ok && !dirty && <ShopifyPushNote result={push} />}
        {ok && !dirty && <GooglePushNote result={googlePush} />}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
