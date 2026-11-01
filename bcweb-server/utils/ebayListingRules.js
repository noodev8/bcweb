/*
=======================================================================================================================================
Module: utils/ebayListingRules.js
=======================================================================================================================================
Purpose: THE rules that turn one of our styles into an eBay listing — the owner's Add decisions of 2026-11-01. One copy: the "Not on
         eBay" readiness check (routes/ebay-candidates.js) reads them now, and the List button (step 2) will build the listing from the
         same functions, so what the screen calls "ready" is exactly what gets listed. Pure functions — no DB, no eBay calls.

THE LISTING (owner decisions, CLAUDE.md "eBay listings"):
  one listing per STYLE (groupid), its sizes as the variations, fixed price only; no Birkenstock, ever
  price      the Shopify price, editable on the listing form; the eBay profit beside it
  postage    £4.50 Tracked 48 on every listing — the same as Shopify, so the eBay price IS the Shopify price (POSTAGE below)
  dispatch   same day for orders before 2pm Mon–Fri, wherever the pair is stored
  footer     FOOTER below, under the Shopify description (owner-approved wording — no postage price, no website, no "contact us")

CATEGORY (categoryFor) — from attributes.gender + attributes.producttype, which every non-Birkenstock style in stock has. IDs checked
against eBay's Taxonomy API (EBAY_GB tree 3) on 2026-11-01:
  Womens Sandals 62107 · Womens Shoes 45333 Flats, BUT "Trainer" in the title -> 95672 Trainers · Womens Boots / Wellies 53557 Boots
  Womens Slippers 11632 · Mens Shoes: Oxford / Brogue / Derby in the title -> 53120 Formal, else 24087 Casual · Boys Shoes 57929
  Anything else -> null (the screen says "No eBay category") — add it here when such a style first needs listing.

REQUIRED ITEM SPECIFICS in every one of those categories: Brand, Department, Colour, UK Shoe Size, Upper Material, Style (+ Type for
Boys). Every one is FREE TEXT on eBay, so our own words are accepted.
  Department   from gender (Women / Men / Boys)
  Colour       skusummary.colourmap (every style has it; `colour` is an overloaded segment tag — CLAUDE.md)
  UK Shoe Size skumap.uksize ("6 UK" -> "6", "8 UK Child" -> "8 Child") — NEVER the code's suffix: Skechers codes are US sizes and
               Rieker / Caprice / Strive / Remonte codes are EU
  Material     skusummary.material, else a material word in the title; if neither, the listing form asks for it and saves it back to
               skusummary.material (owner, option A) — so a missing material is a to-do on the form, not a blocker
  Style        the first STYLE_WORDS match in the title, else the type's default (owner: Sandals Strappy · Women's shoes Flat · Boots
               Ankle Boot · Men's shoes Lace Up); editable on the form
=======================================================================================================================================
*/

const POSTAGE = 4.50;          // £, Tracked 48, every listing (same as Shopify)
const TITLE_MAX = 80;          // eBay's title limit

const FOOTER = 'Genuine, brand new and boxed. Sold by a UK footwear retailer. Orders placed before 2pm Monday to Friday are sent the same '
  + 'day, tracked. Returns accepted within 30 days.';

const CATEGORY_NAMES = {
  62107: "Women's Sandals",
  45333: "Women's Flats",
  95672: "Women's Trainers",
  53557: "Women's Boots",
  11632: "Women's Slippers",
  53120: "Men's Formal Shoes",
  24087: "Men's Casual Shoes",
  57929: "Boys' Shoes",
};

const norm = (s) => String(s || '').trim().toLowerCase();

