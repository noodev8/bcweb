/*
=======================================================================================================================================
Script: scripts/shopify-remove-width-options.js   (WRITES Shopify product descriptions — only with --commit)
=======================================================================================================================================
Purpose: Take the hand-written "Width Options  REGULAR / NARROW" links out of every Shopify product description (owner, 2026-11-08:
         "The swatches for Regular / Narrow are working. We need to take them ALL out of the descriptions"). The Narrow / Regular
         switch now comes from the colour-swatch metafields + theme block (utils/birkSwatches.js), so the hand links are a duplicate
         that drifts (some pointed at the wrong colour).

What is removed: the <span class="product-description-text"> holding "Width Options<br><a>REGULAR</a> / <a>NARROW</a>" — with the
         <p> around it and a <br> after it when present — and the heading-less "<a>NARROW</a> / <a>REGULAR</a>" span on the Mayari
         Sandcastle pair. Nothing else on the page changes (the 3 Gizeh "Colour Options" picture blocks were cut the same day by hand).

Safety:  a page is SKIPPED (reported, never written) if the piece to remove holds any text other than the width words / slashes,
         or if REGULAR / NARROW links or "Width Options" are still there after the cut. --commit then runs productUpdate one page
         at a time. No backup is kept (owner, 2026-11-08: "We can just adjust the originals if find an issue").

Afterwards: run the descriptions review (/descriptions-review) — the changed pages show as CHANGED for the Google feed / eBay text.

Usage (from bcweb-server/):
    node scripts/shopify-remove-width-options.js            dry run — what would change
    node scripts/shopify-remove-width-options.js --show     dry run + each removed piece
    node scripts/shopify-remove-width-options.js --commit   write to Shopify
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { shopifyGraphQL } = require('../utils/shopify');


// The width span: a product-description-text span whose content is links + "Width Options" / slashes / <br> only.
// [^<]* and <a ...>...</a> pieces keep it inside one span (no nested spans in these blocks).
// An empty inner <span> </span> (Madrid black narrow) is allowed inside.
const SPAN = '<span class="product-description-text">(?:\\s|<br\\s*/?>|[^<]|<span>[^<]*</span>|<a\\b[^>]*>[^<]*</a>)*?</span>';
const BLOCK = new RegExp(`(?:<p>\\s*)?${SPAN}(?:\\s*<br\\s*/?>)?(?:\\s*</p>)?\\n?`, 'gi');
// "WIDTH OPTIONS" as a paragraph of its own above the links (the two Madrid patent pages)
const HEADING = /<p>\s*<span class="product-description-text">\s*width\s*options?\s*<\/span>\s*<\/p>\n?/gi;
// One page has the links inside the same <p> as its first description line — cut exactly that piece, keep the text.
const EXACT = {
  'birkenstock-gizeh-sandals-birko-flor-patent-white-narrow-fit-1005300-gizeh':
    // the two spaces round the slash are non-breaking (U+00A0), as Shopify's editor saved them
    '<span>Width Options</span><br><a href="https://brookfieldcomfort.com/products/birkenstock-gizeh-birko-flor-regular-width-patent-white-1005299">REGULAR</a><span><a href="https://brookfieldcomfort.com/products/birkenstock-gizeh-birko-flor-regular-width-patent-white-1005299"> </a>/ </span><a href="https://brookfieldcomfort.com/products/birkenstock-gizeh-sandals-birko-flor-patent-white-narrow-fit-1005300-gizeh">NARROW</a><br><br>',
};

const LEFT = /width\s*options?|>\s*(REGULAR|NARROW)\s*<\/a>/i;

function cut(html, handle) {
  let removed = [];
  const exact = EXACT[handle];
  if (exact && html.split(exact).length === 2) { html = html.replace(exact, ''); removed.push({ piece: exact }); }
  html = html.replace(HEADING, (m) => { removed.push({ piece: m }); return ''; });
  const out = html.replace(BLOCK, (m) => {
    // only a span that is a width block — has REGULAR/NARROW links, and no other words
    if (!/>\s*(REGULAR|NARROW)\s*<\/a>/i.test(m)) return m;
    const words = m.replace(/<[^>]+>/g, ' ').replace(/width\s*options?|regular|narrow|\//gi, ' ').trim();
    if (words) { removed.push({ bad: words, piece: m }); return m; }
    // a <p> opened before the span but not closed in the match would leave a stray </p> — keep the tags balanced
    const opens = (m.match(/<p>/gi) || []).length, closes = (m.match(/<\/p>/gi) || []).length;
    if (opens !== closes) { removed.push({ bad: 'unbalanced <p>', piece: m }); return m; }
    removed.push({ piece: m });
    return '';
  });
  const bad = removed.filter((r) => r.bad);
  return { out, removed: removed.filter((r) => !r.bad), bad, left: LEFT.test(out) };
}

async function allProducts() {
  const out = [];
  let after = null;
  for (;;) {
    const d = await shopifyGraphQL(`query($a:String){products(first:250,after:$a){pageInfo{hasNextPage endCursor}
      nodes{id handle title status descriptionHtml}}}`, { a: after });
    const p = (d.data || d).products;
    out.push(...p.nodes);
    if (!p.pageInfo.hasNextPage) return out;
    after = p.pageInfo.endCursor;
  }
}

async function main() {
  const commit = process.argv.includes('--commit');
  const show = process.argv.includes('--show');
  const products = await allProducts();
  const todo = [], skipped = [];
  for (const p of products) {
    const html = p.descriptionHtml || '';
    if (!LEFT.test(html)) continue;
    const r = cut(html, p.handle);
    if (r.bad.length || r.left || !r.removed.length) { skipped.push({ p, r }); continue; }
    todo.push({ p, r });
  }

  for (const { p, r } of todo) {
    console.log(`${p.status.padEnd(8)} ${p.handle}  (${r.removed.length} block${r.removed.length > 1 ? 's' : ''})`);
    if (show) for (const x of r.removed) console.log('    - ' + x.piece.replace(/\s+/g, ' ').slice(0, 300));
  }
  for (const { p, r } of skipped) {
    console.log(`SKIPPED  ${p.handle} — ${r.bad.map((b) => b.bad).join('; ') || (r.left ? 'width links still there after the cut' : 'no block matched')}`);
  }
  console.log(`\n${products.length} products read — ${todo.length} to change, ${skipped.length} skipped`
    + (commit ? '' : ' — DRY RUN (add --commit to write)'));
  if (!commit || !todo.length) return;


  let ok = 0;
  for (const { p, r } of todo) {
    const d = await shopifyGraphQL(`mutation($i:ProductUpdateInput!){productUpdate(product:$i){product{id} userErrors{field message}}}`,
      { i: { id: p.id, descriptionHtml: r.out } });
    const errs = (d.data || d).productUpdate.userErrors;
    if (errs.length) console.log(`FAILED   ${p.handle}: ${errs.map((e) => e.message).join('; ')}`);
    else ok++;
  }
  console.log(`${ok} of ${todo.length} written to Shopify`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { cut };
