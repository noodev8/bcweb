/*
=======================================================================================================================================
Util: supplierStock — THE copy (owner, 2026-11-27)
=======================================================================================================================================
Purpose: "Can the supplier sell us this?" for an Amazon find on the Prospects "Search Amazon" panel — matches an Amazon listing to a
         style on a supplier's stock list (supplier_stock, migrations/20261127_supplier_stock.sql, loaded by
         scripts/supplier-stock-load.js) and returns its cost and the sizes in stock. Read only.
         Only Rieker so far (the Rieker group's Available Stock List PDF — Rieker, Remonte …). GRS (Lunar) sends no list (owner: they
         only give barcodes for products we stock), so a Lunar find has no match and the panel says nothing about stock.

MATCHING A RIEKER CODE (checked on the live "rieker boots women" search, 2026-11-27): the style is 5 letters/digits ('44650', 'L7132',
'Z4994', 'D0Q52') + a 2-digit colour ('-02'). Sellers write it every which way, and not always in the same field:
   title  "Rieker L7132, Women's Ankle Boots, Black (Schwarz/Schwarz/Anthrazit 01), 6 UK (39 EU)"   colour only in the brackets
   title  "Rieker Ladies Casual Ankle Boots 72581-54 - Green …"                                      code-colour in the title
   model  "L7132-00", "98860" ; part "L7132_01", "98860_22", "L3882/00_Black"
So every 5-character code with at least 3 digits in model / part / title is a candidate base (model and part first: a seller title said
"72617-00" on the 72617-25 listing, its model number was right). The colour is taken, in order of trust:
code-colour written together (-, _, /), then a 2-digit number in the title that is not a size ("39 EU", "Size 5"). A colour is only
used if that base + colour is ON the list; if no colour fits, every colour of the base on the list comes back (colour_sure false) and
the screen says so — a near-miss shown honestly beats a silent wrong match.
=======================================================================================================================================
Exports:
  candidates(item)              -> [{ base, colours: ['01', …] }] — pure: what codes an Amazon item may be (item = { title, model, part })
  lookup(items)                 -> Map(asin -> { supplier, style, colour_sure, … }) — one query for a whole search page (no N+1)
  supplierList()                -> { rieker: '2026-11-27' } — the date of each loaded list, to say how fresh it is
  surelyCantGet(item, matched, lists)
                                -> true when we are SURE the supplier can't sell us this Amazon listing, so Search Amazon hides it
                                   (owner, 2026-11-27: "shall we just hide them if i cant get them anyway?"). All three must hold:
                                   the listing's brand is one a LOADED list covers (Rieker / Remonte), a Rieker-style code was read
                                   from it (candidates), and no colour of that code is on the list (no match). A listing too badly
                                   worded to read a code from is NOT hidden — unknown is kept, so nothing is missed on wording.
  BRAND_SUPPLIER                which of OUR brands (skusummary.brand) each list covers
  BRAND_SUPPLIER                which of OUR brands (skusummary.brand) each list covers
  estRrp(supplier, cost)        -> an ESTIMATED RRP from the list's cost, whole pounds | null (owner, 2026-11-27: "An estimate is enough
                                   here until we actually buy it and put the real figures in"). Rieker: cost × 2.34 — the steady ratio
                                   on the Rieker styles we stock (£25.90→£60, £27.95→£65, £32.10→£75, £34.20→£79.99, £36.30→£85,
                                   £37.15→£87; median 2.34 over 43 styles, 2026-11-27). No ladder stored. Shown "~£65", never written.
  applyCantGet(client, supplier, apply)
                                -> { mark: [codes], release: [codes] } — THE LIST DRIVES "CAN'T GET" (owner, 2026-11-27: "make it act
                                   like our cant get, same sign. So it basically replaces us doing it manually … the PDF can and should
                                   switch it back"). For every live size of a brand the list covers (Rieker / Remonte), after a load:
                                     - not in stock on the list (size out, or style not on it — "if it is NOT on the PDF it is stock
                                       zero") and not marked now -> MARKED Can't get, marked_by 'Rieker list'
                                     - in stock on the list and carrying a mark (live or lapsed, manual or not) -> RELEASED
                                   A size already marked that the list also says is out is left as it is (its own three months, its own
                                   name). Writes ONLY through utils/noSupply.js (THE copy of Can't get), so the sign, the order screens
                                   and Release all work as for a hand-set mark; a hand mark on a Rieker size holds until the next load.
                                   OUR codes ARE the supplier's: groupid '73220-24' = the list's style, the size suffix '40' = its EU
                                   size. apply false = count only (the load script's dry run).
=======================================================================================================================================
*/

const { query } = require('../database');
const { markSizes, clearSizes } = require('./noSupply');

// A base: 5 letters/digits, at least 3 of them digits (so words like "BOOTS" or "SHOES" never match), standing on its own.
const BASE_RE = /(?<![A-Z0-9])([A-Z0-9]{5})(?:\s*[-_/]\s*(\d{2}))?(?![A-Z0-9])/g;
const digits = (s) => (s.match(/\d/g) || []).length;

