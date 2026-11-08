/*
=======================================================================================================================================
Module: utils/birkSwatches.js
=======================================================================================================================================
Purpose: Colour swatches + a Narrow / Regular switch on Birkenstock product pages, like birkenstock.com (owner, 2026-11-08: option B —
         "model + material, like Birkenstock", "hide sold out"). Each colour stays its OWN Shopify product (own URL, own description —
         SEO); BCWEB works out which products belong together and writes that onto each product as metafields. The theme shows them:
         a Dawn "Custom liquid" block on the product page (docs/shopify-swatches.liquid.txt) — no theme files edited.

THE RULE — from title.shopifytitle (never the handle, which often omits the width):
         "[Womens|Mens|Unisex] Birkenstock <model + material> <Sandals|Trainers|Slippers|Shoes|Boots|Clogs> <colour> <Narrow|Regular> Fit"
         family = model + material + type, with "Two-Strap" dropped (Birkenstock's own Arizona Birko-Flor page holds every colour; our
         titles say "Arizona Two-Strap Birko-Flor" on some and "Arizona Birko-Flor" on others). Width is NOT part of the family key but
         the colour list is per width: a Narrow page lists the Narrow colours, and the width switch links to the other width.
         A title that doesn't fit the pattern (socks) gets nothing.

METAFIELDS (namespace bcweb, on every Birkenstock product ACTIVE on Shopify):
         colours     list.product_reference   the family's products in this width, the product itself included, A–Z by colour.
                                              Only set when there are 2+; otherwise removed.
         colour      single_line_text_field   "Faded Khaki" — the label beside the swatches
         width       single_line_text_field   "Narrow" | "Regular"
         width_twin  product_reference        the same colour in the other width, when it exists
         Sold out is NOT decided here: the theme hides any product that isn't available (Shopify stock, kept by utils/shopifyStockSync.js in Update Orders),
         so the swatches follow stock live with no re-sync.

         Membership = Birkenstock styles in skusummary whose handle is an ACTIVE product on Shopify (a style switched OFF in BCWEB stays
         on the store — that is how product-shopify's disable works — so the store, not the flag, decides).

syncSwatches({ commit }) -> { products, changes: [{ handle, key, action }], families }
         Reads every Shopify product once, works out what each Birkenstock product should carry, and writes ONLY the differences
         (metafieldsSet in 25s, metafieldsDelete for what no longer applies). Idempotent; dry run when commit is false.
         Run by scripts/birk-swatches.js, and best-effort after a Birkenstock product is saved / made live / deleted (syncSwatchesSafe).
=======================================================================================================================================
*/

const { query } = require('../database');
const { shopifyGraphQL, isConfigured } = require('./shopify');
const logger = require('./logger');

const NS = 'bcweb';
const TITLE_RE = /^(?:(?:womens|mens|unisex)\s+)?birkenstock\s+(.+?)\s+(sandals|trainers|slippers|shoes|boots|clogs)\s+(.+?)\s+(narrow|regular)\s+fit$/i;

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

