/*
=======================================================================================================================================
Script: scripts/seo/link-check.js   (which internal pages link to a collection, before deleting it — READ ONLY)
=======================================================================================================================================
Purpose: Crawls the live storefront's collections + pages + blogs + home (from the sitemap) and builds a reverse map of every
         internal /collections/ link. The nav / footer is on every page, so it is caught automatically — a handle linked from most
         pages is in the menu (the dangerous case). Products are not crawled: a product description linking to an obscure
         collection is very rare.

         Pairs with `collections.js --thin` (finds delete candidates) and the delete rule in docs/seo/CHANGELOG.md (2026-07-17): a
         dead page with no traffic and no links is simply deleted (a clean 404), not redirected — there is no equity to keep.

         Shopify rate-limits a repeated crawl (503s). If under 70% of pages were fetched, the result is marked UNTRUSTWORTHY — a nav
         link could sit on a page that wasn't read. Wait a few minutes and re-run before acting.

Moved from C:\scripts\seo\link_check.py (2026-11-07).

Usage:
    node scripts/seo/link-check.js mens-wedding-shoes nhs-care
=======================================================================================================================================
*/

const { parseArgs } = require('util');

const ROOT = 'https://brookfieldcomfort.com';
const LOC = /<loc>([^<]+)<\/loc>/g;
const HREF = /href=["']([^"']*?\/collections\/[^"']*?)["']/gi;
const UA = 'Mozilla/5.0 (link-check; brookfieldcomfort internal)';

async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (r.ok) return await r.text();
    console.error(`  ! ${url} -> HTTP ${r.status}`);
  } catch (e) {
    console.error(`  ! ${url} -> ${e.message}`);
  }
  return '';
}

const locs = (xml) => [...xml.matchAll(LOC)].map((m) => m[1]);
const handleOf = (href) => (href.includes('/collections/')
  ? href.split('/collections/')[1].split(/[?#]/)[0].split('/')[0].toLowerCase() : null);

async function main() {
  const { positionals } = parseArgs({ allowPositionals: true, options: {} });
  const targets = positionals.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!targets.length) { console.error('Give at least one collection handle.'); process.exit(1); }

  // Collection, page and blog-article URLs from the sitemap (products skipped).
  const subs = locs(await get(`${ROOT}/sitemap.xml`)).filter((u) => /collections|pages|blogs/.test(u));
  const pages = new Set([`${ROOT}/`]);
  for (const sm of subs) for (const u of locs(await get(sm))) if (!u.endsWith('.xml')) pages.add(u.split('?')[0]);
  console.log(`Crawling ${pages.size} pages (collections + pages + blogs + home)...\n`);

  const inbound = Object.fromEntries(targets.map((t) => [t, new Map()]));
  let crawled = 0;
  for (const url of [...pages].sort()) {
    const html = await get(url);
    if (!html) continue;
    crawled++;
    const label = url.replace(ROOT, '') || '/';
    const src = url.includes('/collections/') ? handleOf(url) : label;
    for (const m of html.matchAll(HREF)) {
      const h = handleOf(m[1]);
      if (h in inbound && h !== src) inbound[h].set(label, (inbound[h].get(label) || 0) + 1);  // self-links (pagination) ignored
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  const coverage = pages.size ? crawled / pages.size : 0;
  console.log(`Crawled ${crawled} of ${pages.size} pages (${Math.round(coverage * 100)}%).\n`);
  if (coverage < 0.7) {
    console.log('  !! INCOMPLETE CRAWL - most fetches failed, likely Shopify rate-limiting (503).');
    console.log("     A 'no links' result here is NOT trustworthy. Wait a few minutes and re-run.\n");
  }
  const navThreshold = Math.max(2, Math.floor(crawled * 0.5));  // linked from >50% of pages ~= nav / footer
  for (const t of targets) {
    const srcs = [...inbound[t].keys()].sort();
    if (!srcs.length) {
      console.log(`  OK   ${t}  -- no internal links. Safe to delete (clean 404).`);
    } else {
      console.log(`  ${srcs.length >= navThreshold ? 'IN NAV/FOOTER' : 'LINKED'}  ${t}  (${srcs.length} source page(s)):`);
      for (const s of srcs.slice(0, 10)) console.log(`         <- ${s}`);
      if (srcs.length > 10) console.log(`         ... and ${srcs.length - 10} more`);
    }
  }
  console.log('\n  Products not crawled. A page with real traffic or links: redirect to a relevant parent;');
  console.log('  a dead page: a clean 404 is correct. See docs/seo/CHANGELOG.md.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[seo/link-check] failed:', err.message); process.exit(1); });
