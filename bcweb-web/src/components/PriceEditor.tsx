'use client';
/*
=======================================================================================================================================
Component: PriceEditor
=======================================================================================================================================
Purpose: Editable price block for a product (skusummary): Cost, RRP, Tax, and the base Shopify price. Saves via POST /product-price,
         which enforces the legacy rules (Cost > 0, RRP > 0, RRP >= Cost) and stores the values WITHOUT flagging a Shopify sync
         (shopifychange untouched) — a direct Shopify push is a later step.

         Self-contained: manages its own edit state + save. Mount with key={groupid} so it resets when the product changes. On a
         successful save it calls onSaved with the numbers actually written, so the parent panel can stay in sync.
=======================================================================================================================================
*/

import { useState } from 'react';
import { updateProductPrice, ProductPriceSaved, ShopifyPushResult } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import ShopifyPushNote from '@/components/ShopifyPushNote';

interface Props {
  groupid: string;
  cost: number | null;
  rrp: number | null;
  price: number | null;
  tax: boolean;
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

export default function PriceEditor({ groupid, cost, rrp, price, tax, onSaved }: Props) {
  const { logout } = useAuth();
  const [form, setForm] = useState({ cost: toStr(cost), rrp: toStr(rrp), shopifyPrice: toStr(price), tax });
  const [baseline, setBaseline] = useState(() => JSON.stringify({ cost: toStr(cost), rrp: toStr(rrp), shopifyPrice: toStr(price), tax }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [push, setPush] = useState<ShopifyPushResult | null>(null);   // Shopify re-push outcome, when the product is live

  const dirty = JSON.stringify(form) !== baseline;

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
    setOk(false);
    setPush(null);
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
    setError(null);
    setOk(false);
    setPush(null);
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
    const res = await updateProductPrice(groupid, form);
    if (res.success && res.data) {
      const s = res.data.saved;
      const next = { cost: toStr(s.cost), rrp: toStr(s.rrp), shopifyPrice: toStr(s.price), tax: s.tax };
      setForm(next);
      setBaseline(JSON.stringify(next));
      setOk(true);
      setPush(res.data.shopify ?? null);
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

      <p className="mt-1 text-[11px] text-slate-400">Leave Shopify Price blank to default it to RRP. Saving here does not push to Shopify.</p>

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
        {ok && !dirty && <span className="text-xs font-medium text-green-600">Saved.</span>}
        {ok && !dirty && <ShopifyPushNote result={push} />}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
