/*
=======================================================================================================================================
Module: utils/noSupply.js  —  THE copy of "Can't get it"
=======================================================================================================================================
Purpose: "CAN'T GET IT" — the supplier has none of a SIZE, so it is hidden from the ORDER SCREENS until a re-check day, then comes back
         on its own (owner, 2026-09-26). For ordering this is THE availability test — season no longer is ("for ordering, I should use
         Can't get / Release as the de facto").

         ON SCREEN THE PAIR IS "CAN'T GET" / "RELEASE" — never park/unpark: "parked" already means a style's pricing review date on
         Repricing, and one word for two things on the same style is the confusion to avoid. (In this code "park" survives only as an
         internal verb for setting the mark.)

ONE SYSTEM, PER SIZE (owner, 2026-11-13). Stored ONLY in no_supply_size — one row per size (code): since / until / marked_by
         (migrations/20261113b_no_supply_size.sql). Until 2026-11-13 the mark was a STYLE flag on skusummary.no_supply_*; the owner
         pressed Can't get on a size on Amazon Order and "really meant we can't get that size". A short-lived two-mark version (style
         flag + size rows side by side, with a priority rule) was replaced the same day by this one: "single system". The 37 style marks
         then live were copied to one row per size (migrations/20261113c_no_supply_to_sizes.sql) and the skusummary columns dropped
         (20261113d).

         "WHOLE STYLE" IS A SHORTCUT, NOT A SECOND MARK: Shopify Order's style view and Back Office → Seasons mark a style by writing a
         row for EVERY live size of it (markStyles), and Release a style by deleting every row of it (clearStyles). A style READS as
         "can't get" (whole) when every one of its live sizes has a live mark — noSupplyStyleSql; partly marked shows "N of M sizes".
         Known and accepted: a size added to a style after it was marked whole isn't covered (a new code normally means it's being
         bought, so it can be got).

         NOT A CHANNEL FACT: one supplier, so a marked size is off BOTH order screens. Nothing here, in its routes or in its wording names
         a channel. Amazon Order (2026-09-27) hides a marked size only when it has no local stock too — it can still be PICKED to FBA
         from our own shelf ("we can get them because we have them") — and its rate fill leaves such a row's Order half empty while
         still filling the Pick.

         Defined once here and read by:
           routes/amazon-order-list.js     per size (noSupplySelectSql)                — Amazon Order marks / releases sizes
           routes/shopify-sellers-list.js  per size                                    — Shopify Order's Sellers view
           routes/shopify-order-list.js    per size + per style (noSupplyStyleSql)     — the style view marks / releases whole styles
           routes/product-seasons.js       per style                                   — Back Office → Seasons, Can't get view + bulk
           utils/sizeGaps.js               leaves out styles marked whole (noSupplyWholeStyleSql)
           routes/no-supply-set.js / no-supply-clear.js   the writes (markSizes / markStyles / clearSizes / clearStyles)

THE PARK IS ALWAYS NO_SUPPLY_MONTHS (3), FROM TODAY (owner, 2026-09-26). Chosen over the alternatives on how they fail:
  - 1 month  — "too frequent": on a list of 30+ winners something comes back to re-check every week.
  - next season changeover (1 Apr / 1 Sep) — up to six months, and "risky if back in early": a supplier restocking in November
    would go unseen until April. Mostly redundant too — where it would matter (a Summer style in August) the in-season filter
    already hides it, and for 'Any' styles, which most winners are, "next season" means nothing.
  - 3 months — the asymmetry decides it: parked too short costs one "Still can't" click, parked too long costs a winner's sales.
There is no "forever": everything lapses, so nothing is lost and nothing has to be remembered and switched back. A supplier who comes
back early is handled by releasing it. A LAPSED row is kept so the size (or style) comes back saying "Couldn't get it — <date>"; Release,
the X on that note, or an order landing for the size deletes it. Lapsed rows are purged NO_SUPPLY_KEEP_MONTHS after they lapse, by the
mark write itself (no cron, no table that grows for ever).

NOTHING ELSE CHANGES when it is set: not the season, not the status, not the Repricing lists on either channel. "I can't buy any more,
but I can price what I do have."
=======================================================================================================================================
*/

const { LONDON_TODAY_SQL } = require('./sql');
const { writeBcLog } = require('./bclog');

