/*
=======================================================================================================================================
Module: utils/noSupply.js
=======================================================================================================================================
Purpose: "CAN'T GET IT" — the supplier has none of a style, so it is parked off the ORDER SCREENS until a re-check day, then comes
         back on its own (owner, 2026-09-26). Stored on skusummary.no_supply_since / _until / _by (migrations/20260926_no_supply.sql).

         A FACT ABOUT THE STYLE, NOT A CHANNEL: "if we can't get a style, we can't get it, regardless of where we're trying to sell it"
         (owner). Nothing here, in its routes or in its wording names a channel. Shopify Order reads it today; Amazon Order will read the
         same flag, unchanged, when it gets it.

         Defined once here and read by:
           routes/shopify-order-list.js    hides a parked style on Shopify Order (the first order screen to read it)
           routes/product-seasons.js       shows and manages them on Back Office → Seasons
           routes/no-supply-set.js         sets it (one style from an order screen, or a ticked batch from Seasons)
           routes/no-supply-clear.js       clears it

THE PARK IS ALWAYS NO_SUPPLY_MONTHS (3), FROM TODAY (owner, 2026-09-26). Chosen over the alternatives on how they fail:
  - 1 month  — "too frequent": on a list of 30+ winners something comes back to re-check every week.
  - next season changeover (1 Apr / 1 Sep) — up to six months, and "risky if back in early": a supplier restocking in November
    would go unseen until April. Mostly redundant too — where it would matter (a Summer style in August) the in-season filter
    already hides it, and for 'Any' styles, which most winners are, "next season" means nothing.
  - 3 months — the asymmetry decides it: parked too short costs one "Still can't" click, parked too long costs a winner's sales.
There is no "forever": everything lapses, so nothing is lost and nothing has to be remembered and switched back. A supplier who comes
back early is handled by unparking it (on the order screen, or on the Can't get view on Seasons).

NOTHING ELSE CHANGES when it is set: not the season (it decides WINNERS vs HARVEST and feeds the Seasons screen — the reason this
isn't done by re-seasoning), not the status, not the Repricing lists on either channel. "I can't buy any more, but I can price
what I do have."
=======================================================================================================================================
*/

const { LONDON_TODAY_SQL } = require('./sql');

const NO_SUPPLY_MONTHS = 3;

// The re-check day a park set today gets, as SQL (London date).
const NO_SUPPLY_UNTIL_SQL = `(${LONDON_TODAY_SQL} + INTERVAL '${Number(NO_SUPPLY_MONTHS)} months')::date`;

// "Parked right now" — the re-check day is still ahead (London date). `alias` is the skusummary alias; hard-coded by callers only.
function noSupplyNowSql(alias) {
  return `COALESCE(${alias}.no_supply_until > ${LONDON_TODAY_SQL}, false)`;
}

// The select-list fragment every reader ships: parked-now plus the three stored columns, dates as TEXT (CLAUDE.md: never hand a pg
// DATE to toISOString — the BST day-shift). since/by outlive the park, so a returning style can say why it was away.
function noSupplySelectSql(alias) {
  return `${noSupplyNowSql(alias)} AS no_supply,
             ${alias}.no_supply_since::text AS no_supply_since,
             ${alias}.no_supply_until::text AS no_supply_until,
             ${alias}.no_supply_by AS no_supply_by`;
}

// Row -> the four JSON fields, identically everywhere.
function noSupplyFields(r) {
  return {
    no_supply: r.no_supply === true,
    no_supply_since: r.no_supply_since || null,
    no_supply_until: r.no_supply_until || null,
    no_supply_by: r.no_supply_by || null,
  };
}

module.exports = { NO_SUPPLY_MONTHS, NO_SUPPLY_UNTIL_SQL, noSupplyNowSql, noSupplySelectSql, noSupplyFields };
