/*
=======================================================================================================================================
API Route: amz_find
=======================================================================================================================================
Method: GET
Purpose: Direct SKU search for the Amazon Pricing module (the mirror of Shopify's pricing-find). Matches search terms against the internal
         code, the FULL Amazon Seller SKU (a.sku — internal `code` PLUS the trailing supplier suffix, e.g. 'JLH455-CHARL-BLACK-04-2606';
         operators paste this straight from Seller Central), the groupid, OR the human-readable title (title.shopifytitle — NOT the
         overloaded colour tag), across ALL styles (segmented or not), so the operator can jump straight to a size's drill without going
         through segment -> list.

         NARROWING STEPS (`has` / `not`), added 2026-07-25. The single box could only ever widen: searching RIEKER returns all 121 SKUs of
         it, and there was no way to say "the mens ones". That matters because SEGMENTS ARE A PARTITION — a style sits in exactly one, so
         the segment scheme can express ONE cut of the catalogue at a time (currently seasonal: RIEKER-WIN / RIEKER-SUM). A cross-cutting
         question like "mens Rieker" is structurally unanswerable through segments — mens Rieker is 5 styles spread across both — and gender
         exists ONLY in shopifytitle ("Mens Rieker Wide Fit Shoes Brown"); no code or groupid carries it. So a `not` on the title is the
         only thing that can split the set. This route is the deliberate cross-segment escape hatch, which makes it the right home
         for that: `has=RIEKER` + `not=WOMENS` -> exactly the 27 mens SKUs.
           * `has` is a loose SUBSTRING (operators paste partials — "1765" must find 17659-23).
           * `not` is the exact MIRROR — also a plain substring, so anything containing the term is dropped. Was `\y…\y` whole-word
             until 2026-08-25; that could not drop "Womens …" for `not=WOMEN`, so it only worked if you typed the plural. See the
             loop below for the trade-off the owner accepted.
         Unlike analytics-sales there is NO minimum term length: that table is 17.7k rows where a 1-char term matches nearly everything,
         whereas amzfeed is 522 rows and operators routinely paste short groupid fragments like "17659". Mirroring the floor would block a
         normal search, so the two screens differ on purpose.

         TRUNCATION IS NOW REPORTED (`total` / `truncated`), which is the more urgent half of this change. The route used to cap at 50 and
         say nothing — a RIEKER search returned 50 of 121 with no indication. The Find PAGE carries select-all plus a bulk price bar, so an
         operator could tick "all", apply a move, and believe they had repriced 121 SKUs when they had done 50. The cap is now 200 (amzfeed
         is 522 rows / 224kB, so that is generous and truncation becomes rare) and the response always carries the TRUE match count so the
         UI can show "50 of 121" and warn before a bulk action.

         SKU-grain: a groupid match returns every size under it (each is its own priceable SKU), so results fan out. Any SKU with an amzfeed
         row is searchable — un-segmented styles included (their `segment` comes back null); this is a deliberate "jump to any SKU" escape
         hatch, NOT limited to styles in a managed segment. Requires auth.

NOTE ON DUPLICATION: the term-parsing helpers below are a deliberate copy of the ones in analytics-sales.js, kept separate at the
owner's call (2026-07-25) so the two screens can diverge without one breaking the other — they already differ on the minimum term length.
If you fix a bug in the term normalising HERE, apply it THERE too. The has/not MATCHING RULE is shared by all four search screens
(these two routes plus Inventory and Amazon Order client-side) and must stay identical across them.
=======================================================================================================================================
Request Query Params:
  has   (string[], optional) - repeatable. Each term ANDs a substring match over code / Amazon SKU / groupid / title (case-insensitive).
  not   (string[], optional) - repeatable. Each term ANDs a SUBSTRING exclusion over the same four fields.
  term  (string, optional)   - legacy alias for a single `has` term. Kept because cross-module jumps deep-link here as /amz/find?q=<groupid>
                               (Analytics "reprice this", the Sales row-click), and those links must keep working.
  limit (int, optional)      - row cap; default 200, clamped to [1, 500]. The COUNT is never capped.
  At least one of has / term is required (a `not` alone would mean "everything except…", which is not a search).

Success Response:
{
  "return_code": "SUCCESS",
  "has": ["RIEKER"], "not": ["WOMENS"],
  "results": [
    { "code": "17659-23-42", "amz_sku": "17659-23-42-2607", "groupid": "17659-23", "segment": "RIEKER-SUM",
      "size": "42", "title": "Mens Rieker Wide Fit Shoes Brown", "price": 77.19, "fba": 0 },
    ...  // up to `limit`, ordered by groupid then code
  ],
  "total": 27,        // TRUE number of matching SKUs, ignoring the cap
  "count": 27,        // rows actually returned
  "limit": 200,
  "truncated": false  // true = more matched than were returned; bulk actions on this page only reach what came back
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// The text every search step is matched against: the same four fields the single box always covered, concatenated so one predicate spans
// all of them (and so a whole-word `not` can't be fooled by a term straddling two). COALESCE because title is LEFT JOINed and sku/groupid
// are nullable on odd feed rows — a NULL would swallow the whole expression.
const HAY = `(COALESCE(a.code,'') || ' ' || COALESCE(a.sku,'') || ' ' || COALESCE(a.groupid,'') || ' ' || COALESCE(t.shopifytitle,''))`;

// Belt-and-braces cap on how many terms one request may carry — the UI can't produce more than a handful, and each is another predicate.
const MAX_TERMS = 8;

const DEFAULT_LIMIT = 200;   // generous against a 522-row table: truncation should be the exception, not the norm
const MAX_LIMIT = 500;

// A repeatable query param arrives as a string (one value) or an array (several). Normalise to a trimmed, non-empty, de-duplicated list.
// `has[]=`-style keys are accepted too, in case a client serialises arrays that way.
function toTerms(raw, rawBracket) {
  const src = raw !== undefined ? raw : rawBracket;
  const list = Array.isArray(src) ? src : src === undefined || src === null ? [] : [src];
  const out = [];
  for (const v of list) {
    const t = String(v).trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

router.get('/', async (req, res) => {
  try {
    const hasTerms = toTerms(req.query.has, req.query['has[]']);
    const notTerms = toTerms(req.query.not, req.query['not[]']);

    // Legacy single-term callers (and every cross-module ?q= deep link) fold in as the leading `has`.
    const legacyTerm = typeof req.query.term === 'string' ? req.query.term.trim() : '';
    if (legacyTerm && !hasTerms.includes(legacyTerm)) hasTerms.unshift(legacyTerm);

    // A `not` on its own would mean "every SKU except…", which is a catalogue dump, not a search. Require something positive first.
    if (hasTerms.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'A search term is required' });
    }

    let limit = Number.parseInt(req.query.limit, 10);
    if (!(limit > 0)) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    // Each term becomes one parameterised predicate (the %..% wrappers are built here and BOUND, never interpolated into SQL, so
    // this stays injection-safe per CLAUDE.md). Built before the SQL strings so placeholder numbers stay in step with the params array.
    const params = [];
    const termClauses = [];
    for (const t of hasTerms) {
      params.push(`%${t}%`);
      termClauses.push(`AND ${HAY} ILIKE $${params.length}`);
    }
    for (const t of notTerms) {
      // NOT is the exact mirror of the ILIKE above — a plain substring over the whole haystack, the legacy PowerBuilder rule
      // (`Pos(...) > 0` -> drop the row) the operator works to. This replaced a `!~* '\y…\y'` POSIX word-boundary test on
      // 2026-08-25: \y could not drop "Womens …" when you excluded WOMEN (the boundary falls between "n" and "s"), so it only
      // worked if you typed the plural. Substring accepts both WOMEN and WOMENS. Cost: a short term over-matches (excluding SAND
      // also drops SANDALS) — knowingly accepted by the owner; narrow with a longer term instead.
      params.push(`%${t}%`);
      termClauses.push(`AND ${HAY} NOT ILIKE $${params.length}`);
    }

    // NOTE: find is a "jump to ANY SKU" escape hatch — it deliberately does NOT require the style to belong to a managed segment (that
    // gate was removed per owner). Un-segmented styles (segment '') are reachable too; their `segment` comes back null. skusummary is
    // LEFT JOINed so even an amzfeed row with no skusummary match still surfaces. The drill works off `code`, so those still drill.
    const baseFrom = `
      FROM amzfeed a
      LEFT JOIN skusummary sk ON sk.groupid = a.groupid
      LEFT JOIN title t ON t.groupid = a.groupid
      WHERE 1=1
        ${termClauses.join('\n        ')}`;

    // COUNT first and UNCAPPED — this is what makes "50 of 121" honest, and what the page needs before it lets anyone bulk-apply.
    // Same joins as the row query so the two can never disagree. Cheap: amzfeed is 522 rows.
    const countResult = await query(`SELECT COUNT(*)::int AS total ${baseFrom}`, params);
    const total = countResult.rows[0] ? Number(countResult.rows[0].total) : 0;

    const result = await query(`
      SELECT a.code, a.sku AS amz_sku, a.groupid, NULLIF(sk.segment,'') AS segment, RIGHT(a.code,2) AS size,
             t.shopifytitle AS title,
             ${safeNumeric('a.amzprice')} AS price,
             COALESCE(a.amzlive,0) AS fba
      ${baseFrom}
      ORDER BY a.groupid, a.code
      LIMIT $${params.length + 1}
    `, [...params, limit]);

    const results = result.rows.map((r) => ({
      code: r.code,
      amz_sku: r.amz_sku,
      groupid: r.groupid,
      segment: r.segment || null,
      size: r.size,
      title: r.title || null,
      price: num(r.price),
      fba: Number(r.fba),
    }));

    return res.json({
      return_code: 'SUCCESS',
      has: hasTerms,
      not: notTerms,
      results,
      total,
      count: results.length,
      limit,
      truncated: total > results.length,
    });
  } catch (err) {
    logger.error('[amz-find] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Search failed' });
  }
});

module.exports = router;
