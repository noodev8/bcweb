/*
=======================================================================================================================================
Script: scripts/seo/organic-pages.js   (organic revenue by landing page, GA4 — READ ONLY)
=======================================================================================================================================
Purpose: The page-level answer to "which free pages are worth effort?" — the question click counts can't reach. For one GA4 channel
         (default Organic Search) it shows where visitors land, whether they buy and what a session is worth, then rolls it up by
         page type. July 2026's read: product £3.20 / session, collection £1.81, info £0.44, blog £0 (docs/seo/README.md).

         --channels prints the split for EVERY channel instead (the old ga4_client.py access test): what an organic session is worth
         against a paid one.

         How to read it: GA4 undercounts absolute revenue (~60% of the sales table) — trust the split and the per-session RANK, never
         the pounds. "Organic Search" includes brand searches the page did not earn. Revenue credits the LANDING page, so
         browse-then-buy flatters the entry point. Per-page conversion on ~100 purchases / 90d is thin; trust the type roll-up.

Moved from C:\scripts\seo\organic_pages.py + ga4_client.py (2026-11-07).

Usage:
    node scripts/seo/organic-pages.js                         (Organic Search, last 90 days, top 25)
    node scripts/seo/organic-pages.js --days 28 --top 40
    node scripts/seo/organic-pages.js --channel "Organic Shopping"
    node scripts/seo/organic-pages.js --channels              (every channel: sessions, revenue, £/session)
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { parseArgs } = require('util');
const { runReport, PROPERTY_ID } = require('../../utils/ga4');
const { classify, num, L, R } = require('../../utils/seo');

const per = (a, b) => (b ? a / b : 0);

async function main() {
  const { values: args } = parseArgs({
    options: {
      days: { type: 'string', default: '90' }, top: { type: 'string', default: '25' },
      channel: { type: 'string', default: 'Organic Search' }, channels: { type: 'boolean', default: false },
    },
  });
  const days = Number(args.days) || 90;
  const top = Number(args.top) || 25;

  if (args.channels) {
    const rows = await runReport({
      dimensions: ['sessionPrimaryChannelGroup'], metrics: ['sessions', 'ecommercePurchases', 'totalRevenue'],
      start: `${days}daysAgo`, end: 'yesterday', orderMetric: 'totalRevenue',
    });
    console.log(`\nGA4 property ${PROPERTY_ID} - every channel - last ${days} days\n`);
    console.log(`  ${L('channel', 24)} ${R('sessions', 9)} ${R('buys', 6)} ${R('conv%', 6)} ${R('revenue', 10)} ${R('£/sess', 7)}`);
    for (const r of rows) {
      console.log(`  ${L(r.sessionPrimaryChannelGroup, 24)} ${R(num(r.sessions), 9)} ${R(num(r.ecommercePurchases), 6)} `
        + `${R((per(r.ecommercePurchases, r.sessions) * 100).toFixed(1), 6)} ${R(num(r.totalRevenue), 10)} ${R(per(r.totalRevenue, r.sessions).toFixed(2), 7)}`);
    }
    console.log('\n  Trust the split between channels, not the pounds (GA4 sees ~60% of revenue).\n');
    return;
  }

  const rows = await runReport({
    dimensions: ['landingPage'], metrics: ['sessions', 'ecommercePurchases', 'totalRevenue'],
    start: `${days}daysAgo`, end: 'yesterday',
    filter: { dimension: 'sessionDefaultChannelGroup', value: args.channel }, orderMetric: 'totalRevenue',
  });
  const tot = rows.reduce((a, r) => ({ s: a.s + r.sessions, p: a.p + r.ecommercePurchases, r: a.r + r.totalRevenue }), { s: 0, p: 0, r: 0 });

  console.log(`\nORGANIC REVENUE BY PAGE - '${args.channel}' - last ${days}d`);
  console.log(`${rows.length} landing pages, ${num(tot.s)} sessions, ${num(tot.p)} purchases, £${num(tot.r)} revenue `
    + `(conv ${(per(tot.p, tot.s) * 100).toFixed(2)}%, £${per(tot.r, tot.s).toFixed(2)}/session)\n`);
  console.log(`  ${L('landing page', 46)} ${L('type', 11)} ${R('sess', 5)} ${R('buys', 5)} ${R('conv%', 6)} ${R('revenue', 9)} ${R('£/sess', 7)}`);
  console.log(`  ${'-'.repeat(96)}`);
  for (const r of rows.slice(0, top)) {
    const p = r.landingPage || '(not set)';
    console.log(`  ${L(p, 46)} ${L(classify(p), 11)} ${R(num(r.sessions), 5)} ${R(num(r.ecommercePurchases), 5)} `
      + `${R((per(r.ecommercePurchases, r.sessions) * 100).toFixed(1), 6)} ${R(num(r.totalRevenue), 9)} ${R(per(r.totalRevenue, r.sessions).toFixed(2), 7)}`);
  }

  // Roll up by page type: the actual answer to "do intent-rich pages convert?"
  const types = {};
  for (const r of rows) {
    const t = classify(r.landingPage || '');
    const a = types[t] || (types[t] = { s: 0, p: 0, r: 0 });
    a.s += r.sessions; a.p += r.ecommercePurchases; a.r += r.totalRevenue;
  }
  console.log('\n  BY TYPE - does intent convert?');
  console.log(`  ${L('type', 11)} ${R('sess', 6)} ${R('buys', 5)} ${R('conv%', 6)} ${R('revenue', 9)} ${R('£/sess', 7)}`);
  for (const [t, a] of Object.entries(types).sort((x, y) => y[1].r - x[1].r)) {
    console.log(`  ${L(t, 11)} ${R(num(a.s), 6)} ${R(num(a.p), 5)} ${R((per(a.p, a.s) * 100).toFixed(1), 6)} ${R(num(a.r), 9)} ${R(per(a.r, a.s).toFixed(2), 7)}`);
  }
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[seo/organic-pages] failed:', err.message); process.exit(1); });
