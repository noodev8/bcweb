/*
=======================================================================================================================================
Module: utils/birkOrder.js
=======================================================================================================================================
Purpose: Read a Birkenstock order export (.xlsx off their B2B portal) and work out what it means for the order book (`birktracker`) —
         the parse and planning halves of Birk Tracker's "Load order". No writes live here; routes/birk-order-commit.js does those.

THIS PORTS THE LEGACY POWERBUILDER "BULK UPLOAD" on the Birk Tracker window (it read orders.csv from the download area into the grid,
and the grid's Save inserted the rows). Its transforms are kept, and where the file or the rule HAD to change it says so below:

  ordernum   `Sales Receipt`, left-padded to 10 digits.                                            (legacy: same)
  code       <article>-<STYLE>-<EU size>, e.g. 0943871-GIZEH-38.                                   (legacy: same shape)
    article  `Material product ID` as 7 digits. ⚠ CHANGED: the portal now sends 18 ("000000000000943871"); the legacy padded a short
             id UP to 7 and had no case for a long one. Leading zeros are stripped, then padded back to 7 — which is what every code in
             the book and in skumap looks like.
    STYLE    the model keyword found in `Material name` ("Arizona Big Buckle Birko-Flor Women" -> ARIZONA). ⚠ CHANGED, see STYLE.
  placedate  `Created on` as dd/MM/yyyy.                                                            (legacy: same, the book's format)
  requested  `Confirmed Quantity`; lines confirming < 1 are dropped. NOT `Requested Quantity` — what Birkenstock agreed to send is the
             order; what we asked for and they denied is not coming, and counting it would leave the line "awaiting" forever.
  cost/rrp   `Wholesale Price` / `Recommended Retail Price` as 2dp strings ('37.50'). The columns are varchar (CLAUDE.md).
  bksize     EU size -> Birkenstock's mm/UK label ("38" -> "245/5") from the legacy table. The invoice matcher finds rows on this,
             so a line without one could never be invoiced against — hence it is flagged, not silently blank.
  due        month of `Projected Date` as JAN..DEC.                                                 (legacy: month out of reqdate)
  ean        `EAN`, as sent. The scanner books arrivals on it.

STYLE — WHY SKUMAP COMES BEFORE THE KEYWORD LIST. The legacy took the style only from its keyword list, and when a model was not on it
(Kyoto, Siena, Tokio…) the WHOLE material name went into the code. A code that matches nothing in skumap is worse than useless in this
book: scanning, stock and Add/Modify all key on the skumap code. So for each article, in order:
  1. skumap already has codes for this article  -> use that style (the keyword one if it is among them). Source 'skumap'.
  2. the book already has rows for it           -> use that style.                                      Source 'book'.
  3. the keyword list matches                   -> the legacy answer.                                   Source 'rule'.
  4. nothing                                    -> first word of the material name, uppercased.        Source 'guess'.
Sources 3 and 4 mean the style is new to the system; the review screen lets the operator correct it before anything is written.
=======================================================================================================================================
*/

const { readFirstSheet, excelSerialToParts } = require('./xlsxRead');
const { paddedOrder } = require('./birkInvoice');

// The portal's own column headings. Matched case- and space-insensitively, by NAME rather than position, so an extra or reordered
// column in a future export does not silently shift every value one to the left.
const COLUMNS = {
  ordernum: 'Sales Receipt',
  created: 'Created on',
  cost: 'Wholesale Price',
  rrp: 'Recommended Retail Price',
  currency: 'Currency',
  material: 'Material name',
  productId: 'Material product ID',
  projected: 'Projected Date',
  colour: 'Color',
  size: 'Size',
  width: 'Width',
  ean: 'EAN',
  confirmed: 'Confirmed Quantity',
};
// Everything above except these must be present for the file to be read at all.
const OPTIONAL = new Set(['currency', 'colour', 'width']);