function candidates(item) {
  const fields = [item.model, item.part, item.title].filter(Boolean).map((s) => String(s).toUpperCase());
  const bases = new Map();   // base -> ordered colours (strong first)
  for (const f of fields) {
    for (const m of f.matchAll(BASE_RE)) {
      const base = m[1];
      if (digits(base) < 3) continue;
      if (!bases.has(base)) bases.set(base, []);
      if (m[2] && !bases.get(base).includes(m[2])) bases.get(base).push(m[2]);
    }
  }
  // Weak colours: a stand-alone 2-digit number in the title that isn't a size ("(39 EU)", "Size 5", "UK 7").
  const title = String(item.title || '').toUpperCase();
  const weak = [];
  for (const m of title.matchAll(/(?<![\d.])(\d{2})(?![\d.])/g)) {
    const before = title.slice(Math.max(0, m.index - 6), m.index);
    const after = title.slice(m.index + 2, m.index + 6);
    if (/^\s*(EU|UK|US)/.test(after) || /(SIZE|UK|EU|US)\s*$/.test(before)) continue;
    if (!weak.includes(m[1])) weak.push(m[1]);
  }
  return [...bases].map(([base, colours]) => ({ base, colours: [...colours, ...weak.filter((c) => !colours.includes(c))] }));
}

async function lookup(items) {
  const cands = new Map(items.map((it) => [it.asin, candidates(it)]));
  const bases = [...new Set([...cands.values()].flat().map((c) => c.base))];
  const out = new Map();
  if (!bases.length) return out;
  const { rows } = await query(`
    SELECT supplier, style, split_part(style, '-', 1) AS base, split_part(style, '-', 2) AS colour, season, cost::float AS cost, sizes,
           list_date::text AS list_date
      FROM supplier_stock
     WHERE split_part(style, '-', 1) = ANY($1)
     ORDER BY style`, [bases]);
  const byBase = new Map();
  for (const r of rows) {
    if (!byBase.has(r.base)) byBase.set(r.base, []);
    byBase.get(r.base).push(r);
  }
  for (const [asin, cs] of cands) {
    for (const c of cs) {
      const onList = byBase.get(c.base);
      if (!onList) continue;
      const colour = c.colours.find((col) => onList.some((r) => r.colour === col));
      const styles = colour ? onList.filter((r) => r.colour === colour) : onList;
      out.set(asin, {
        colour_sure: !!colour,
        styles: styles.map((r) => ({
          supplier: r.supplier, style: r.style, season: r.season, cost: r.cost, sizes: r.sizes, list_date: r.list_date,
        })),
      });
      break;   // first base found on a list wins
    }
  }
  return out;
}

async function supplierList() {
  const { rows } = await query(`SELECT supplier, MAX(list_date)::text AS list_date FROM supplier_stock GROUP BY supplier`);
  return Object.fromEntries(rows.map((r) => [r.supplier, r.list_date]));
}

const BRAND_SUPPLIER = { Rieker: 'rieker', Remonte: 'rieker' };

function surelyCantGet(item, matched, lists) {
  const supplier = BRAND_SUPPLIER[item.brand];
  return !!supplier && !!lists[supplier] && !matched && candidates(item).length > 0;
}

const SUPPLIER_NAME = { rieker: 'Rieker list' };

const RRP_RATIO = { rieker: 2.34 };
function estRrp(supplier, cost) {
  const k = RRP_RATIO[supplier];
  return k && cost ? Math.round(Number(cost) * k) : null;
}

async function applyCantGet(client, supplier, apply) {
  const brands = Object.keys(BRAND_SUPPLIER).filter((b) => BRAND_SUPPLIER[b] === supplier);
  const { rows } = await client.query(`
    SELECT m.code,
           COALESCE(st.sizes ? SUBSTRING(m.code FROM '[^-]*$'), false) AS can_get,
           n.code IS NOT NULL AS has_row,
           COALESCE(n.until > (now() AT TIME ZONE 'Europe/London')::date, false) AS marked
      FROM skumap m
      JOIN skusummary sk ON sk.groupid = m.groupid
      LEFT JOIN supplier_stock st ON st.supplier = $1 AND st.style = m.groupid
      LEFT JOIN no_supply_size n ON n.code = m.code
     WHERE sk.brand = ANY($2) AND COALESCE(m.deleted,0) = 0`, [supplier, brands]);
  const mark = rows.filter((r) => !r.can_get && !r.marked).map((r) => r.code);
  const release = rows.filter((r) => r.can_get && r.has_row).map((r) => r.code);
  if (apply) {
    const who = SUPPLIER_NAME[supplier] || supplier;
    if (mark.length) await markSizes(client, mark, who);
    if (release.length) await clearSizes(client, release, who);
  }
  return { sizes: rows.length, mark, release };
}

module.exports = { candidates, lookup, supplierList, BRAND_SUPPLIER, applyCantGet, surelyCantGet, estRrp };