const NO_SUPPLY_MONTHS = 3;

// Lapsed rows older than this (past their until) are purged whenever something is marked.
const NO_SUPPLY_KEEP_MONTHS = 6;

// The re-check day a park set today gets, as SQL (London date).
const NO_SUPPLY_UNTIL_SQL = `(${LONDON_TODAY_SQL} + INTERVAL '${Number(NO_SUPPLY_MONTHS)} months')::date`;

// ---- READS ---------------------------------------------------------------------------------------------------------------------------

// A size's marks, joined on a code expression — pair with noSupplySelectSql(alias).
function noSupplyJoinSql(codeExpr, alias = 'nss') {
  return `LEFT JOIN no_supply_size ${alias} ON ${alias}.code = ${codeExpr}`;
}

// Per SIZE: marked now (re-check day still ahead, London date) plus the stored row, dates as TEXT (CLAUDE.md: never hand a pg DATE to
// toISOString — the BST day-shift). since/by outlive the park, so a returning size can say why it was away.
function noSupplySelectSql(alias = 'nss') {
  return `COALESCE(${alias}.until > ${LONDON_TODAY_SQL}, false) AS no_supply,
             ${alias}.since::text AS no_supply_since,
             ${alias}.until::text AS no_supply_until,
             ${alias}.marked_by AS no_supply_by`;
}

// Row -> the size's JSON fields, identically everywhere.
function noSupplyFields(r) {
  return {
    no_supply: r.no_supply === true,
    no_supply_since: r.no_supply_since || null,
    no_supply_until: r.no_supply_until || null,
    no_supply_by: r.no_supply_by || null,
  };
}

// Per STYLE, as a CTE named `name` (one row per style that has any mark, live or lapsed — LEFT JOIN it on groupid):
//   sizes         the style's live sizes (skumap, not deleted)
//   marked_sizes  how many of them are marked now
//   since/until/by the mark that speaks for the style — the newest LIVE mark; with none live, the newest lapsed one (the note)
// "Whole" = sizes > 0 AND marked_sizes = sizes (noSupplyStyleSelectSql). Lapsed rows on deleted codes are ignored.
function noSupplyStyleCte(name = 'nsst') {
  return `${name} AS (
        SELECT m.groupid,
               COUNT(*)::int AS sizes,
               (COUNT(n.code) FILTER (WHERE n.until > ${LONDON_TODAY_SQL}))::int AS marked_sizes,
               (array_agg(n.since    ORDER BY (n.until > ${LONDON_TODAY_SQL}) DESC, n.since DESC, n.code) FILTER (WHERE n.code IS NOT NULL))[1] AS since,
               (array_agg(n.until    ORDER BY (n.until > ${LONDON_TODAY_SQL}) DESC, n.until DESC, n.code) FILTER (WHERE n.code IS NOT NULL))[1] AS until,
               (array_agg(n.marked_by ORDER BY (n.until > ${LONDON_TODAY_SQL}) DESC, n.since DESC, n.code) FILTER (WHERE n.code IS NOT NULL))[1] AS marked_by
          FROM skumap m
          LEFT JOIN no_supply_size n ON n.code = m.code
         WHERE COALESCE(m.deleted,0) = 0
           AND m.groupid IN (SELECT groupid FROM no_supply_size)
         GROUP BY m.groupid
      )`;
}

// The style's select-list fragment from that CTE (aliased `alias`): whole-style marked now, how many sizes, and the speaking mark.
function noSupplyStyleSelectSql(alias = 'nsst') {
  return `COALESCE(${alias}.sizes > 0 AND ${alias}.marked_sizes = ${alias}.sizes, false) AS no_supply,
             COALESCE(${alias}.marked_sizes, 0) AS no_supply_sizes,
             ${alias}.since::text AS no_supply_since,
             ${alias}.until::text AS no_supply_until,
             ${alias}.marked_by AS no_supply_by`;
}

// Row -> the style's JSON fields: no_supply = every live size marked (the old "whole style" meaning); no_supply_sizes = how many are.
function noSupplyStyleFields(r) {
  return { ...noSupplyFields(r), no_supply_sizes: Number(r.no_supply_sizes) || 0 };
}