// { family, colour, width } or null. family is a lower-case key; colour keeps the title's own wording.
function parseTitle(title) {
  const m = TITLE_RE.exec(String(title || '').trim().replace(/\s+/g, ' '));
  if (!m) return null;
  const model = m[1].replace(/\btwo-strap\b/ig, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return { family: `${model} ${m[2].toLowerCase()}`, colour: m[3].trim(), width: cap(m[4]) };
}

// What every product should carry: Map handle -> { colours: [handle] | null, colour, width, twin: handle | null }.
function plan(rows) {
  const parsed = rows.map((r) => ({ ...r, p: parseTitle(r.title) })).filter((r) => r.p);
  const byFamilyWidth = new Map();
  const byFamilyColour = new Map();
  for (const r of parsed) {
    const fw = `${r.p.family}|${r.p.width}`;
    if (!byFamilyWidth.has(fw)) byFamilyWidth.set(fw, []);
    byFamilyWidth.get(fw).push(r);
    byFamilyColour.set(`${r.p.family}|${r.p.colour.toLowerCase()}|${r.p.width}`, r);
  }
  const out = new Map();
  for (const r of parsed) {
    const fam = byFamilyWidth.get(`${r.p.family}|${r.p.width}`)
      .slice().sort((a, b) => a.p.colour.localeCompare(b.p.colour) || a.handle.localeCompare(b.handle));
    const other = r.p.width === 'Narrow' ? 'Regular' : 'Narrow';
    const twin = byFamilyColour.get(`${r.p.family}|${r.p.colour.toLowerCase()}|${other}`);
    out.set(r.handle, {
      family: r.p.family,
      colours: fam.length >= 2 ? fam.map((x) => x.handle) : null,
      colour: r.p.colour,
      width: r.p.width,
      twin: twin ? twin.handle : null
    });
  }
  return out;
}

const PRODUCTS_QUERY = `
  query($after: String) { products(first: 250, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id handle status
      colours: metafield(namespace: "${NS}", key: "colours") { value }
      colour: metafield(namespace: "${NS}", key: "colour") { value }
      width: metafield(namespace: "${NS}", key: "width") { value }
      width_twin: metafield(namespace: "${NS}", key: "width_twin") { value } } } }
`;

async function readShopify() {
  const out = new Map();
  let after = null;
  do {
    const d = await shopifyGraphQL(PRODUCTS_QUERY, { after });
    for (const p of d.products.nodes) out.set(p.handle, p);
    after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (after);
  return out;
}

const SET = `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`;
const DEL = `mutation($m: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $m) { userErrors { field message } } }`;

async function inChunks(list, mutation, field) {
  for (let i = 0; i < list.length; i += 25) {
    const d = await shopifyGraphQL(mutation, { m: list.slice(i, i + 25) });
    const errs = d[field].userErrors || [];
    if (errs.length) throw new Error(`${field}: ${errs.map((e) => e.message).join('; ')}`);
  }
}

async function syncSwatches({ commit = false } = {}) {
  const [db, shop] = await Promise.all([
    query(`
      SELECT ss.handle, t.shopifytitle AS title
      FROM skusummary ss JOIN title t ON t.groupid = ss.groupid
      WHERE ss.brand ILIKE 'birk%' AND COALESCE(ss.handle, '') <> ''
    `),
    readShopify()
  ]);
  const rows = db.rows.filter((r) => { const p = shop.get(r.handle); return p && p.status === 'ACTIVE'; });
  const want = plan(rows);
  const gid = (h) => shop.get(h).id;

  const sets = [];
  const dels = [];
  const changes = [];
  for (const r of rows) {
    const p = shop.get(r.handle);
    const w = want.get(r.handle);
    const target = {
      colours: w && w.colours ? { type: 'list.product_reference', value: JSON.stringify(w.colours.map(gid)) } : null,
      colour: w ? { type: 'single_line_text_field', value: w.colour } : null,
      width: w ? { type: 'single_line_text_field', value: w.width } : null,
      width_twin: w && w.twin ? { type: 'product_reference', value: gid(w.twin) } : null
    };
    for (const key of Object.keys(target)) {
      const now = p[key] ? p[key].value : null;
      const t = target[key];
      if (t && t.value !== now) {
        sets.push({ ownerId: p.id, namespace: NS, key, type: t.type, value: t.value });
        changes.push({ handle: r.handle, key, action: now === null ? 'add' : 'change' });
      } else if (!t && now !== null) {
        dels.push({ ownerId: p.id, namespace: NS, key });
        changes.push({ handle: r.handle, key, action: 'remove' });
      }
    }
  }
  if (commit) {
    if (sets.length) await inChunks(sets, SET, 'metafieldsSet');
    if (dels.length) await inChunks(dels, DEL, 'metafieldsDelete');
  }
  const families = new Map();
  for (const w of want.values()) {
    const k = `${w.family}|${w.width}`;
    if (!families.has(k)) families.set(k, []);
    families.get(k).push(w.colour);
  }
  return { products: rows.length, changes, families };
}

// The four definitions, so the fields show with names in Shopify admin and are typed for the theme. Idempotent (TAKEN = already there).
const DEFINITIONS = [
  { key: 'colours', name: 'Colours (BCWEB)', type: 'list.product_reference', description: 'Same model + material in this width — set by BCWEB' },
  { key: 'colour', name: 'Colour (BCWEB)', type: 'single_line_text_field', description: 'Colour name for the swatches — set by BCWEB' },
  { key: 'width', name: 'Width (BCWEB)', type: 'single_line_text_field', description: 'Narrow or Regular — set by BCWEB' },
  { key: 'width_twin', name: 'Other width (BCWEB)', type: 'product_reference', description: 'Same colour in the other width — set by BCWEB' }
];
const DEF_CREATE = `mutation($d: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $d) {
  createdDefinition { id } userErrors { code message } } }`;

async function ensureDefinitions() {
  const made = [];
  for (const d of DEFINITIONS) {
    const r = await shopifyGraphQL(DEF_CREATE, { d: { ...d, namespace: NS, ownerType: 'PRODUCT' } });
    const errs = r.metafieldDefinitionCreate.userErrors || [];
    if (errs.some((e) => e.code !== 'TAKEN')) throw new Error(`definition ${d.key}: ${errs.map((e) => e.message).join('; ')}`);
    if (!errs.length) made.push(d.key);
  }
  return made;
}

// After a save: never throws, never delays the response (callers don't await it).
function syncSwatchesSafe(brand) {
  if (!isConfigured() || !/^birk/i.test(String(brand || ''))) return;
  syncSwatches({ commit: true })
    .then((r) => { if (r.changes.length) logger.info(`[birk-swatches] ${r.changes.length} metafield change(s)`); })
    .catch((e) => logger.error('[birk-swatches] sync failed:', e.message));
}

module.exports = { parseTitle, plan, syncSwatches, syncSwatchesSafe, ensureDefinitions };