// The legacy keyword list, in the legacy's order. It tested every keyword and the LAST hit won, so the list is walked backwards and
// the first hit taken — same answer. NEW YORK is matched with its space removed, which is what the legacy's "NEWYORK" test needed and
// never got from a name spelt "New York".
const STYLE_KEYWORDS = ['ARIZONA', 'BEND', 'FLORIDA', 'GIZEH', 'MAYARI', 'MADRID', 'MILANO', 'BOSTON', 'ZERMATT', 'BARBADOS', 'NEWYORK'];

// EU size -> Birkenstock's mm/UK label. The legacy table verbatim (a superset of the invoice parser's EU_SIZE, which only holds the
// sizes seen on invoices so far).
const BK_SIZE = {
  24: '150/7', 25: '160/8', 26: '165/8.5', 27: '170/9', 28: '180/10', 29: '185/11', 30: '190/11.5', 31: '200/13', 32: '205/13.5',
  33: '210/1', 34: '220/2', 35: '225/2.5', 36: '230/3.5', 37: '240/4.5', 38: '245/5', 39: '250/5.5', 40: '260/7', 41: '265/7.5',
  42: '270/8', 43: '280/9', 44: '285/9.5', 45: '290/10.5', 46: '300/11.5', 47: '305/12', 48: '310/13',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const text = (v) => (v == null ? '' : String(v).trim());
const pad2 = (n) => String(n).padStart(2, '0');

// A date cell as { y, m, d }. The portal writes a real Excel date (a serial number); a file re-saved by hand can carry text instead,
// so the two text shapes the business uses are accepted too. Day-first, always — this is a UK/German file.
function dateParts(v) {
  if (typeof v === 'number') return excelSerialToParts(v);
  const s = text(v);
  let m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(s);
  if (m) return { y: Number(m[3]), m: Number(m[2]), d: Number(m[1]) };
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return null;
}

function money(v) {
  const n = typeof v === 'number' ? v : Number(text(v).replace(',', '.'));
  return text(v) !== '' && Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
}

function article(productId) {
  const digits = text(productId).replace(/\D/g, '').replace(/^0+/, '');
  return digits ? digits.padStart(7, '0') : '';
}

function keywordStyle(material) {
  const squashed = text(material).toUpperCase().replace(/\s+/g, '');
  for (let i = STYLE_KEYWORDS.length - 1; i >= 0; i -= 1) {
    if (squashed.includes(STYLE_KEYWORDS[i])) return STYLE_KEYWORDS[i];
  }
  return null;
}

// The style portion of a code: "ARIZONA" out of "0051751-ARIZONA-35". A style may itself contain hyphens, hence the join.
function styleOf(code) {
  const parts = String(code).split('-');
  return parts.length >= 3 ? parts.slice(1, -1).join('-') : null;
}

/*
 * parseOrderFile(buffer) -> { lines[], skipped_unconfirmed, missing_columns[] }
 * lines[] = { ordernum, article, material, colour, width, size, bksize, placedate, due, requested, cost, rrp, currency, ean }
 * Throws only when the buffer is not a readable .xlsx; a readable file with the wrong headings comes back with missing_columns.
 */
function parseOrderFile(buffer) {
  const rows = readFirstSheet(buffer);
  // The header is the first row (of the first ten) carrying the order-number heading — a hand-edited file sometimes gains a title
  // row or a blank above it. When none does, row one is reported against, so the error names the columns it could not find.
  const found = rows.slice(0, 10).findIndex((r) => r.some((v) => norm(v) === norm(COLUMNS.ordernum)));
  const headerAt = found >= 0 ? found : rows.findIndex((r) => r.some((v) => text(v) !== ''));
  const header = headerAt >= 0 ? rows[headerAt].map(norm) : [];

  const col = {};
  const missingColumns = [];
  for (const [key, label] of Object.entries(COLUMNS)) {
    const i = header.indexOf(norm(label));
    if (i >= 0) col[key] = i;
    else if (!OPTIONAL.has(key)) missingColumns.push(label);
  }
  if (missingColumns.length) return { lines: [], skipped_unconfirmed: 0, missing_columns: missingColumns };

  const lines = [];
  let skippedUnconfirmed = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const get = (key) => (col[key] === undefined ? null : r[col[key]]);
    const ordernumRaw = text(get('ordernum')).replace(/\D/g, '');
    const art = article(get('productId'));
    if (!ordernumRaw && !art) continue; // a blank or trailing row

    const confirmed = Number(get('confirmed'));
    if (!Number.isInteger(confirmed) || confirmed < 1) {
      skippedUnconfirmed += 1;
      continue;
    }

    const size = text(get('size'));
    const created = dateParts(get('created'));
    const projected = dateParts(get('projected'));
    lines.push({
      ordernum: ordernumRaw ? paddedOrder(ordernumRaw) : '',
      article: art,
      material: text(get('material')),
      colour: text(get('colour')),
      width: text(get('width')),
      size,
      bksize: BK_SIZE[size] || '',
      placedate: created ? `${pad2(created.d)}/${pad2(created.m)}/${created.y}` : '',
      due: projected ? MONTHS[projected.m - 1] || '' : '',
      requested: confirmed,
      cost: money(get('cost')),
      rrp: money(get('rrp')),
      currency: text(get('currency')),
      ean: text(get('ean')),
    });
  }
  return { lines, skipped_unconfirmed: skippedUnconfirmed, missing_columns: [] };
}

