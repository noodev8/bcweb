/*
=======================================================================================================================================
API Route: analytics_ad_payback
=======================================================================================================================================
Method: GET
Purpose: Reports — what SOLD on one day, and whether each of those styles is actually paying for its advertising. One row per style
         that sold on the chosen day, with the day's take beside the style's trailing 30-day position.

         Requires auth. Read-only.

WHY THIS EXISTS RATHER THAN A "TODAY" WINDOW ON THE GOOGLE ADS SCREEN (owner, 2026-09-06)
A one-day window was asked for there first and does not work, for a reason worth recording so it is not tried again. On a normal day
50-100 styles draw ad spend and 2-21 sell (measured over the fortnight to 5 Sep 2026), so a one-day GRID is ~95% rows reading "took
spend, sold nothing" — every one of which looks like a loser and almost none of which is. The day is far too small to carry a
membership test.

Inverting it fixes exactly that. Listing only what SOLD means the empty rows never exist: three to six rows on a normal day, readable
in seconds. The question the owner actually asked — "what sold today, and did it produce a positive take" — is answerable at this
grain and is not answerable at the other one.

THE SALE IS THE DAY. THE VERDICT IS TRAILING. THIS IS THE WHOLE DESIGN.
Today's ad spend cannot answer "did this pay", for two independent reasons:
  1. It does not exist yet. The Google feed is a manual import and its newest day is normally a PART day (a report pulled at 14:38
     covers that day to 14:38), so a same-day spend column is empty or short — and short in the FLATTERING direction, because sales
     are live to the minute while cost is not. That is precisely the distortion routes/google-ads-styles.js anchors against.
  2. It would be the wrong denominator anyway. A sale today may have been caused by a click three days ago. Ad spend does not settle
     inside a day at this volume; pretending it does would invent a measurement.
So the day column is OURS and exact (units, revenue, profit, from `sales`, final the moment the order lands) and the verdict column
is a 30-day trailing window. That also makes the report ROBUST to a stale import in a way a same-day figure never could be: one
missing day moves a 30-day spend total by a few pence per style, where it would have moved a same-day one by all of it.

A 7-DAY SPEND COLUMN WAS BUILT AND CUT (owner, 2026-09-06). It put a THIRD time period on the row — profit today, spend over 7 days,
verdict over 30 — and two windows a row is the most that reads. It was also half a ratio: a spend figure with no profit beside it
cannot be judged, and at this volume the weekly number is frequently pennies (£0.56) which means nothing at all.

THE TRAILING WINDOW ENDS AT `asOf`, NOT AT THE CHOSEN DAY
`asOf` is the newest COMPLETE day of ad data — MAX(snapshot_date) among rows captured after that day had ended — the same definition
and the same SQL as routes/google-ads-styles.js, so the two screens can never disagree about what "the last 30 days" means. Both
halves of the verdict (profit30 AND spend30) end there, so the two sides always describe the same days. A window running to the
chosen day would set 30 days of sales against 28 or 29 of cost and read high by exactly the gap.

WHEN A PAST DAY IS PICKED, THE VERDICT MOVES WITH IT: the window ends at LEAST(chosen day, asOf). Looking at last Tuesday shows last
Tuesday's sales against the 30 days as they stood THEN, not against today's. Otherwise every historical day would be judged by a
window it could not have known about, which makes the report useless for looking back — which is the only reason the day picker is
there.

RETURNS ARE NOT LISTED (owner, 2026-09-06)
A return is a negative `qty` row landing on the day it came back (950 of them since Aug 2024), and a first cut listed them in a
second group below the sales. The owner cut that: this report is read to check GOOGLE's performance, and returns are already
carried in the profit figures — `utils/shopifyProfit.js` books a returns haircut against every sale, so the take on this screen is
net of them whether or not a refund is drawn.

So the day shows what SOLD: styles with `SUM(qty) > 0`. Listing refunds too would have doubled the length of a returns-heavy day
(24 Aug 2026: 21 styles, 12 of them returns) with rows that answer a different question. The one place returns still bite is
REVENUE, and that is handled in the `sold` CTE below — see the note there.

THE SIZES COLUMN IS THE ONE THAT MAKES THE SCREEN ACTIONABLE (owner, 2026-09-06)
A negative kept30 has three causes wanting three different actions, and two of them are OPPOSITE:
  1. An EMPTY SHELF — clicks that cannot convert, because the shopper's size is not there. Action: pause. Repricing does nothing.
  2. A THIN MARGIN — it converts fine and earns £3 a pair against a £5 click. Action: price UP.
  3. POOR CONVERSION ON A FULL SHELF — price, images or bid. Action: price down, or look at the listing.
Without a size count the screen cannot tell 1 from 2, and pausing a case-2 style hides something fixable while repricing a case-1
style achieves nothing at all. The evidence for the threshold lives on the Google Ads page (THIN_SIZES): over the 30 days to 5 Sep
2026 conversion nearly TRIPLES the moment a fifth size becomes buyable — 2.9-3.7% below the line against 10%+ above it — and 52% of
all spend sat below it returning -£604. It is a cliff between 4 and 5, not a slope, which is why the client's flag is an absolute
count and not a share of the run.

WHAT THIS SCREEN CANNOT SEE, AND MUST NOT BE THE ONLY PLACE ANYONE LOOKS
It lists what SOLD. A style burning £80 a month having sold NOTHING never appears on it, and that is the worst case there is. This
answers "did today's sellers actually pay for themselves"; the silent burners are the Google Ads LOSERS list's job.

WHAT THIS IS NOT: THE SALES REPORT (owner asked directly, 2026-09-06)
routes/analytics-sales.js already has a Today window that returns the day's line list, so the overlap is real and was checked rather
than argued about. It is shallow. Sales is ORDER-LINE grain, all channels, searchable, and feeds a CSV export — "how are we
trading?". This is STYLE grain, Shopify only, and carries one column Sales cannot: kept30, the trailing Google verdict. Everything
else here, Sales does better. The report earns its place on that column alone, which is exactly what was asked for.

The two RECONCILE, and must keep doing so — same channel filter, same revenue expression (see the sold CTE). Verified 2026-09-06 on
a day with no refunds: 3 units, £212.50, £42.04 on both. On a day WITH refunds they differ by precisely the refund-only styles this
report excludes and Sales includes, which is the documented difference above and not a disagreement about money.

It was named "Day Take" for half a day and renamed (owner). "Take" already means something specific in this product — "Ad take" on
the campaign panel is spend as a percentage of profit — and two meanings of one word in one product is how a number gets misread.
The name now says Google, and pairs with Ad Efficiency: same question, month/whole-book there and day/per-style here.

SHOPIFY ONLY, AND GOOGLE ONLY (owner, 2026-09-06)
`channel = 'SHP'`, spend from `google_product_daily` — identical to routes/google-ads-styles.js and routes/analytics-ad-efficiency.js
so all three report the same money. Google Shopping points at brookfieldcomfort.com, so Shopify is the revenue these ads can
plausibly have caused; putting Amazon on the same row as Google's spend would make the take flatter and mean nothing.

`profit` IS `sales.profit` — the NET per-unit figure, after payment fee, packing, postage and the returns haircut. NOT a gross
margin. Subtracting ad spend from a gross margin produces a number that looks like profit and is not.

THE SALES HALF NEEDS NO CHORE. `update_orders.py` is in cron five times a day, so the chosen day is current within a few hours with
nothing pressed. Only the trailing verdict touches the manually imported ad feed, and that tolerates being a day or two behind —
`adDaysOld` reports how far, so the screen never claims a day it has not measured.
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  day   optional, 'YYYY-MM-DD'. Defaults to today (Europe/London). Must not be in the future; must be 2020-01-01 or later.

Success Response:
{
  "return_code": "SUCCESS",
  "day": "2026-09-06",
  "dayLabel": "Sun 06 Sep 2026",
  "isToday": true,                       // the day is still running — its take is not final
  "verdictFrom": "2026-08-07",           // the trailing 30 days, both halves
  "verdictTo": "2026-09-05",             // = LEAST(day, asOf)
  "adDaysOld": 1,                        // day - verdictTo: how far behind the ad feed is. 0 = nothing missing
  "totals": { "styles": 3, "units": 3, "revenue": 214.00, "profit": 42.04 },
  "rows": [
    {
      "groupid": "0051701-ARIZONA",
      "title": "Birkenstock Arizona Two-Strap",
      "units": 1,                        // net units sold on the day (always > 0; refund-only styles are not listed)
      "revenue": 95.00,                  // signed — a same-day refund on this style is taken off
      "profit": 20.16,                   // the day's take on this style
      "spend30": 64.18,                  // trailing Google spend, [verdictFrom, verdictTo]
      "profit30": 169.00,                // trailing Shopify net profit, SAME days
      "kept30": 104.82,                  // profit30 - spend30. The verdict. Negative = not paying for itself
      "sizesListed": 9,                  // the full size run (skumap)
      "sizesInStock": 7,                 // how many of them are buyable TODAY — separates "pause it" from "reprice it"
      "nextReview": "2026-09-20"         // Pricing's review cooldown, or null. Surfaced, never enforced
    }
  ]
}
  - `rows` is ordered by the day's profit, biggest take first. `totals` is the sum of the listed rows.
  - A day with nothing sold returns an empty `rows` and zeroed `totals`, not an error.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"INVALID_DAY"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// The trailing verdict window. 30 days matches the working window on the Google Ads screen and Ad Efficiency's monthly grain, so
// "is it paying" means the same thing wherever it is asked. Not a query param: one team-wide definition, as with the
// WINNERS/LOSERS bars (CLAUDE.md).
const VERDICT_DAYS = 30;

// Nothing in this database predates this by enough to matter, and it stops a mistyped year turning into a 2000-year date sweep.
const EARLIEST_DAY = '2020-01-01';

const round2 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

router.get('/', async (req, res) => {
  try {
    // ---- The day ------------------------------------------------------------------------------------------------------------
    // Validated as text and handed to Postgres as text, cast there. Parsing it into a JS Date here would put a BST shift between
    // the operator's click and the query (CLAUDE.md: never let a pg DATE meet toISOString), and this whole report is one day wide,
    // so a one-day shift is the entire answer.
    const day = req.query.day;
    if (day !== undefined) {
      if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        return res.json({ return_code: 'INVALID_DAY', message: 'day must be a date in YYYY-MM-DD form' });
      }
      // Postgres is the calendar authority — it rejects 2026-02-30, which the regex above cannot. It does that by THROWING
      // ("date/time field value out of range"), not by returning false, so this needs its own catch: without one an impossible
      // date fell through to the outer handler and came back as SERVER_ERROR, blaming the server for the caller's typo.
      let chk;
      try {
        chk = await query(
          `SELECT ($1::date > CURRENT_DATE) AS future, ($1::date < DATE '${EARLIEST_DAY}') AS too_early`,
          [day]
        );
      } catch {
        return res.json({ return_code: 'INVALID_DAY', message: 'That is not a real date' });
      }
      if (chk.rows[0].future) {
        return res.json({ return_code: 'INVALID_DAY', message: 'That day has not happened yet' });
      }
      if (chk.rows[0].too_early) {
        return res.json({ return_code: 'INVALID_DAY', message: `day must be ${EARLIEST_DAY} or later` });
      }
    }

    // ---- The report ---------------------------------------------------------------------------------------------------------
    // One pass. `bounds` fixes the two dates every other CTE reads, so the day and the verdict window cannot drift apart between
    // clauses, and the client is told exactly which days it is being shown.
    const result = await query(`
      WITH bounds AS (
        SELECT
          d.day,
          -- The verdict window ends at the last day BOTH sides can speak for: the newest COMPLETE day of ad data, or the chosen
          -- day if that is earlier. "Complete" = we hold a row for it captured on a LATER calendar day, i.e. the day had ended
          -- before it was downloaded — the newest row in an import is normally a part day. Same test as google-ads-styles.
          -- LEAST ignores NULLs, so a table with no eligible ad day at all falls back to the chosen day and the report still shows
          -- what sold, with the spend column simply empty.
          LEAST(d.day, (
            SELECT MAX(snapshot_date) FROM google_product_daily
            WHERE (imported_at AT TIME ZONE 'Europe/London')::date > snapshot_date
          )) AS v_to
        FROM (SELECT COALESCE($1::date, CURRENT_DATE) AS day) d
      ),
      win AS (
        -- Expressed once, here, so both halves of the verdict below are guaranteed to cover the same ${VERDICT_DAYS} days.
        -- BETWEEN v_from AND v_to is inclusive on both sides: exactly ${VERDICT_DAYS} dates, not ${VERDICT_DAYS + 1}.
        SELECT day, v_to, v_to - ${VERDICT_DAYS - 1} AS v_from FROM bounds
      ),
      sold AS (
        -- What SOLD on the day, netted by style. Over the sales table only — this half is exact and must not inherit the other
        -- half's staleness.
        --
        -- HAVING SUM(qty) > 0 IS THE "what sold" RULE. Refund-only styles drop out entirely (see the header); a style that sold
        -- twice and had one come back still nets +1 and stays, which is correct — it did sell today.
        --
        -- REVENUE IS SUM(soldprice * qty), MATCHING routes/analytics-sales.js EXACTLY, and both factors matter:
        --   * soldprice is stored POSITIVE on a return row (qty carries the sign), so a plain SUM(soldprice) ADDS refunds to
        --     takings. Over the last 365 Shopify days that is £287,190 against a true £221,717 — a 30% overstatement.
        --   * soldprice is a PER-UNIT price, not a line total. Proof in the data: 0128201-GIZEH-44 has a qty-1 line and a qty-2
        --     line on the SAME day (2026-07-03) carrying the identical soldprice of 36.10.
        -- Sales is the authoritative ledger, so this report must reconcile with it to the penny on any given day — that is the
        -- whole reason to copy its expression rather than write a better one.
        --
        -- profit is ALSO per-unit and is summed raw here, which under-counts a multi-unit line — again matching analytics-sales.
        -- Deliberate: the two screens agreeing matters more than £160 spread over the 37 multi-unit lines in the table's whole
        -- history (£61 across the last year). If it is ever fixed it must be fixed in BOTH, as SUM(profit * ABS(qty)) — ABS, not
        -- qty, because a return already carries its sign in profit and multiplying would flip a refund into a gain.
        SELECT s.groupid,
               SUM(s.qty)              AS units,
               SUM(s.soldprice * s.qty) AS revenue,
               SUM(s.profit)           AS profit
        FROM sales s CROSS JOIN win w
        WHERE s.channel = 'SHP' AND s.solddate = w.day
        GROUP BY s.groupid
        HAVING SUM(s.qty) > 0
      ),
      trailing_profit AS (
        -- Restricted to the styles on the day, so this scans a handful of groupids rather than the whole book.
        SELECT s.groupid, SUM(s.profit) AS profit30
        FROM sales s CROSS JOIN win w
        WHERE s.channel = 'SHP'
          AND s.solddate BETWEEN w.v_from AND w.v_to
          AND s.groupid IN (SELECT groupid FROM sold)
        GROUP BY s.groupid
      ),
      sizes AS (
        -- HOW MUCH OF THE SIZE RUN IS BUYABLE TODAY. Ported from routes/google-ads-styles.js, where it was added on 2026-09-06
        -- because a screen could say a style was losing money but not WHY — and the commonest cause is not advertising badly, it
        -- is advertising an empty shelf. It is the column that separates the two opposite actions this report can prompt: a thin
        -- shelf wants PAUSING (repricing it changes nothing, the shopper's size simply is not there), a deep shelf that still
        -- loses money wants REPRICING. Identical on every other column; opposite decisions.
        --
        -- TODAY'S shelf, deliberately, not the chosen day's — stock history is not kept, and the question the cell answers is
        -- "can a shopper buy this now", which is a fact about now. On a back-dated day it is therefore the one cell that does not
        -- describe that day; the client says so.
        --
        -- skumap is the full run (one row per variant); localstock holds in-stock rows only, so the LEFT JOIN is what makes an
        -- unstocked size count as listed-but-empty rather than vanish. Size is the code's last dash-segment, as in inv-styles.
        SELECT m.groupid,
               COUNT(*)                                      AS listed,
               COUNT(*) FILTER (WHERE COALESCE(ls.q, 0) > 0) AS in_stock
        FROM (SELECT groupid, substring(code from '[^-]+$') AS sz FROM skumap GROUP BY groupid, substring(code from '[^-]+$')) m
        LEFT JOIN (
          SELECT groupid, substring(code from '[^-]+$') AS sz, SUM(qty) AS q
          FROM localstock
          WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
          GROUP BY groupid, substring(code from '[^-]+$')
        ) ls ON ls.groupid = m.groupid AND ls.sz = m.sz
        WHERE m.groupid IN (SELECT groupid FROM sold)
        GROUP BY m.groupid
      ),
      trailing_spend AS (
        SELECT g.groupid, SUM(g.cost) AS spend30
        FROM google_product_daily g CROSS JOIN win w
        WHERE g.snapshot_date BETWEEN w.v_from AND w.v_to
          AND g.groupid IN (SELECT groupid FROM sold)
        GROUP BY g.groupid
      )
      SELECT
        to_char(w.day, 'YYYY-MM-DD')     AS day,
        to_char(w.day, 'Dy DD Mon YYYY') AS day_label,
        (w.day = CURRENT_DATE)           AS is_today,
        to_char(w.v_from, 'YYYY-MM-DD')  AS verdict_from,
        to_char(w.v_to, 'YYYY-MM-DD')    AS verdict_to,
        (w.day - w.v_to)                 AS ad_days_old,
        sold.groupid,
        -- title.shopifytitle is the human name; skusummary.colour is an overloaded segmentation tag and is not one (CLAUDE.md).
        COALESCE(t.shopifytitle, '')     AS title,
        sold.units,
        sold.revenue,
        sold.profit,
        COALESCE(tp.profit30, 0)         AS profit30,
        COALESCE(ts.spend30, 0)          AS spend30,
        COALESCE(sz.listed, 0)           AS sizes_listed,
        COALESCE(sz.in_stock, 0)         AS sizes_in_stock,
        -- Cast to TEXT in SQL. A pg DATE arriving in Node becomes local midnight and toISOString() then shifts it a day back under
        -- BST (CLAUDE.md) — on a cooldown date that is the difference between "parked until tomorrow" and "free today".
        to_char(ss.next_shopify_price_review, 'YYYY-MM-DD') AS next_review
      FROM win w
      LEFT JOIN sold ON TRUE
      LEFT JOIN trailing_profit tp ON tp.groupid = sold.groupid
      LEFT JOIN trailing_spend  ts ON ts.groupid = sold.groupid
      LEFT JOIN sizes sz          ON sz.groupid = sold.groupid
      LEFT JOIN skusummary ss     ON ss.groupid = sold.groupid
      LEFT JOIN title t           ON t.groupid  = sold.groupid
      ORDER BY sold.profit DESC NULLS LAST
    `, [day === undefined ? null : day]);

    // `win` is a single row and the join to `sold` is LEFT, so a day with no sales still returns exactly one row — with a NULL
    // groupid. That is how the dates reach the client on an empty day; it is not a data row and is dropped here.
    const head = result.rows[0];
    const dataRows = result.rows.filter((r) => r.groupid !== null);

    const rows = dataRows.map((r) => {
      const profit30 = round2(r.profit30) ?? 0;
      const spend30 = round2(r.spend30) ?? 0;
      return {
        groupid: r.groupid,
        title: r.title,
        units: Number(r.units),
        revenue: round2(r.revenue) ?? 0,
        profit: round2(r.profit) ?? 0,
        profit30,
        spend30,
        kept30: round2(profit30 - spend30),
        sizesListed: Number(r.sizes_listed),
        sizesInStock: Number(r.sizes_in_stock),
        // The Pricing module's review cooldown. Surfaced, NOT enforced: this report answers "what sold and did it pay", which is a
        // different question from the triage list's "what needs a decision", so a parked style still belongs here. But an operator
        // who follows the link through to the price setter would otherwise silently re-price something a colleague parked
        // yesterday, so the row has to say so. Null when the style has never been parked or the date has passed into the past.
        nextReview: r.next_review,
      };
    });

    // Already ordered by the day's profit, biggest take first — the SQL does it, and with refunds excluded there is nothing left
    // to partition out.
    const totals = rows.reduce((acc, r) => ({
      styles: acc.styles + 1,
      units: acc.units + r.units,
      revenue: round2(acc.revenue + r.revenue),
      profit: round2(acc.profit + r.profit),
    }), { styles: 0, units: 0, revenue: 0, profit: 0 });

    return res.json({
      return_code: 'SUCCESS',
      day: head.day,
      dayLabel: head.day_label,
      isToday: head.is_today,
      verdictFrom: head.verdict_from,
      verdictTo: head.verdict_to,
      adDaysOld: Number(head.ad_days_old),
      totals,
      rows,
    });
  } catch (err) {
    logger.error('[analytics-ad-payback] failed:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the day' });
  }
});

module.exports = router;
