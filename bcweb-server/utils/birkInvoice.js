/*
=======================================================================================================================================
Module: utils/birkInvoice.js
=======================================================================================================================================
Purpose: Read a Birkenstock invoice PDF and work out what it means for the order book (`birktracker`) — the parse and the planning
         halves of the Birk Tracker "Load invoice" flow. No writes live here; routes/birk-invoice-commit.js does those.

THIS IS A PORT OF C:\projects\birk-tracker\birk-tracker.py, WHICH IS STILL THE LIVE TOOL. That script is proven against real invoices
and its regexes encode things about Birkenstock's layout that are not obvious and were presumably learned the hard way. So the rules
below are kept deliberately identical to it, line for line, and where something HAD to change it is called out in a comment. If the
two ever disagree about what an invoice says, the Python is the one that has seen more invoices.
  ⚠ BOTH ARE LIVE. A change to the parse rules here and not there (or the reverse) leaves two tools reading the same supplier's
  paperwork by different rules, with nothing recording which one keyed a given invoice. Change both, or retire one.

-- WHY NOT JUST SHELL OUT TO THE PYTHON ------------------------------------------------------------------------------------------------
It would reuse the proven code exactly, and it was rejected: the API runs on a VPS under PM2 where Python and pdfplumber are not
installed, and the script does its own DB writes with none of this platform's conventions (no withTransaction, no bclog, no
changed_by). CLAUDE.md already carries one warning about logic duplicated into a script outside the repo; adding a second, with the
platform depending on it at runtime, is worse than a careful port.

-- TEXT EXTRACTION, AND WHY THE LIBRARY CHOICE MATTERED --------------------------------------------------------------------------------
The Python uses pdfplumber, which lays text out by POSITION. The regexes below depend on that: an item line is
"4000 1029470 3 Arizona BF Graceful Taupe 1 Pair", with real spaces between the columns.
  `pdf-parse` was tried first and is unusable here — it concatenates adjacent cells ("240/4.564029939", "40001029470   3Arizona"),
  which loses the boundary between the size and the commodity code. No regex can recover that; the space is the only separator.
  `pdfjs-dist` v3 extracts correctly but drags in an optional `canvas` dependency carrying 4 advisories (3 high, 1 critical) — not
  acceptable in a repo whose last dependency commit was clearing exactly those.
  `pdfjs-dist` v4 has no canvas dependency, audits clean, and reproduces pdfplumber's lines character for character on the sample
  invoice. It is ESM-only, hence the dynamic import() inside an otherwise CommonJS codebase.
So `extractLines` rebuilds lines the way pdfplumber does: group text items by rounded Y, sort each row by X, and insert a space
wherever the next item starts beyond the previous one's right edge. That last rule is what keeps the columns apart.

THE ONE PARSE DIVERGENCE FROM THE PYTHON: pdfplumber renders the tax code joined to the currency ("37.50 GBPA2") and pdfjs separates
it ("37.50 GBP A2"). RE_SIZE therefore allows an optional space there. Everything else matches.
=======================================================================================================================================
*/

const logger = require('./logger');

// --- the invoice's own shape (ported verbatim; see the header) -------------------------------------------------------------------

// Header labels sit in the right-hand column. The extractor joins them with whatever is to their left, so these anchor on line end.
const RE_INVOICE_LABEL = /(^|\s)Number\s*$/;
const RE_ORDER_HEADER = /Order number\/Date\s*$/;
// "Date" alone at the end of a line. The leading \s matters: it is what stops this matching "Order number/Date" or
// "Purchase order number/Date", which end in "/Date".
const RE_DATE_HEADER = /\sDate\s*$/;

// Item header: "5400 1015398 5 Barbados EVA Black 13 Pair"
const RE_ITEM = /^\d{4,5}\s+(\S+)\s+\d+\s+.+?\s+(\d+)\s+Pair\s*$/;

// Size row: "230/3.5 64029939 2 Pair 16.67 GBP 33.34 GBPA2" — and, from pdfjs, "… 33.34 GBP A2". The `\s*` before the tax code is
// the single deliberate divergence from the Python.
const RE_SIZE = /^(\S+)\s+\d+\s+(\d+)\s+Pair\s+\d+\.\d+\s+GBP\s+\d+\.\d+\s+GBP\s*\S*\s*$/;

