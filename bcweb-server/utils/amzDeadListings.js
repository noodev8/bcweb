/*
=======================================================================================================================================
Util: utils/amzDeadListings.js   — the nightly clean-up of DEAD Amazon listings (2026-11-13)
=======================================================================================================================================
THE copy of the rules. Run by the Amazon nightly job (scripts/amz-inventory-nightly.js, step 'listings', right after the FBA Inventory
report), on that report's "on Amazon, unknown to us" SKUs — the list the Amazon status page's listings check shows, and that used to
be cleared by hand with the Delete file .xlsm.

THE RULE (owner, 2026-11-13: "can you not auto do that? ONLY IF amz has the product and its not in our db ( so skusummarry ) and it has
NO FBA stock"). A SKU is deleted from Amazon only when ALL of these hold:
  1. Amazon lists it (it is in tonight's FBA Inventory report) and it isn't one of Amazon's own amzn.gr.* SKUs (those never reach here);
  2. NO FBA STOCK: afn-total-quantity = 0 — nothing fulfillable, reserved, unsellable or inbound (Amazon won't remove a listing that
     holds units anyway), and live = 0;
  3. NOT IN OUR DB, checked every way we can tie it to a style:
       - not a SKU in skumap or amzfeed;
       - the SKU doesn't start with a skusummary style id ("<groupid>-…");
       - the SKU doesn't start with a code of a skumap size whose style is in skusummary ("<code>-…");
       - its ASIN isn't on an amzfeed row whose style is in skusummary (a second SKU on a product we sell).
     Why so many: Amazon SKUs are not always our code. On 13 Nov two of the three zero-stock "unknown" SKUs were 25511-41-022-40-2610
     and -42-202610 — second listings of a style we still sell (our own SKUs for those sizes end -2609). The rule keeps them; they
     stay on the listings check for a person to decide.
A SAFETY CAP: more than MAX_PER_NIGHT qualifying in one night deletes NONE and fails the step (red on Amazon status + the dashboard
warning) — that many at once means something upstream is wrong (a report read short, skusummary emptied …), not a normal night.

THE DELETE: Listings Items deleteListingsItem (SP-API, role Product Listing) — removes OUR offer for that SKU on amazon.co.uk; the
product page itself is Amazon's and stays. One call per SKU, paced. A SKU Amazon no longer has (404) counts as gone. Every deletion
writes a bclog row (section 'Amazon Listing') naming the SKU, ASIN and Amazon's item name; the night's result is kept in amz_api_sync
job 'dead_listings' (detail: deleted / kept / refused) for the status page. Nothing in our DB changes: these SKUs were never in it.
=======================================================================================================================================
*/

const sp = require('./amzSpApi');
const { logActivity } = require('./bclog');

const MAX_PER_NIGHT = 10;

/**
 * Which of the report's unknown SKUs may be deleted.
 * @param db          pool or client (query)
 * @param unknownSku  planStock's unknownSku: [{ sku, fnsku, asin, live, total }] — the FULL list, not the status page's capped one
 * @returns { candidates: [{ sku, asin }], kept: [{ sku, why }] }
 */