// The order fields a re-upload may restate on a row already in the book. invoiced/arrived/invoice stamps are deliberately absent:
// they are what happened AFTER the order, and a new copy of the confirmation must never rewind them.
const ORDER_FIELDS = ['placedate', 'bksize', 'requested', 'cost', 'rrp', 'due', 'ean'];

/*
 * buildOrderPlan(db, parsed) -> { styles[], not_in_file[] }
 * READ ONLY. Three queries regardless of file size (no N+1): skumap codes for the file's articles, book rows for those articles (for
 * the style), and book rows for the file's orders (for new/changed/same). They run in parallel, so `db` must be the POOL — a single
 * checked-out client cannot run concurrent queries.
 *
 * styles[] — one per (order, article), sizes in size order:
 *   { ordernum, article, material, colour, width, style, style_source, cost, rrp, currency, due, placedate,
 *     lines: [{ code, size, bksize, requested, cost, rrp, due, placedate, ean, in_skumap,
 *               kind: 'new' | 'changed' | 'same', existing?: { ...ORDER_FIELDS, invoiced, arrived } }] }
 * not_in_file[] — rows the book holds for these orders that the file does not mention. Reported only; nothing deletes them.
 */
async function buildOrderPlan(db, parsed) {
  const { lines } = parsed;
  const articles = [...new Set(lines.map((l) => l.article).filter(Boolean))];
  const orders = [...new Set(lines.map((l) => l.ordernum).filter(Boolean))];

  const [skuRes, bookStyleRes, bookRes] = await Promise.all([
    db.query(`SELECT code FROM skumap WHERE split_part(code, '-', 1) = ANY($1)`, [articles]),
    db.query(`SELECT code FROM birktracker WHERE split_part(code, '-', 1) = ANY($1)`, [articles]),
    db.query(
      `SELECT code, ordernum, placedate, bksize, requested, cost, rrp, due, ean, invoiced, arrived
         FROM birktracker WHERE ordernum = ANY($1)`,
      [orders]
    ),
  ]);

  const skuCodes = new Set(skuRes.rows.map((r) => r.code));
  // article -> Map(style -> occurrences), per source. The most common style wins when an article has drifted across two spellings.
  const tally = (rows) => {
    const out = new Map();
    for (const { code } of rows) {
      const style = styleOf(code);
      if (!style) continue;
      const art = code.split('-')[0];
      if (!out.has(art)) out.set(art, new Map());
      out.get(art).set(style, (out.get(art).get(style) || 0) + 1);
    }
    return out;
  };
  const skuStyles = tally(skuRes.rows);
  const bookStyles = tally(bookStyleRes.rows);

  function resolveStyle(art, material) {
    const keyword = keywordStyle(material);
    for (const [source, map] of [['skumap', skuStyles], ['book', bookStyles]]) {
      const styles = map.get(art);
      if (!styles || styles.size === 0) continue;
      if (keyword && styles.has(keyword)) return { style: keyword, source };
      return { style: [...styles.entries()].sort((a, b) => b[1] - a[1])[0][0], source };
    }
    if (keyword) return { style: keyword, source: 'rule' };
    const first = (text(material).split(/\s+/)[0] || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'UNKNOWN';
    return { style: first, source: 'guess' };
  }

  const book = new Map(bookRes.rows.map((r) => [`${r.ordernum}|${r.code}`, r]));
  const seen = new Set();
  const groups = new Map();

  for (const l of lines) {
    const gkey = `${l.ordernum}|${l.article}`;
    if (!groups.has(gkey)) {
      const { style, source } = resolveStyle(l.article, l.material);
      groups.set(gkey, {
        ordernum: l.ordernum, article: l.article, material: l.material, colour: l.colour, width: l.width,
        style, style_source: source, cost: l.cost, rrp: l.rrp, currency: l.currency, due: l.due, placedate: l.placedate,
        lines: [],
      });
    }
    const g = groups.get(gkey);
    const code = `${l.article}-${g.style}-${l.size}`;

    // The same size twice in one file (a split confirmation line) is one row in the book — the unique key is (code, ordernum) — so
    // the quantities are summed rather than the second line failing the insert.
    const dup = g.lines.find((x) => x.size === l.size);
    if (dup) {
      dup.requested += l.requested;
      continue;
    }
    g.lines.push({
      code, size: l.size, bksize: l.bksize, requested: l.requested, cost: l.cost, rrp: l.rrp, due: l.due,
      placedate: l.placedate, ean: l.ean, in_skumap: skuCodes.has(code),
    });
  }

  // Prices are compared as numbers: the legacy screen and hand edits have left '37.5' next to '37.50', and that is not a change.
  const same = (f, a, b) => ((f === 'cost' || f === 'rrp') && Number.isFinite(Number(a)) && text(b) !== '' && Number.isFinite(Number(b))
    ? Number(a) === Number(b)
    : text(a) === text(b));
  for (const g of groups.values()) {
    g.lines.sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));
    for (const ln of g.lines) {
      const key = `${g.ordernum}|${ln.code}`;
      seen.add(key);
      const row = book.get(key);
      if (!row) {
        ln.kind = 'new';
        continue;
      }
      const existing = { invoiced: Number(row.invoiced) || 0, arrived: Number(row.arrived) || 0 };
      for (const f of ORDER_FIELDS) existing[f] = f === 'requested' ? (row.requested == null ? null : Number(row.requested)) : text(row[f]);
      ln.existing = existing;
      // A field the file leaves blank (a cost it could not read, say) is not a change — it would only blank a good value.
      const changed = ORDER_FIELDS.some((f) => ln[f] != null && ln[f] !== '' && !same(f, ln[f], existing[f]));
      ln.kind = changed ? 'changed' : 'same';
    }
  }

  const notInFile = bookRes.rows
    .filter((r) => !seen.has(`${r.ordernum}|${r.code}`))
    .map((r) => ({
      ordernum: r.ordernum, code: r.code, requested: r.requested == null ? null : Number(r.requested),
      invoiced: Number(r.invoiced) || 0, arrived: Number(r.arrived) || 0,
    }))
    .sort((a, b) => (a.ordernum + a.code).localeCompare(b.ordernum + b.code));

  return { styles: [...groups.values()], not_in_file: notInFile };
}

module.exports = { parseOrderFile, buildOrderPlan, ORDER_FIELDS, BK_SIZE };