// -> { id, name } or null
function categoryFor(gender, producttype, title) {
  const g = norm(gender);
  const p = norm(producttype);
  const t = norm(title);
  let id = null;
  if (g === 'womens') {
    if (p === 'sandals') id = 62107;
    else if (p === 'shoes') id = /trainer/.test(t) ? 95672 : 45333;
    else if (p === 'boots' || p === 'wellies') id = 53557;
    else if (p === 'slippers') id = 11632;
  } else if (g === 'mens') {
    if (p === 'shoes') id = /oxford|brogue|derby/.test(t) ? 53120 : 24087;
  } else if (g === 'boys') {
    if (p === 'shoes') id = 57929;
  }
  return id ? { id, name: CATEGORY_NAMES[id] } : null;
}

function departmentFor(gender) {
  return { womens: 'Women', mens: 'Men', boys: 'Boys' }[norm(gender)] || null;
}

// Boys' Shoes also requires "Type" (eBay's values: Boot, Dress, Sandal, Slipper, Trainer).
function typeFor(gender, producttype, title) {
  if (norm(gender) !== 'boys') return null;
  const p = norm(producttype);
  if (/trainer/.test(norm(title))) return 'Trainer';
  return { boots: 'Boot', sandals: 'Sandal', slippers: 'Slipper' }[p] || 'Dress';
}

// Most specific first — the first word found in the title wins.
const STYLE_WORDS = [
  [/welli/, 'Wellies'],
  [/brogue/, 'Brogue'],
  [/oxford/, 'Oxford'],
  [/derby/, 'Derby'],
  [/loafer/, 'Loafer'],
  [/chelsea/, 'Chelsea'],
  [/knee/, 'Knee High'],
  [/ankle/, 'Ankle Boot'],
  [/sling/, 'Slingback'],
  [/slide/, 'Slider'],
  [/mule/, 'Mule'],
  [/toe post|flip/, 'Flip-Flop'],
  [/ballerina|ballet/, 'Ballet'],
  [/wedge/, 'Wedge'],
  [/trainer/, 'Trainer'],
  [/walking/, 'Walking'],
  [/strap/, 'Strappy'],
  [/hook and loop|touch|velcro/, 'Hook & Loop'],
  [/slip on|elasticated/, 'Slip On'],
  [/lace/, 'Lace Up'],
  [/zip/, 'Zip'],
];
const STYLE_DEFAULTS = {
  'womens/sandals': 'Strappy',
  'womens/shoes': 'Flat',
  'womens/boots': 'Ankle Boot',
  'womens/wellies': 'Wellies',
  'womens/slippers': 'Slip On',
  'mens/shoes': 'Lace Up',
  'boys/shoes': 'Lace Up',
};

// -> { value, from: 'title' | 'default' } or null
function styleFor(gender, producttype, title) {
  const t = norm(title);
  for (const [re, value] of STYLE_WORDS) if (re.test(t)) return { value, from: 'title' };
  const d = STYLE_DEFAULTS[`${norm(gender)}/${norm(producttype)}`];
  return d ? { value: d, from: 'default' } : null;
}

const MATERIAL_WORDS = [
  [/patent/, 'Patent'],
  [/nubuck/, 'Nubuck'],
  [/suede/, 'Suede'],
  [/leather/, 'Leather'],
  [/canvas/, 'Canvas'],
  [/mesh/, 'Mesh'],
  [/textile|fabric/, 'Textile'],
  [/synthetic/, 'Synthetic'],
  [/rubber/, 'Rubber'],
];

// -> { value, from: 'stored' | 'title' } or null (the form will ask)
function materialFor(stored, title) {
  const s = String(stored || '').trim();
  if (s) return { value: s, from: 'stored' };
  const t = norm(title);
  for (const [re, value] of MATERIAL_WORDS) if (re.test(t)) return { value, from: 'title' };
  return null;
}

// "6 UK" -> "6", "8 UK Child" -> "8 Child", "" -> null
function ukSizeFor(uksize) {
  const s = String(uksize || '').replace(/\bUK\b/i, '').replace(/\s+/g, ' ').trim();
  return s || null;
}

module.exports = {
  POSTAGE, TITLE_MAX, FOOTER, CATEGORY_NAMES,
  categoryFor, departmentFor, typeFor, styleFor, materialFor, ukSizeFor,
};