async function pickDeadListings(db, unknownSku) {
  const kept = [];
  const zero = [];
  for (const u of unknownSku || []) {
    if (Number(u.total) !== 0 || Number(u.live) !== 0) continue; // has FBA stock: not a candidate, not worth listing as "kept"
    zero.push(u);
  }
  if (!zero.length) return { candidates: [], kept };

  const r = await db.query(
    `SELECT u.sku, u.asin,
            EXISTS (SELECT 1 FROM skumap m WHERE m.sku = u.sku) AS in_skumap,
            EXISTS (SELECT 1 FROM amzfeed f WHERE f.sku = u.sku) AS in_amzfeed,
            (SELECT s.groupid FROM skusummary s
              WHERE left(u.sku, length(s.groupid) + 1) = s.groupid || '-' LIMIT 1) AS style_prefix,
            (SELECT m.groupid FROM skumap m JOIN skusummary s ON s.groupid = m.groupid
              WHERE COALESCE(m.code, '') <> '' AND left(u.sku, length(m.code) + 1) = m.code || '-' LIMIT 1) AS code_prefix,
            (SELECT f.groupid FROM amzfeed f JOIN skusummary s ON s.groupid = f.groupid
              WHERE COALESCE(u.asin, '') <> '' AND f.asin = u.asin LIMIT 1) AS same_asin
       FROM unnest($1::text[], $2::text[]) AS u(sku, asin)`,
    [zero.map((u) => u.sku), zero.map((u) => u.asin || '')]
  );

  const candidates = [];
  for (const x of r.rows) {
    const why = x.in_skumap ? 'a SKU in skumap'
      : x.in_amzfeed ? 'a SKU in amzfeed'
        : x.style_prefix ? `style ${x.style_prefix} is in our DB`
          : x.code_prefix ? `style ${x.code_prefix} is in our DB`
            : x.same_asin ? `same Amazon product as our style ${x.same_asin}`
              : null;
    if (why) kept.push({ sku: x.sku, why });
    else candidates.push({ sku: x.sku, asin: x.asin || null });
  }
  return { candidates, kept };
}

/** deleteListingsItem for one SKU → { ok, gone?, message }. */
async function deleteListing(sku) {
  const path = `/listings/2021-08-01/items/${encodeURIComponent(sp.sellerId())}/${encodeURIComponent(sku)}`;
  try {
    const res = await sp.spDelete(path, { marketplaceIds: sp.marketplaceId() });
    if (res && res.status === 'ACCEPTED') return { ok: true, message: null };
    const issues = ((res && res.issues) || []).map((i) => i.message).filter(Boolean);
    return { ok: false, message: issues.join(' · ') || `Amazon answered ${res && res.status}` };
  } catch (e) {
    if (e.status === 404) return { ok: true, gone: true, message: 'already gone from Amazon' };
    return { ok: false, message: e.message };
  }
}

/** Amazon's name for the listing, for the log (best effort — a failed read just leaves it out). */
async function itemName(sku) {
  try {
    const r = await sp.spGet(`/listings/2021-08-01/items/${encodeURIComponent(sp.sellerId())}/${encodeURIComponent(sku)}`, {
      marketplaceIds: sp.marketplaceId(), includedData: 'summaries',
    });
    return ((r.summaries || [])[0] || {}).itemName || null;
  } catch { return null; }
}

/**
 * The night's clean-up. commit=false: only says what it would delete.
 * @returns { candidates, kept, deleted: [{ sku, asin, name }], refused: [{ sku, message }], capped: boolean }
 */
async function cleanDeadListings(db, unknownSku, { commit }) {
  const { candidates, kept } = await pickDeadListings(db, unknownSku);
  const out = { candidates, kept, deleted: [], refused: [], capped: candidates.length > MAX_PER_NIGHT };
  if (!commit || !candidates.length || out.capped) return out;
  sp.sellerId(); // "not configured" before anything is sent
  for (const c of candidates) {
    const name = await itemName(c.sku);
    const r = await deleteListing(c.sku);
    if (r.ok) {
      out.deleted.push({ sku: c.sku, asin: c.asin, name, gone: !!r.gone });
      await logActivity({ // best effort: the listing is already gone, a failed log line mustn't turn that into a failure
        who: 'cron', section: 'Amazon Listing',
        log: `Deleted dead Amazon listing ${c.sku}${c.asin ? ` (${c.asin})` : ''}${name ? ` ${name}` : ''}: not in BCWEB, no FBA stock${r.gone ? ' (already gone)' : ''}`,
      });
    } else {
      out.refused.push({ sku: c.sku, message: r.message });
    }
    await sp.sleep(600); // deleteListingsItem allows ~5 a second; no hurry at night
  }
  return out;
}

module.exports = { cleanDeadListings, pickDeadListings, MAX_PER_NIGHT };
