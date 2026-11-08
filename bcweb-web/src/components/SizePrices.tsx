'use client';
/*
 * SizePrices — the Size prices panel on the Shopify pricing drill (owner, 2026-11-08), under the price card.
 *
 * A dead size of a selling style (Milano 35: 5 pairs, never sells, while the style sold 101 in a year) gets its OWN Shopify price, so
 * the style price stays where it earns (memory check-price-grain: never cut a style to clear its dead sizes). On Shopify the size
 * shows its price against the RRP like every other size (~~£90~~ £45 — owner: "simply £45 from a £90 RRP"). Rules on the server, utils/sizePrice.js (THE copy):
 *   - set BY HAND; the box fills with 50% of RRP (header.size_price_default) — type the last selling price instead if you like;
 *   - must be BELOW the style price, and the size must have stock (refused otherwise); below cost is flagged, never blocked;
 *   - it ends by itself when the size sells out (Update Orders) or the style price goes to or below it — and "Back to style price" here;
 *   - Google gets the same price (and the size is kept out of paid Shopping ads) through the 2-hourly sweep.
 * Stock here is local free + FBA live — what Shopify shows, and what "sold out" means for a size price — so it can differ from the
 * size run on the price card, which is local only.
 */
import { useState } from 'react';
import { setSizePrice, clearSizePrice, type SizeRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface SizePricesProps {
  sizes: SizeRow[];
  stylePrice: number | null;
  rrp: number | null;            // crossed out beside a size price, as on Shopify
  cost: number | null;
  defaultPrice: number | null;   // 50% of RRP (server)
  onChanged: () => Promise<void> | void;
}

const gbp = (n: number) => `£${n.toFixed(2)}`;

export default function SizePrices({ sizes, stylePrice, rrp, cost, defaultPrice, onChanged }: SizePricesProps) {
  const { logout } = useAuth();
  const [open, setOpen] = useState<string | null>(null);        // code of the size being edited
  const [priceStr, setPriceStr] = useState('');
  const [busy, setBusy] = useState(false);
  // Closed by default (owner, 2026-11-08) — the header row says how many sizes have their own price.
  const [panelOpen, setPanelOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'warn' | 'err'; text: string } | null>(null);

  const rows = [...sizes].sort((a, b) => (Number(a.size) - Number(b.size)) || a.size.localeCompare(b.size));
  const withOwn = rows.filter((r) => r.own_price != null).length;

  function openSize(r: SizeRow) {
    if (open === r.code) { setOpen(null); return; }
    setOpen(r.code);
    setNotice(null);
    const start = r.own_price ?? defaultPrice;
    setPriceStr(start !== null ? start.toFixed(2) : '');
  }

  const price = Number(priceStr);
  const valid = priceStr.trim() !== '' && Number.isFinite(price) && price > 0;
  const notBelowStyle = valid && stylePrice !== null && price >= stylePrice;
  const belowCost = valid && cost !== null && price < cost;

  async function apply(r: SizeRow) {
    setBusy(true);
    setNotice(null);
    const res = await setSizePrice(r.code, Math.round(price * 100) / 100);
    setBusy(false);
    if (!res.success || !res.data) {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setNotice({ kind: 'err', text: res.error || 'Failed to set the size price' });
      return;
    }
    const push = res.data.shopify;
    if (push && push.pushed === false) {
      // Saved, but the store didn't take it — keep the box open so Apply can be pressed again (the push is idempotent).
      setNotice({ kind: 'err', text: `Saved size ${r.size} at ${gbp(res.data.price)}, but it did NOT reach Shopify${push.message ? `: ${push.message}` : ''}. Press Apply again to retry.` });
      await onChanged();
      return;
    }
    setNotice(res.data.warnings.includes('BELOW_COST') ? { kind: 'warn', text: `Size ${r.size} saved at ${gbp(res.data.price)} — below cost.` } : null);
    setOpen(null);
    await onChanged();
  }

  async function back(r: SizeRow) {
    setBusy(true);
    setNotice(null);
    const res = await clearSizePrice(r.code);
    setBusy(false);
    if (!res.success || !res.data) {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setNotice({ kind: 'err', text: res.error || 'Failed to go back to the style price' });
      return;
    }
    const push = res.data.shopify;
    if (push && push.pushed === false) {
      setNotice({ kind: 'err', text: `Size ${r.size} is back to the style price here, but it did NOT reach Shopify${push.message ? `: ${push.message}` : ''}. Press Back to style price again to retry.` });
    }
    setOpen(null);
    await onChanged();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
      <button
        type="button"
        onClick={() => setPanelOpen((o) => !o)}
        aria-expanded={panelOpen}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-left"
      >
        <span className="text-xs text-slate-400">{panelOpen ? '▾' : '▸'}</span>
        <h3 className="text-sm font-semibold text-slate-800">Size prices</h3>
        {panelOpen && (
          <span className="text-xs text-slate-400">
            A size that won&apos;t sell at the style price can have its own — Shopify shows it against the RRP, like the other sizes. It
            ends when the size sells out.
          </span>
        )}
        {withOwn > 0 && <span className="ml-auto text-xs text-slate-500">{withOwn} size{withOwn === 1 ? '' : 's'} with own price</span>}
      </button>

      {panelOpen && (<div className="mt-3">
      {notice && (
        <div className={'mb-3 rounded-md px-3 py-1.5 text-sm ' + (notice.kind === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700')}>
          {notice.text}
        </div>
      )}

      <div className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
        <div className="grid grid-cols-[4rem_5rem_1fr] gap-3 bg-slate-50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:grid-cols-[5rem_6rem_1fr]">
          <span>Size</span>
          <span>Stock</span>
          <span>Shopify price</span>
        </div>
        {rows.map((r) => {
          const stock = r.qty + r.amz_live;
          const canOpen = stock > 0 || r.own_price != null;
          const isOpen = open === r.code;
          return (
            <div key={r.code}>
              <button
                type="button"
                onClick={() => canOpen && openSize(r)}
                disabled={!canOpen || busy}
                className={
                  'grid w-full grid-cols-[4rem_5rem_1fr] items-baseline gap-3 px-3 py-1.5 text-left text-sm sm:grid-cols-[5rem_6rem_1fr] ' +
                  (isOpen ? 'bg-slate-50 ' : '') +
                  (canOpen ? 'hover:bg-slate-50' : 'cursor-default')
                }
                title={canOpen ? (r.own_price != null ? 'Change or remove this size’s own price' : 'Give this size its own price') : 'Sold out — nothing to price'}
              >
                <span className={'font-mono ' + (stock > 0 ? 'text-slate-800' : 'text-slate-300')}>{r.size}</span>
                <span
                  className={stock > 0 ? 'text-slate-700' : 'text-slate-300'}
                  title={r.amz_live > 0 ? `${r.qty} here · ${r.amz_live} at Amazon FBA` : undefined}
                >
                  {stock}
                </span>
                <span>
                  {r.own_price != null && r.own_active ? (
                    <>
                      <span className="font-semibold text-slate-900">{gbp(r.own_price)}</span>
                      {rrp !== null && rrp > r.own_price && <span className="ml-2 text-xs text-slate-400 line-through">{gbp(rrp)}</span>}
                      <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">own price</span>
                    </>
                  ) : r.own_price != null ? (
                    // Stored but not in force (sold out, waiting for the next Update Orders to end it) — Shopify shows the style price.
                    <span className="text-slate-400">{gbp(r.own_price)} — sold out, ends at the next Update Orders</span>
                  ) : (
                    <span className={stock > 0 ? 'text-slate-500' : 'text-slate-300'}>{stylePrice !== null ? gbp(stylePrice) : '—'}</span>
                  )}
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 bg-slate-50 px-3 pb-3 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-600">Size {r.size} at</span>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">£</span>
                      <input
                        value={priceStr}
                        onChange={(e) => setPriceStr(e.target.value)}
                        inputMode="decimal"
                        autoFocus
                        className="w-28 rounded-md border border-slate-300 py-1.5 pl-6 pr-2 text-sm font-semibold text-slate-900 focus:border-brand-500 focus:outline-none"
                      />
                    </div>
                    {defaultPrice !== null && (
                      <button
                        type="button"
                        onClick={() => setPriceStr(defaultPrice.toFixed(2))}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        Half RRP
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => apply(r)}
                      disabled={busy || !valid || notBelowStyle || stock <= 0}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {busy ? 'Saving…' : 'Apply to Shopify'}
                    </button>
                    {r.own_price != null && (
                      <button
                        type="button"
                        onClick={() => back(r)}
                        disabled={busy}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Back to style price
                      </button>
                    )}
                    <button type="button" onClick={() => setOpen(null)} className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-700">
                      Cancel
                    </button>
                  </div>
                  <div className="mt-1 min-h-[1rem] text-xs">
                    {notBelowStyle && <span className="text-red-600">Must be below the style price ({gbp(stylePrice!)}).</span>}
                    {!notBelowStyle && belowCost && <span className="text-red-600">Below cost ({gbp(cost!)}) — you&apos;d sell at a loss.</span>}
                    {!notBelowStyle && !belowCost && stock <= 0 && <span className="text-slate-500">Sold out — nothing to price.</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>)}
    </div>
  );
}
