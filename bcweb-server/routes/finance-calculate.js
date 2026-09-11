/*
=======================================================================================================================================
API Route: finance_calculate
=======================================================================================================================================
Method: POST  (multipart/form-data)
Purpose: Finance / Month End, stage 1 — READ-ONLY. Take the operator's uploaded month-end files plus the figures they typed, work out
         every accounting figure for the month, and hand back the full account of how each one was reached. WRITES NOTHING.

         Spec: docs/finance-month-end-spec.md. The module is stateless by decision (owner, 2026-09-11): no tables, no history, no
         snapshot. This route calculates, /finance-quickfile turns the result into files, and nothing persists in between.

WHY THE EVIDENCE IS RETURNED ALONGSIDE THE FIGURES
The PowerBuilder screen this replaces showed four grids of bare numbers with a red box when a value was zero — and a zero was
ambiguous between "genuinely nothing this month" and "the file was missing and nobody noticed" (`FileOpen` returns -1 on an absent
file and the read loop exits silently). So every figure here arrives with what produced it: the per-type row breakdown, the
reconciliation, the SKUs that could not be matched, and the file's own date window. A figure on this screen can be checked; a figure
on that one could only be believed.

THE RECONCILIATION IS THE CHECK THAT MATTERS
`amazon.reconciliation.difference` must be 0.00. It compares the non-Transfer rows' own `total` column against everything we
allocated to income, VAT, fees and reimbursements. A non-zero value means Amazon has added a money column this code does not read,
and it is the one signal that catches that on the day it happens rather than at year end.

UPLOADS ARE IDENTIFIED BY HEADER, NEVER BY FILENAME
Two rename rituals die here: Amazon's 'AMAZON-Sales.csv' and PayPal's exact-case 'Download.CSV' (whose Python reader renames it to
'-done' after a run, so a re-run silently produces a month with no PayPal fee in it). Drop the files under whatever name they
arrived with; a file that fingerprints as neither is refused by name with the reason.
=======================================================================================================================================
Request: multipart/form-data
  files     OPTIONAL, 0-2 files: the Amazon Monthly Transaction CSV and/or the PayPal transaction CSV, any filename.
            Uploading nothing is valid and yields a Shopify-only month (see the note in the body).
  month     'YYYY-MM' — the month being closed. REQUIRED: it drives the invoice dates, and deriving it from today's date is the
            PowerBuilder January bug (spec §9.1)
  manual    JSON string, optional: { sumupSales, sumupFees, cashSales, car } — the figures typed on the screen
  includeShopify  optional, 'false' to SKIP the Shopify pull entirely. The screen sends this when it already holds a good pull for
            this month and the operator has only changed a file or a typed figure — re-reading 540 orders to recalculate an Amazon
            file nobody asked about is half a minute of nothing. The skipped block comes back as { present:false, skipped:true } and
            the CLIENT merges its own cached figures over it (they never travel back up: the Shopify CSV alone is 128KB).

Shopify is NOT a parameter. Since Phase 2 it is pulled live from the Shopify API for the month requested (utils/financeShopify.js),
which is why this route can take a minute: it walks every order created in the month plus 90 days of lookback for refunds.

Success Response:
{
  "return_code": "SUCCESS",
  "month": "2026-08",
  "rejected": [ { "filename": "buybox.csv", "reason": "Not recognised as ..." } ],
  "amazon": { "present": true, "rowCount": 950, "window": {...}, "net": 17943.71, "vatCharged": 3561.64, "vatZeroRated": 0.00,
              "vatDeclared": 3561.64, "gross": 21505.35, "fees": -7208.93, "reimbursements": 233.74,
              "byType": [...], "zeroRated": {...}, "unmatched": [...], "liquidationUnmatched": {...}, "reconciliation": {...} },
  "paypal":  { "present": true, "fees": 88.20, "count": 41, "rowCount": 412, "currencies": [...] },
  "shopify": { "present": true, "source": "api", "sales": 32820.41, "salesVat": 5460.85, "refund": -5098.36,
               "refundVat": -849.88, "fees": -646.16, "csv": "<the Shopify Transaction report>", ... },
  "manual":  { "sumupSales": 940, "sumupFees": 18.4, "cashSales": 312, "car": 240 },
  "stock":   { "units": 3052, "value": 87770.96 },
  "checks":  [ { "key": "amazon-reconciled", "level": "ok"|"warn", "message": "..." } ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"              calculated (which does NOT mean every source was present — read `present` on each)
"MISSING_MONTH"        no month, or not YYYY-MM
"TOO_MANY_FILES"       more than the two this screen takes
"FILE_TOO_LARGE"       a file over 25MB
"NO_VALID_FILES"       files were uploaded and every one was refused — see `rejected`. Uploading NOTHING is not an error.
                       (a Shopify failure is NOT a return code: it lands in `shopify.error` and a check, so the rest of the
                        month still calculates — one API being down must not cost the operator the Amazon figures)
"DUPLICATE_FILE"       two files fingerprinted as the same source
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { computeAmazon, identify: identifyAmazon } = require('../utils/financeAmazon');
const { computePayPal, identify: identifyPayPal } = require('../utils/financePayPal');
const { computeShopify } = require('../utils/financeShopify');
const { stockValue } = require('../utils/financeStock');
const logger = require('../utils/logger');

router.use(verifyToken);

// In memory. The Amazon file is ~300KB and the PayPal export smaller; 25MB is far above any real month while still capping a runaway
// upload. Nothing touches disk, so there is no temp-file lifecycle to leak or expire.
const MAX_FILES = 2;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: MAX_FILES },
});

/** Parse a JSON form field, tolerating absence and junk — a malformed extra field must never lose the operator their upload. */
function jsonField(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** A typed money figure from the screen: a finite number, or 0. Never NaN — NaN reaches the CSV as 'NaN' and QuickFile takes it. */
function figure(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Work out which source each uploaded file is, from its header alone.
 * A file is offered to each parser in turn; the first that recognises it wins. Anything recognised by neither is rejected BY NAME
 * with the more useful of the two refusal reasons, rather than being quietly ignored.
 */
function readUploads(files) {
  const parsed = {};
  const rejected = [];
  let duplicate = null;

  for (const file of files) {
    const text = file.buffer.toString('utf8');

    const amz = identifyAmazon(text);
    if (amz.ok) {
      if (parsed.amazon) { duplicate = 'Amazon transaction'; continue; }
      parsed.amazon = { text, filename: file.originalname };
      continue;
    }

    const pp = identifyPayPal(text);
    if (pp.ok) {
      if (parsed.paypal) { duplicate = 'PayPal'; continue; }
      parsed.paypal = { text, filename: file.originalname };
      continue;
    }

    // Neither. Report the reason from whichever parser got FURTHER: if the Amazon reader recognised the report but named a missing
    // column, that is a real diagnosis ("Amazon renamed a column"), and far more useful than PayPal's generic "no Fee column".
    const reason = /transaction report but/.test(amz.reason || '') ? amz.reason : `${amz.reason} ${pp.reason}`;
    rejected.push({ filename: file.originalname, reason });
  }

  return { parsed, rejected, duplicate };
}

/**
 * The short list of things worth saying out loud before the operator generates files. Deliberately few: a screen of warnings is a
 * screen nobody reads. Each is either OK or a warning — none of them blocks generating, because the operator closes the books, not
 * this route.
 */
function buildChecks({ amazon, paypal, shopify }) {
  const checks = [];

  if (amazon) {
    const diff = amazon.reconciliation.difference;
    checks.push(diff === 0
      ? { key: 'amazon-reconciled', level: 'ok', message: `${amazon.rowCount} Amazon rows, every one accounted for` }
      : {
        key: 'amazon-reconciled',
        level: 'warn',
        message: `Amazon rows do not reconcile — the file totals £${amazon.reconciliation.fileTotal.toFixed(2)} but £${amazon.reconciliation.allocated.toFixed(2)} was allocated (£${diff.toFixed(2)} out). Amazon may have added a column.`,
      });

    if (amazon.unmatched.length > 0) {
      const value = amazon.unmatched.reduce((s, u) => s + u.value, 0);
      checks.push({
        key: 'amazon-unmatched',
        level: 'warn',
        message: `${amazon.unmatched.length} Amazon SKU${amazon.unmatched.length > 1 ? 's' : ''} could not be matched to a product (£${value.toFixed(2)}) — standard VAT rating was assumed`,
      });
    }

    if (amazon.extraColumns.length > 0) {
      checks.push({
        key: 'amazon-columns',
        level: 'warn',
        message: `Amazon has added ${amazon.extraColumns.length} column${amazon.extraColumns.length > 1 ? 's' : ''} to the report (${amazon.extraColumns.join(', ')}) — the figures are unaffected, but the report format has changed`,
      });
    }
  } else {
    checks.push({ key: 'amazon-missing', level: 'warn', message: 'No Amazon transaction file — the Amazon figures are all zero' });
  }

  if (!paypal) {
    // Named explicitly because its absence is invisible otherwise, which is exactly how the Python's rename-to-'-done' trap produced
    // a month with no PayPal fee and no sign that anything was wrong.
    checks.push({ key: 'paypal-missing', level: 'warn', message: 'No PayPal file — no PayPal fee will appear in the purchase file' });
  } else if (paypal.currencies.length > 1) {
    checks.push({
      key: 'paypal-currency',
      level: 'warn',
      message: `The PayPal export mixes currencies (${paypal.currencies.map((c) => c.code).join(', ')}) — the fee total adds them together`,
    });
  }

  // Shopify comes from the API, so there are three distinct outcomes and they must not look alike: it worked, the whole pull
  // failed, or the sales came back but the FEES call (a different token, a different scope) did not.
  if (shopify && shopify.skipped) {
    // Not a warning. The operator chose this, the figures on screen are real, and they came from a pull of THIS month.
    checks.push({ key: 'shopify-reused', level: 'ok', message: 'Shopify was not re-read — the figures shown are from the earlier pull' });
  } else if (!shopify || !shopify.present) {
    checks.push({
      key: 'shopify-failed',
      level: 'warn',
      message: `Shopify could not be read (${(shopify && shopify.error) || 'unknown error'}) — no Shopify line will appear in the sales file`,
    });
  } else {
    checks.push({
      key: 'shopify-pulled',
      level: 'ok',
      message: `${shopify.orderCount} Shopify orders, ${shopify.rowCount} report rows, VAT derived from our own tax flag`,
    });
    if (shopify.truncated) {
      checks.push({ key: 'shopify-truncated', level: 'warn', message: 'The Shopify order fetch hit its page ceiling — the figures are incomplete, do not file them' });
    }
    if (shopify.fees === null) {
      checks.push({ key: 'shopify-fees', level: 'warn', message: `Shopify sales were read but the fees call failed (${shopify.feesError}) — no Shopify fee line will appear` });
    }
    if (shopify.unmatched && shopify.unmatched.length > 0) {
      const value = shopify.unmatched.reduce((s, u) => s + u.value, 0);
      checks.push({
        key: 'shopify-unmatched',
        level: 'warn',
        message: `${shopify.unmatched.length} Shopify SKU${shopify.unmatched.length > 1 ? 's' : ''} could not be matched to a product (£${value.toFixed(2)}) — standard VAT rating was assumed`,
      });
    }
  }

  return checks;
}

router.post('/', (req, res) => {
  // multer is run by hand so its failures become our JSON envelope rather than a raw 4xx (docs/API-RULES.md: every response is
  // HTTP 200 plus a return_code).
  upload.array('files', MAX_FILES)(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') {
          return res.json({ return_code: 'FILE_TOO_LARGE', message: 'One of the files is larger than 25MB' });
        }
        if (uploadErr.code === 'LIMIT_FILE_COUNT' || uploadErr.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.json({ return_code: 'TOO_MANY_FILES', message: `Upload up to ${MAX_FILES} files: the Amazon transaction CSV and the PayPal export` });
        }
        return res.json({ return_code: 'SERVER_ERROR', message: uploadErr.message || 'Upload failed' });
      }

      const month = String(req.body.month || '').trim();
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.json({ return_code: 'MISSING_MONTH', message: 'A month is required, as YYYY-MM' });
      }

      // FILES ARE OPTIONAL. Shopify comes from the API and the stock valuation from the database, so a run with nothing uploaded
      // is a perfectly good month — it simply has no Amazon and no PayPal figures, and the checks say so in words. Refusing here
      // (which this route did until 2026-09-11) greyed out the only button on the screen for a run that would have worked.
      const files = req.files || [];
      const { parsed, rejected, duplicate } = readUploads(files);
      if (duplicate) {
        return res.json({
          return_code: 'DUPLICATE_FILE',
          message: `Two of the uploaded files are both the ${duplicate} export. Upload one of each.`,
        });
      }
      // Files were uploaded and NOT ONE of them was usable. That is different from uploading nothing: the operator meant to
      // include them, so handing back a plausible-looking month with the Amazon block silently empty would be the exact failure
      // this module exists to end. Stop, and name each file with its reason.
      if (files.length > 0 && Object.keys(parsed).length === 0) {
        return res.json({
          return_code: 'NO_VALID_FILES',
          message: 'None of the uploaded files could be identified',
          rejected,
        });
      }

      // --- The figures ------------------------------------------------------------------------------------------------------
      // Read-only throughout: computeAmazon SELECTs the tax flags, stockValue SELECTs the valuation, and nothing else touches the
      // database. No transaction, because there is nothing to make atomic.
      let amazon = null;
      if (parsed.amazon) {
        const result = await computeAmazon(pool, parsed.amazon.text);
        if (!result.ok) {
          // The file identified but would not parse — name it rather than returning a month of zeros.
          return res.json({ return_code: 'NO_VALID_FILES', message: result.reason, rejected: [{ filename: parsed.amazon.filename, reason: result.reason }] });
        }
        // _zeroRatedRows carries the raw CSV cells for the year-end kidsvatcharged.csv. It is rebuilt by /finance-quickfile from the
        // re-uploaded file rather than shipped to the browser and back — a few hundred rows of raw cells is not screen data.
        const { _zeroRatedRows, ...rest } = result;
        amazon = { present: true, filename: parsed.amazon.filename, ...rest };
      }

      let paypal = null;
      if (parsed.paypal) {
        const result = computePayPal(parsed.paypal.text);
        if (!result.ok) {
          return res.json({ return_code: 'NO_VALID_FILES', message: result.reason, rejected: [{ filename: parsed.paypal.filename, reason: result.reason }] });
        }
        paypal = { present: true, filename: parsed.paypal.filename, ...result };
      }

      // Typed figures. Shopify is typed in Phase 1 and comes from the API in Phase 2 (spec §8) — `source` says which, so the screen
      // can label it honestly rather than implying an API pull that has not happened.
      const manualIn = jsonField(req.body.manual, {});
      const manual = {
        sumupSales: figure(manualIn.sumupSales),
        sumupFees: figure(manualIn.sumupFees),
        cashSales: figure(manualIn.cashSales),
        car: figure(manualIn.car),
      };

      // Shopify, live from the API (Phase 2). Guarded in its own right: the Amazon figures come from a file the operator is holding
      // and must not be lost because Shopify is having a bad morning. A failure becomes `shopify.error` plus a check, never a
      // silent zero — the whole point of this module.
      //
      // ...unless the screen asked us not to. See the `includeShopify` note in the request block: skipping is how a second run over
      // a corrected Amazon file stays instant instead of costing another half-minute.
      const includeShopify = String(req.body.includeShopify ?? 'true') !== 'false';
      let shopify = { present: false, source: 'api', skipped: false, sales: 0, salesVat: 0, refund: 0, refundVat: 0, fees: 0, error: null };
      if (!includeShopify) {
        shopify.skipped = true;
      } else {
        try {
          const result = await computeShopify(pool, month);
          shopify = { present: true, skipped: false, ...result, error: null };
        } catch (err) {
          logger.error('[finance-calculate] Shopify pull failed:', err.message);
          shopify.error = err.message;
        }
      }

      // Display only — not a QuickFile line. Guarded so a valuation problem never costs the operator the rest of the screen.
      let stock = null;
      try {
        stock = await stockValue();
      } catch (err) {
        logger.error('[finance-calculate] stock valuation failed:', err.message);
      }

      const checks = buildChecks({ amazon, paypal, shopify });

      logger.info(`[finance-calculate] ${req.user.display_name}: ${month} — ${amazon ? `${amazon.rowCount} Amazon rows, gross ${amazon.gross}` : 'no Amazon file'}${paypal ? `, PayPal ${paypal.fees}` : ''}${shopify.skipped ? ', Shopify skipped' : ''}`);

      return res.json({
        return_code: 'SUCCESS',
        month,
        rejected,
        amazon: amazon || { present: false },
        paypal: paypal || { present: false },
        shopify,
        manual,
        stock,
        checks,
      });
    } catch (err) {
      logger.error('[finance-calculate] error:', err.message);
      return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to calculate the month' });
    }
  });
});

module.exports = router;