// An order-change marker sitting BELOW the sizes of the item it belongs to: "Order 1886093 vom 15.09.2025". It applies only to that
// item; later items fall back to the header order. This is why one invoice can pay against several orders — see invoice.json, where
// four items span two of them.
const RE_ORDER_CHANGE = /^Order\s+(\d+)\s+vom\s+\S+\s*$/;

// "Sum of pos. 30 Pair 804.20" — the invoice's own total, used as a cross-check on the parse.
const RE_TOTAL = /^Sum of pos\.\s+(\d+)\s+Pair\s+[\d,]+(?:\.\d+)?\s*$/;

// mm/UK size as printed on the invoice -> the EU suffix used in birktracker.code. Ported as-is.
const EU_SIZE = {
  '225/2.5': '35',
  '230/3.5': '36',
  '240/4.5': '37',
  '245/5': '38',
  '250/5.5': '39',
  '260/7': '40',
  '265/7.5': '41',
  '270/8': '42',
  '280/9': '43',
  '285/9.5': '44',
  '290/10.5': '45',
  '300/11.5': '46',
};

// pdfplumber emits underline/strikethrough artefacts as runs of underscores mid-line; the Python strips them before matching.
function clean(line) {
  return line.replace(/_+/g, '').trim();
}

const paddedArticle = (code) => String(code).padStart(7, '0');
const paddedOrder = (order) => String(order).padStart(10, '0');

/*
 * extractLines(buffer) -> string[]
 * Rebuilds pdfplumber-style visual lines from the PDF's positioned text items. See the header for why this is done by hand.
 */
async function extractLines(buffer) {
  // pdfjs-dist v4 is ESM-only; this file (and the rest of the server) is CommonJS.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;

  const lines = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    // Group by baseline Y. The 2pt tolerance absorbs the sub-pixel drift between items that are visually on one line.
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      let key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2);
      if (key === undefined) {
        key = y;
        rows.set(key, []);
      }
      rows.get(key).push({ x: item.transform[4], str: item.str, width: item.width });
    }

    // Top of the page downwards, then left to right within each line.
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, items]) => {
        items.sort((a, b) => a.x - b.x);
        let line = '';
        let prevEnd = null;
        for (const item of items) {
          // A gap between the previous item's right edge and this one's left edge is a column boundary — the space that every regex
          // below depends on. Without it the article code fuses to the gender digit and the size to the commodity code.
          if (prevEnd !== null && item.x - prevEnd > 1) line += ' ';
          line += item.str;
          prevEnd = item.x + item.width;
        }
        lines.push(line);
      });
  }
  return lines;
}

function extractHeader(lines) {
  const header = {};
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    const next = i + 1 < lines.length ? lines[i + 1].trim() : '';
    if (RE_INVOICE_LABEL.test(line) && header.invoice_number === undefined) {
      header.invoice_number = next;
    } else if (RE_ORDER_HEADER.test(line) && header.order_number === undefined) {
      header.order_number = next.split('/')[0].trim(); // "1927328 / 04.11.2025"
    } else if (RE_DATE_HEADER.test(line) && header.invoice_date === undefined) {
      // The date value sits a couple of lines below its label because the address block is interleaved with it. Take the first
      // dd.mm.yyyy within the next few lines, exactly as the Python does.
      for (const look of lines.slice(i + 1, i + 8)) {
        const m = /\b(\d{2}\.\d{2}\.\d{4})\b/.exec(look);
        if (m) {
          header.invoice_date = m[1];
          break;
        }
      }
    }
  });
  return header;
}

/*
 * parseInvoice(buffer) -> { invoice_number, invoice_date, order_number, total_invoiced, items[] }
 * items[] = { article_code, total_quantity, order_number, sizes: [{ size, quantity }] }
 */
