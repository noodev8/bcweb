/*
=======================================================================================================================================
Script: scripts/seo/queries.js   (the keyword miner — READ ONLY)
=======================================================================================================================================
Purpose: What we rank for, and what has no page to rank with. 28 days to the last complete GSC day.

         GSC is a mirror, not a market: it only reports queries we ALREADY appear for, so this finds demand where we have a footing
         and is blind to greenfield. That limit is the point — everything it surfaces is proven demand on proven authority.

         The default view looks for the Arizona pattern: when a browse query has no page built for it, Google scatters it across
         whatever product pages it can find, each earning a few impressions and no clicks. A term with volume, spread over many pages,
         with no collection / info page NAMED for it, is a page waiting to be built. (Caution from 2026-08: Arizona and Madrid were
         then built/linked and Google still served product pages — see docs/seo/README.md "collections stopped doing their job".)

Moved from C:\scripts\seo\queries.py (2026-11-07). Same rules.

Usage:
    node scripts/seo/queries.js                                (clusters: what has volume and no page)
    node scripts/seo/queries.js --page /collections/x          (what one page ranks for)
    node scripts/seo/queries.js --query "arizona birkenstock"  (what ranks for one term)
    node scripts/seo/queries.js --contains narrow              (every query containing a word)
    --top N   rows (default 25)
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { parseArgs } = require('util');
const { gscQuery, gscEnd, addDays, ymd } = require('../../utils/searchConsole');
const { toUrl, short, totals, num, pct, L, R, rule } = require('../../utils/seo');

const WINDOW_DAYS = 28;
const MIN_CLUSTER_IMPR = 200;
const MIN_SPREAD = 5;  // pages a term must be scattered over to count as having no page

// Words that carry no intent of their own: the supplier brand (in nearly every query — one useless bucket) and OUR name
// (navigational, served by the homepage). Fit and style words are deliberately NOT here: "narrow", "arizona", "zermatt" are exactly
// what we are hunting.
const STOP = new Set([
  'birkenstock', 'birkenstocks', 'brookfield', 'comfort',
  'uk', 'the', 'a', 'an', 'for', 'in', 'of', 'and', 'or', 'to', 'my', 'me',
  'is', 'are', 'do', 'does', 'dont', 'not', 'why', 'what', 'how',
  'with', 'on', 'at', 'buy', 'online', 'shop', 'sale', 'cheap', 'best',
]);

// Intent-carrying words in a query. Digits dropped (sizes like '260' cluster into noise); apostrophes stripped so "women's" and
// "womens" are one term.
function tokens(q) {
  return new Set(q.toLowerCase().replace(/'/g, '').split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w) && w.length > 2));
}

function printQueries(rows, title, width = 50) {
  console.log(`\n${rule()}\n${title}\n${rule()}`);
  console.log(`  ${L('query', width)} ${R('clicks', 6)} ${R('impr', 7)} ${R('CTR', 6)} ${R('pos', 5)}`);
  for (const r of rows) {
    console.log(`  ${L(r.keys[0], width)} ${R(num(r.clicks), 6)} ${R(num(r.impressions), 7)} `
      + `${R(pct(r.impressions ? (r.clicks / r.impressions) * 100 : 0), 6)} ${R(r.position.toFixed(1), 5)}`);
  }
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      page: { type: 'string' }, query: { type: 'string' }, contains: { type: 'string' }, top: { type: 'string', default: '25' },
    },
  });
  const top = Number(args.top) || 25;
  const end = gscEnd();
  const start = addDays(end, -(WINDOW_DAYS - 1));
  const fetch = (dimensions, filters) => gscQuery({ start, end, dimensions, filters });

  // ---- what one page ranks for ----
  if (args.page) {
    const url = toUrl(args.page);
    const rows = await fetch(['query'], [{ dimension: 'page', operator: 'equals', expression: url }]);
    const t = totals(rows);
    console.log(`\n${short(url, 70)} - ${WINDOW_DAYS}d to ${ymd(end)}`);
    console.log(`${num(rows.length)} named queries, ${num(t.clicks)} clicks, ${num(t.impr)} impressions`);
    console.log('GSC anonymises rare queries, so this will NOT sum to the page total.');
    printQueries([...rows].sort((a, b) => b.impressions - a.impressions).slice(0, top), 'BY IMPRESSIONS');
    printQueries([...rows].sort((a, b) => b.clicks - a.clicks).slice(0, top), 'BY CLICKS - what actually earns');
    console.log();
    return;
  }

  // ---- what ranks for one term ----
  if (args.query) {
    const rows = await fetch(['page'], [{ dimension: 'query', operator: 'equals', expression: args.query }]);
    console.log(`\n"${args.query}" - ${WINDOW_DAYS}d to ${ymd(end)} - ${rows.length} pages ranking\n`);
    console.log(`  ${L('page', 56)} ${R('clicks', 6)} ${R('impr', 7)} ${R('pos', 5)}`);
    for (const r of [...rows].sort((a, b) => b.impressions - a.impressions).slice(0, top)) {
      console.log(`  ${L(short(r.keys[0], 56), 56)} ${R(num(r.clicks), 6)} ${R(num(r.impressions), 7)} ${R(r.position.toFixed(1), 5)}`);
    }
    if (rows.length > 5) {
      console.log(`\n  ${rows.length} pages splitting one query is the no-dedicated-page`);
      console.log('  signal - Google is guessing because nothing was built for this.');
    }
    console.log();
    return;
  }

  // ---- every query containing a word ----
  if (args.contains) {
    const rows = (await fetch(['query'])).filter((r) => r.keys[0].toLowerCase().includes(args.contains.toLowerCase()));
    const t = totals(rows);
    console.log(`\n"${args.contains}" - ${WINDOW_DAYS}d to ${ymd(end)} - ${rows.length} queries, `
      + `${num(t.clicks)} clicks, ${num(t.impr)} impressions, ${pct(t.ctr)} CTR`);
    printQueries([...rows].sort((a, b) => b.impressions - a.impressions).slice(0, top), 'BY IMPRESSIONS');
    console.log();
    return;
  }

  // ---- default: clusters with volume and no page ----
  const rows = await fetch(['query', 'page']);
  const clusters = new Map();
  for (const r of rows) {
    const [q, page] = r.keys;
    for (const t of tokens(q)) {
      const c = clusters.get(t) || { queries: new Set(), clicks: 0, impr: 0, posw: 0, pages: new Map() };
      c.queries.add(q); c.clicks += r.clicks; c.impr += r.impressions; c.posw += r.position * r.impressions;
      c.pages.set(page, (c.pages.get(page) || 0) + r.impressions);
      clusters.set(t, c);
    }
  }
  const rank = [...clusters].filter(([, c]) => c.impr >= MIN_CLUSTER_IMPR).sort((a, b) => b[1].impr - a[1].impr);

  console.log(`\nQUERY CLUSTERS - ${WINDOW_DAYS}d to ${ymd(end)} - terms over ${MIN_CLUSTER_IMPR} impressions`);
  console.log('A query counts toward every token it contains, so columns do not sum to site totals.\n');
  console.log(rule());
  console.log(`  ${L('term', 14)} ${R('queries', 7)} ${R('impr', 7)} ${R('clicks', 6)} ${R('CTR', 6)} ${R('pos', 5)} ${R('pages', 6)}  ${L('collection', 24)}`);
  console.log(rule());

  const todo = [];
  // Scan every cluster, print only --top: discovery must not depend on how many rows someone asked to see.
  rank.forEach(([t, c], n) => {
    // A collection OR an info page whose slug carries the term is the page built for it (the size guide owns "size"). Product pages
    // containing the word do not count — 143 Arizona product pages is the symptom, not the cure.
    const owned = [...c.pages.keys()].filter((p) => (p.includes('/collections/') || p.includes('/pages/'))
      && p.replace(/\/$/, '').split('/').pop().includes(t));
    const best = owned.length ? owned.reduce((a, p) => (c.pages.get(p) > c.pages.get(a) ? p : a)) : null;
    const owner = best ? short(best, 40).replace('/collections/', '').replace('/pages/', '') : 'NONE  <-- no page';
    // Spread separates "no page exists" (Google scattering the term) from "a page exists and ranks badly" (a ranking job).
    if (!best && c.pages.size >= MIN_SPREAD) todo.push([t, c]);
    if (n < top) {
      console.log(`  ${L(t, 14)} ${R(c.queries.size, 7)} ${R(num(c.impr), 7)} ${R(num(c.clicks), 6)} ${R(pct((c.clicks / c.impr) * 100), 6)} `
        + `${R((c.posw / c.impr).toFixed(1), 5)} ${R(c.pages.size, 6)}  ${L(owner, 24)}`);
    }
  });

  console.log();
  console.log(rule());
  console.log('NO PAGE BUILT FOR IT - volume, scattered across pages, no collection');
  console.log(rule());
  if (!todo.length) console.log('  Nothing. Every term with volume has a collection serving it.');
  for (const [t, c] of todo.sort((a, b) => b[1].impr - a[1].impr).slice(0, 10)) {
    const topPage = [...c.pages.keys()].reduce((a, p) => (c.pages.get(p) > c.pages.get(a) ? p : a));
    console.log(`  ${L(t, 14)} ${R(num(c.impr), 7)} impr  ${R(num(c.clicks), 4)} clicks  pos ${R((c.posw / c.impr).toFixed(1), 4)}  across ${c.pages.size} pages`);
    console.log(`                 best is ${short(topPage, 56)}`);
  }
  console.log();
  console.log(`  Volume + spread over ${MIN_SPREAD}+ pages + no page named for it = build it.`);
  console.log('  Terms above with NONE but few pages are a ranking problem, not a');
  console.log('  missing page - a page serves them, just not one named for the term.');
  console.log('  Check --query "<term>" before acting: position is averaged across');
  console.log('  every query, and a term can be spread over pages legitimately.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[seo/queries] failed:', err.message); process.exit(1); });
