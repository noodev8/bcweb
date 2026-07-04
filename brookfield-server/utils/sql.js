/*
=======================================================================================================================================
Module: utils/sql.js
=======================================================================================================================================
Purpose: Shared SQL fragment builders for the legacy schema's landmines.

safeNumeric(colExpr): safely cast a legacy VARCHAR price column to numeric.
  The price columns on skusummary (shopifyprice/cost/rrp/minshopifyprice/maxshopifyprice) are `character varying` and can hold not
  just '' but arbitrary junk — real example: rrp = the literal text 'RRP'. A plain NULLIF(col,'')::numeric only guards '' and THROWS
  on any other non-numeric value ("invalid input syntax for type numeric"). This returns NULL unless the trimmed value looks like a
  number, so a bad row degrades to "unknown" instead of 500-ing the whole request.

SECURITY: colExpr is interpolated into SQL, so ONLY ever pass hard-coded column expressions (e.g. 'ss.cost') — NEVER user input.
=======================================================================================================================================
*/

// Matches an optional sign, digits, and an optional decimal part. '' and 'RRP' etc. don't match -> NULL.
function safeNumeric(colExpr) {
  return `CASE WHEN btrim(${colExpr}::text) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN btrim(${colExpr}::text)::numeric ELSE NULL END`;
}

module.exports = { safeNumeric };