// "This style is marked whole right now" as a predicate on a groupid expression — every live size has a live mark (and it has some).
function noSupplyWholeStyleSql(groupidExpr) {
  return `(EXISTS (SELECT 1 FROM no_supply_size w WHERE w.groupid = ${groupidExpr} AND w.until > ${LONDON_TODAY_SQL})
          AND NOT EXISTS (SELECT 1 FROM skumap wm
                            LEFT JOIN no_supply_size wn ON wn.code = wm.code AND wn.until > ${LONDON_TODAY_SQL}
                           WHERE wm.groupid = ${groupidExpr} AND COALESCE(wm.deleted,0) = 0 AND wn.code IS NULL))`;
}

// ---- WRITES (inside the caller's transaction) -----------------------------------------------------------------------------------------

// Purge rows that lapsed more than NO_SUPPLY_KEEP_MONTHS ago — run on every mark.
async function purgeLapsed(client) {
  await client.query(`DELETE FROM no_supply_size WHERE until < ${LONDON_TODAY_SQL} - INTERVAL '${Number(NO_SUPPLY_KEEP_MONTHS)} months'`);
}

// Mark sizes: one row per LIVE skumap code; a re-mark restarts its three months. `where` picks the skumap rows. Returns the rows marked.
async function markWhere(client, where, params, who) {
  await purgeLapsed(client);
  const ins = await client.query(`
    INSERT INTO no_supply_size (code, groupid, since, until, marked_by)
    SELECT m.code, m.groupid, ${LONDON_TODAY_SQL}, ${NO_SUPPLY_UNTIL_SQL}, $1
      FROM skumap m
     WHERE ${where} AND COALESCE(m.deleted,0) = 0
    ON CONFLICT (code) DO UPDATE SET since = EXCLUDED.since, until = EXCLUDED.until, marked_by = EXCLUDED.marked_by, created_at = now()
    RETURNING code, groupid, since::text AS since, until::text AS until
  `, [who, ...params]);
  return ins.rows;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Single sizes (Amazon Order, "Still can't" on a size). Logs the codes.
async function markSizes(client, codes, who) {
  const rows = await markWhere(client, 'm.code = ANY($2::text[])', [codes], who);
  if (rows.length > 0) {
    await writeBcLog(client, { who, section: "Can't get", log: `${plural(rows.length, 'size')} until ${rows[0].until}: ${rows.map((r) => r.code).join(', ')}` });
  }
  return rows;
}

// Whole styles — every live size of each (Shopify Order's style view, Seasons). Logs the styles.
async function markStyles(client, groupids, who) {
  const rows = await markWhere(client, 'm.groupid = ANY($2::text[])', [groupids], who);
  const styles = [...new Set(rows.map((r) => r.groupid))];
  if (styles.length > 0) {
    await writeBcLog(client, { who, section: "Can't get", log: `${plural(styles.length, 'style')} (${plural(rows.length, 'size')}) until ${rows[0].until}: ${styles.join(', ')}` });
  }
  return rows;
}

// Release sizes / whole styles: delete their rows, live or lapsed. Returns what carried a mark (codes / groupids).
async function clearSizes(client, codes, who) {
  if (codes.length === 0) return [];
  const del = await client.query('DELETE FROM no_supply_size WHERE code = ANY($1::text[]) RETURNING code', [codes]);
  const done = del.rows.map((r) => r.code);
  if (done.length > 0) await writeBcLog(client, { who, section: "Can't get", log: `released ${plural(done.length, 'size')}: ${done.join(', ')}` });
  return done;
}
async function clearStyles(client, groupids, who) {
  if (groupids.length === 0) return [];
  const del = await client.query('DELETE FROM no_supply_size WHERE groupid = ANY($1::text[]) RETURNING groupid', [groupids]);
  const done = [...new Set(del.rows.map((r) => r.groupid))];
  if (done.length > 0) await writeBcLog(client, { who, section: "Can't get", log: `released ${plural(done.length, 'style')} (${plural(del.rows.length, 'size')}): ${done.join(', ')}` });
  return done;
}

module.exports = {
  NO_SUPPLY_MONTHS, NO_SUPPLY_KEEP_MONTHS, NO_SUPPLY_UNTIL_SQL,
  noSupplyJoinSql, noSupplySelectSql, noSupplyFields,
  noSupplyStyleCte, noSupplyStyleSelectSql, noSupplyStyleFields, noSupplyWholeStyleSql,
  markSizes, markStyles, clearSizes, clearStyles,
};