async function parseInvoice(buffer) {
  const rawLines = await extractLines(buffer);
  const header = extractHeader(rawLines);
  const headerOrder = header.order_number || '';

  const items = [];
  let current = null;
  let totalInvoiced = null;

  for (const raw of rawLines) {
    const line = clean(raw);
    if (!line) continue;

    let m = RE_ITEM.exec(line);
    if (m) {
      current = { article_code: m[1], total_quantity: Number(m[2]), order_number: headerOrder, sizes: [] };
      items.push(current);
      continue;
    }

    if (current) {
      m = RE_SIZE.exec(line);
      if (m) {
        current.sizes.push({ size: m[1], quantity: Number(m[2]) });
        continue;
      }
    }

    m = RE_ORDER_CHANGE.exec(line);
    if (m) {
      // Applies ONLY to the item above it; the next item defaults back to the header order.
      if (current) current.order_number = m[1];
      continue;
    }

    m = RE_TOTAL.exec(line);
    if (m) {
      totalInvoiced = Number(m[1]);
      continue;
    }
  }

  return {
    invoice_number: header.invoice_number || '',
    invoice_date: header.invoice_date || '',
    order_number: headerOrder,
    total_invoiced: totalInvoiced,
    items,
  };
}

// One row per (article, order, size) — the grain the order book is keyed at.
function flatten(invoice) {
  const out = [];
  for (const item of invoice.items) {
    for (const sz of item.sizes) {
      out.push({ article: item.article_code, order: item.order_number, size: sz.size, qty: sz.quantity });
    }
  }
  return out;
}

// --- matching the invoice to the order book ---------------------------------------------------------------------------------------

// The Python's _find_rows, verbatim: an invoice line is matched on order + Birkenstock's own size label + the article prefix of the
// code. NOT on the EU size — `bksize` is what the invoice prints, and the code's EU suffix is derived from it only when a row has to
// be invented (below).
async function findRows(client, line) {
  const res = await client.query(
    `SELECT code, ordernum, bksize, requested, invoiced, invoicedate, invoicenum
       FROM birktracker
      WHERE ordernum = $1 AND bksize = $2 AND code LIKE $3`,
    [paddedOrder(line.order), line.size, `${paddedArticle(line.article)}-%`]
  );
  return res.rows;
}

// The style portion of a code ("ARIZONA" out of "0051751-ARIZONA-35"), taken from any existing row for the same article. Used only to
// suggest a code for a line the book has never seen. The style may itself contain hyphens, hence the join.
async function deriveStyle(client, article) {
  const res = await client.query('SELECT code FROM birktracker WHERE code LIKE $1 LIMIT 1', [`${article}-%`]);
  if (res.rowCount === 0) return null;
  const parts = res.rows[0].code.split('-');
  return parts.length >= 3 ? parts.slice(1, -1).join('-') : null;
}

/*
 * buildPlan(client, invoice) -> entries[]
 * One entry per invoice line, each carrying what the operator needs in order to decide. Where the Python stops and prompts, this
 * returns a `kind` for the screen to ask about instead — same four outcomes, same order of tests:
 *   'update'            exactly one matching row; add the qty to it.
 *   'already_invoiced'  that row already carries THIS invoice number with a quantity — almost always a re-run of the same PDF.
 *   'ambiguous'         several rows match; the operator picks one.
 *   'missing'           no row matches; the operator adds one (with a suggested code) or skips it.
 * READ ONLY — nothing here writes.
 */
async function buildPlan(client, invoice) {
  const entries = [];

  for (const line of flatten(invoice)) {
    const rows = await findRows(client, line);
    const base = {
      article: paddedArticle(line.article),
      ordernum: paddedOrder(line.order),
      size: line.size,
      eu: EU_SIZE[line.size] || '',
      qty: line.qty,
    };

    if (rows.length === 0) {
      const style = await deriveStyle(client, base.article);
      entries.push({
        ...base,
        kind: 'missing',
        // Blank when no row for the article exists anywhere — then the operator has to type the whole code or skip the line.
        suggested_code: style ? `${base.article}-${style}-${base.eu}` : '',
        candidates: [],
      });
      continue;
    }

    if (rows.length > 1) {
      entries.push({ ...base, kind: 'ambiguous', candidates: rows });
      continue;
    }

    const row = rows[0];
    const alreadyThisInvoice = (row.invoicenum || '').trim() === invoice.invoice_number && Number(row.invoiced || 0) > 0;
    entries.push({
      ...base,
      kind: alreadyThisInvoice ? 'already_invoiced' : 'update',
      row,
      candidates: [],
    });
  }

  return entries;
}

module.exports = { parseInvoice, buildPlan, flatten, extractLines, EU_SIZE, paddedArticle, paddedOrder, logger };
