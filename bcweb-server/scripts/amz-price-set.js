/*
=======================================================================================================================================
Script: scripts/amz-price-set.js   (WRITES — one Amazon size's price, only with --commit; the /amz-pricing skill's "apply" step)
=======================================================================================================================================
Purpose: Set ONE Amazon size's price the owner has agreed in conversation, through THE shared Amazon price write
         (utils/priceWrite.js → writeAmzPrice — the same W-A1 core as POST /amz-apply and the Pricing Slider; never a copy). Built
         2026-11-04 so a less capable AI agent running the skill can apply a price SAFELY (owner: "In future, we will give it to a lesser
         AI agent").

WHAT IT WRITES: one amz_price_log row (old = today's live amzfeed price, new, note, changed_by). Nothing else — no review date, no
Shopify, never amzfeed. Like every Amazon price here it is NOT live yet: it lands in the team upload basket (GET /amz-basket) and
reaches Amazon only when someone downloads the Seller Central file, uploads it, and presses "I've uploaded".

GUARDS (each refuses; the flag lets the owner override one on purpose):
  - Dry run by default: prints what it would do and writes nothing. --commit writes.
  - --by <name> and --note <text> are required (the owner's name, e.g. "Andreas"; a short why, e.g. "Back under £40 (amz-pricing)").
  - The exact code must be on Amazon (amzfeed). No partial matches.
  - Same as today's price → refused (nothing to change).
  - Moves more than 15% from today's price             → refused unless --big-move
  - Under the £3-a-pair walk-away price (the standard)  → refused unless --below-walk-away
  - Over RRP                                            → refused unless --above-rrp
  - A change for this size already waiting in the upload basket (not uploaded, last 72h, not already live) → refused unless
    --replace-pending (the newest price per size is the one the file carries).

Usage:
    node scripts/amz-price-set.js <CODE> <PRICE> --by "Andreas" --note "short why"            dry run
    node scripts/amz-price-set.js <CODE> <PRICE> --by "Andreas" --note "short why" --commit   write it
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { writeAmzPrice } = require('../utils/priceWrite');
const { amzProfit, priceForProfit } = require('../utils/amzProfit');
const { safeNumeric } = require('../utils/sql');
const { SETTINGS } = require('../utils/amzPricingStandard');

const BIG_MOVE = 0.15;
const BASKET_HOURS = 72; // routes/amz-basket.js WINDOW_HOURS

function args(argv) {
  const o = { code: null, price: null, by: null, note: null, commit: false, flags: new Set() };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--by') o.by = argv[(i += 1)];
    else if (a === '--note') o.note = argv[(i += 1)];
    else if (a === '--commit') o.commit = true;
    else if (['--big-move', '--below-walk-away', '--above-rrp', '--replace-pending'].includes(a)) o.flags.add(a);
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else pos.push(a);
  }
  [o.code, o.price] = pos;
  if (!o.code || o.price === undefined) throw new Error('Usage: amz-price-set.js <CODE> <PRICE> --by "<name>" --note "<why>" [--commit]');
  if (!/^\d+(\.\d{1,2})?$/.test(String(o.price))) throw new Error('PRICE must be a number like 39.79');
  o.price = Number(o.price);
  if (!(o.price > 0)) throw new Error('PRICE must be above 0');
  if (!o.by || !o.by.trim()) throw new Error('--by "<name>" is required (the owner who agreed the price)');
  if (!o.note || !o.note.trim()) throw new Error('--note "<short why>" is required');
  o.by = o.by.trim();
  o.note = o.note.trim().slice(0, 500);
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const f = await pool.query(
    `SELECT a.code, a.sku, ${safeNumeric('a.amzprice')} AS price, a.amzlive, a.amztotal, a.fbafee, sk.cost, sk.tax,
            ${safeNumeric('sk.rrp')} AS rrp
     FROM amzfeed a LEFT JOIN skusummary sk ON sk.groupid = a.groupid WHERE a.code = $1`,
    [o.code]
  );
  if (!f.rows.length) throw new Error(`${o.code} is not on Amazon (no amzfeed row) — use the exact code, e.g. FLE030-IVES-WHITE-05`);
  const r = f.rows[0];
  const now = r.price === null ? null : Number(r.price);
  const rrp = r.rrp === null ? null : Number(r.rrp);
  const walk = priceForProfit({ cost: r.cost, fbafee: r.fbafee, tax: r.tax }, SETTINGS.WALK_AWAY_PROFIT);
  const kept = (p) => amzProfit({ price: p, cost: r.cost, fbafee: r.fbafee, tax: r.tax })?.profit ?? null;

  const pend = await pool.query(
    `SELECT id, new_price, changed_by, changed_at FROM amz_price_log l
     WHERE l.code = $1 AND l.uploaded_at IS NULL AND l.changed_at >= now() - make_interval(hours => $2::int)
       AND ROUND(l.new_price, 2) IS DISTINCT FROM ROUND($3::numeric, 2)
     ORDER BY id DESC LIMIT 1`,
    [o.code, BASKET_HOURS, now]
  );

  const money = (v) => (v === null || v === undefined ? '—' : `£${Number(v).toFixed(2)}`);
  console.log(`${o.code} (Amazon SKU ${r.sku}) · FBA live ${r.amzlive ?? '—'} / total ${r.amztotal ?? '—'}`);
  console.log(`  today ${money(now)} (keeps ${money(kept(now))} a pair)  →  ${money(o.price)} (keeps ${money(kept(o.price))} a pair)`);
  console.log(`  RRP ${money(rrp)} · walk-away ${money(walk)} · by ${o.by} · note "${o.note}"`);

  const refuse = [];
  if (now !== null && Math.abs(o.price - now) < 0.005) refuse.push('it is already today\'s price — nothing to change');
  if (now !== null && Math.abs(o.price - now) / now > BIG_MOVE && !o.flags.has('--big-move')) {
    refuse.push(`a move of ${Math.round((Math.abs(o.price - now) / now) * 100)}% (over ${BIG_MOVE * 100}%) — check the price, or --big-move if the owner meant it`);
  }
  if (walk !== null && o.price < walk && !o.flags.has('--below-walk-away')) {
    refuse.push(`under the walk-away price ${money(walk)} (keeps under £${SETTINGS.WALK_AWAY_PROFIT} a pair) — --below-walk-away only if the owner said so`);
  }
  if (rrp !== null && o.price > rrp && !o.flags.has('--above-rrp')) refuse.push(`over RRP ${money(rrp)} — --above-rrp only if the owner said so`);
  if (pend.rows.length && !o.flags.has('--replace-pending')) {
    const p = pend.rows[0];
    refuse.push(`a change is already waiting in the upload basket (${money(p.new_price)} by ${p.changed_by || '?'}, log id ${p.id}) — --replace-pending to supersede it`);
  }
  if (refuse.length) {
    console.log('REFUSED — nothing written:');
    for (const x of refuse) console.log(`  - ${x}`);
    process.exitCode = 2;
    return;
  }
  if (!o.commit) {
    console.log('DRY RUN — nothing written. Run again with --commit once the owner has agreed this size at this price.');
    return;
  }
  const w = await withTransaction((client) => writeAmzPrice(client, {
    code: o.code, price: o.price, reviewDays: null, note: o.note, changedBy: o.by,
  }));
  if (w.error) throw new Error(`${w.error}: ${w.message}`);
  console.log(`WRITTEN — amz_price_log id ${w.logId}${w.warnings.length ? ` · warnings: ${w.warnings.join(', ')}` : ''}.`);
  console.log('Not on Amazon yet: it is in the team upload basket. Download the Seller Central file, upload it, then press "I\'ve uploaded".');
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error('[amz-price-set] FAILED:', err.message); pool.end().finally(() => process.exit(1)); });
