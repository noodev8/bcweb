/*
=======================================================================================================================================
Util: googleAdsImport
=======================================================================================================================================
Purpose: Turn uploaded Google Ads report files into a PLAN — a complete, inspectable description of every row that would be written,
         left alone or skipped, with a reason attached to each — and then execute that plan.

         Same division of labour as the Amazon import: utils/googleAdsReports.js does the pure parsing (no DB), this file does
         everything that needs to look at the database.

WHY PREVIEW AND COMMIT SHARE THIS
The preview route renders the plan; the commit route builds the SAME plan again inside its transaction and executes it. If each did
its own reasoning they would drift and the operator would be approving one thing and getting another. Here there is one
implementation, so "what the preview said" and "what the commit did" cannot disagree about anything except genuine data changes
between the two calls — and commit re-reads the database inside its transaction, so even that is accounted for rather than assumed.

THE ARITHMETIC THE PREVIEW SHOWS
    rows in file = written + unchanged + skipped
Nothing is discarded without a reason attached and a count against it. This is the discipline the Amazon module was built on after
the legacy PowerBuilder import was found to be dropping rows invisibly, and it applies for the same reason: an import you cannot
audit is an import you cannot trust.

WHY UPSERT AND NOT DELETE-THEN-INSERT
Google revises conversions upward for WEEKS after the click, so re-importing an overlapping window is normal and expected, and the
later figure is the better one. `ON CONFLICT ... DO UPDATE` always takes it.

Delete-then-insert per day was considered and rejected: a report accidentally filtered to one campaign would wipe every other
campaign's rows for those days. An upsert cannot lose data it was not shown. The trade is that a row Google later stops reporting
stays behind — which is correct anyway, because Google omits zero-impression rows entirely and absence never means zero.

LABEL MISMATCH IS NOT AN ERROR
`google_label` is what Google reported the bucket to be; `skusummary.googlecampaign` is what we say it is. They disagree whenever a
change has not yet propagated (feed at 3:30am -> SFTP -> Google recrawl, so ~a day), and they disagreed for four months on 23 styles
that were stranded on a dead 'birk-winner' label with nothing to announce it. The plan therefore COUNTS the mismatch and names
examples rather than treating it as a fault. A large count on an old window is expected; a large count on a fresh one means the feed
has stopped landing.
=======================================================================================================================================
Exports:
  readUploads(files)                     -> { parsed, rejected, duplicate }
  buildPlan(client, parsed)              -> { product, campaign }   (either may be null)
  applyProduct(client, rows, importedBy) -> { written }
  applyCampaign(client, rows)            -> { written }
=======================================================================================================================================
*/

// addSkip is shared with the parser so a skip recorded here looks identical to one recorded during parsing — the preview renders
// both from the same list and must not be able to tell them apart.
const { parseReport, identify, addSkip } = require('./googleAdsReports');

// Postgres caps a statement at 65535 bind parameters. The widest row here binds 10, so 500 rows/statement leaves an order of
// magnitude of headroom and keeps a 12-month backfill (~70k rows) to a manageable number of round-trips.
const CHUNK_ROWS = 500;

// Money and conversion figures are compared to 2dp when deciding whether a row actually CHANGED. Postgres hands NUMERIC back as a
// string and the file gives us a JS float; without a fixed comparison, 4.94 vs '4.94' would read as a change on every single row and
// the preview's "unchanged" count — the operator's signal that a re-import is a no-op — would always be zero.
const money = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

/**
 * The stored form of a Google label. '' means "Google reported no custom_label_0 for this style on this day" (the export's " --").
 *
 * It is NOT NULL because google_label is part of google_product_daily's PRIMARY KEY, and NULLs never compare equal in a key — the
 * same unlabelled row would insert endlessly instead of deduplicating. See migrations/20260905b.
 */
const labelOf = (v) => (v === null || v === undefined ? '' : v);

// ---------------------------------------------------------------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Identify and parse each uploaded file. Files are matched to reports by HEADER CONTENT, never by filename — a saved report keeps
 * its name only until someone renames it, and the operator should not have to care.
 *
 * A file that does not fingerprint as either report is REJECTED BY NAME with the reason, rather than being quietly ignored. Quietly
 * ignoring a file is how the legacy Amazon import lost two of its five inputs for years.
 */
function readUploads(files) {
  const parsed = {};
  const rejected = [];
  let duplicate = null;

  for (const file of files) {
    const text = file.buffer.toString('utf8');
    const result = parseReport(text);

    if (!result.type) {
      rejected.push({ filename: file.originalname, reason: result.reason });
      continue;
    }
    if (parsed[result.type]) {
      duplicate = result.label;
      continue;
    }
    parsed[result.type] = { ...result, filename: file.originalname };
  }

  return { parsed, rejected, duplicate };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Shared plan helpers
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Days inside the file's own window that carry no rows at all.
 *
 * NOT AN ERROR, and deliberately not reported as one: Google omits days with no impressions entirely, so a paused account or a dead
 * style legitimately produces gaps. It is shown because a run of empty days in the middle of a window is worth a glance — it is
 * either a real pause the operator already knows about, or a report that was filtered when it should not have been.
 */
function missingDays(window, datesPresent) {
  if (!window) return [];
  const out = [];
  const cursor = new Date(`${window.from}T00:00:00Z`);
  const end = new Date(`${window.to}T00:00:00Z`);
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    if (!datesPresent.has(iso)) out.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Keep at most `n` examples of something, for the preview. */
function sample(list, n = 8) {
  return list.slice(0, n);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The product plan
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Plan the per-style report (bcweb_product_30) into google_product_daily.
 *
 * Two set-based reads, no N+1: every style once, and every existing row in the file's window once.
 */
async function planProduct(client, report) {
  const { rows, window, rowCount, skipped, extraColumns, filename, label } = report;

  // Every style we know about, with the bucket WE think it is in. 291 rows — cheap to hold, and it answers both the match check and
  // the label-mismatch check without a second query.
  const styleRes = await client.query('SELECT groupid, googlecampaign FROM skusummary');
  const ours = new Map(styleRes.rows.map((r) => [r.groupid, (r.googlecampaign || '').trim()]));

  // Everything already stored for this window, keyed the same way the primary key is. Loaded in one go so the change detection below
  // is a map lookup rather than a query per row.
  const existing = new Map();
  if (window) {
    const exRes = await client.query(
      // The date is cast to TEXT in SQL rather than handed back as a pg DATE. A pg DATE arriving in Node becomes local midnight and
      // toISOString() then shifts it a day back under BST — the landmine named in CLAUDE.md, and one that would silently key every
      // comparison to the wrong day for half the year.
      `SELECT to_char(snapshot_date,'YYYY-MM-DD') AS d, groupid, campaign, google_label,
              impressions, clicks, cost, conversions, conv_value
         FROM google_product_daily
        WHERE snapshot_date BETWEEN $1::date AND $2::date`,
      [window.from, window.to]
    );
    for (const r of exRes.rows) existing.set(`${r.d}|${r.groupid}|${r.campaign}|${labelOf(r.google_label)}`, r);
  }

  const write = [];
  // key -> its position in `write`, so a repeated key replaces rather than appends (see the DUPLICATE_KEY guard below).
  const writeIndex = new Map();
  const localSkips = skipped.map((s) => ({ ...s }));
  let unchanged = 0;

  const unmatched = new Set();
  const mismatches = [];
  const seenMismatch = new Set();
  const datesPresent = new Set();
  const styles = new Set();
  const campaigns = new Set();
  const totals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0 };

  for (const row of rows) {
    datesPresent.add(row.date);
    styles.add(row.groupid);
    campaigns.add(row.campaign);
    totals.impressions += row.impressions;
    totals.clicks += row.clicks;
    totals.cost += row.cost;
    totals.conversions += row.conversions || 0;
    totals.convValue += row.convValue || 0;

    // A style Google reports that we do not have. The row is STILL WRITTEN — see the migration's note on why groupid is not a
    // foreign key — but it is counted and named so the operator can see it rather than wonder where the spend went.
    if (!ours.has(row.groupid)) unmatched.add(row.groupid);

    // What Google says the bucket is vs what we say. Reported ONCE PER STYLE, not per row: 30 days of the same disagreement is one
    // fact, and listing it 30 times would bury it.
    if (row.googleLabel && ours.has(row.groupid)) {
      const weSay = ours.get(row.groupid);
      if (weSay && weSay.toUpperCase() !== row.googleLabel && !seenMismatch.has(row.groupid)) {
        seenMismatch.add(row.groupid);
        mismatches.push({ groupid: row.groupid, googleSays: row.googleLabel, weSay });
      }
    }

    // THE KEY INCLUDES THE LABEL. On the day a style's label changes, Google splits that day's activity across both labels and
    // reports TWO rows for the same (day, style, campaign) — 2,371 such collisions in the first 13-month export. Keying without the
    // label made the upsert abort outright ("ON CONFLICT DO UPDATE command cannot affect row a second time"); see migrations/20260905b.
    const key = `${row.date}|${row.groupid}|${row.campaign}|${labelOf(row.googleLabel)}`;

    // Belt and braces: if a file ever contains the SAME full key twice, the last one wins rather than the whole import failing.
    // A single duplicated row aborting a 68,000-row backfill is a terrible trade, and Google's report shapes change.
    const dupIndex = writeIndex.get(key);
    if (dupIndex !== undefined) {
      write[dupIndex] = row;
      addSkip(localSkips, 'DUPLICATE_KEY', 'The file listed this day/style/campaign/label twice — the later row was kept', [row.date, row.groupid, row.campaign, labelOf(row.googleLabel)]);
      continue;
    }

    const prev = existing.get(key);
    if (prev
      && Number(prev.impressions) === row.impressions
      && Number(prev.clicks) === row.clicks
      && money(prev.cost) === money(row.cost)
      && money(prev.conversions) === money(row.conversions)
      && money(prev.conv_value) === money(row.convValue)) {
      unchanged += 1;
      continue;
    }
    writeIndex.set(key, write.length);
    write.push(row);
  }

  return {
    type: 'PRODUCT',
    label,
    filename,
    window,
    rowsInFile: rowCount,
    write,
    counts: {
      write: write.length,
      unchanged,
      skipped: localSkips.reduce((a, s) => a + s.count, 0),
      // The contract the preview prints. If this is ever false something has been dropped without a reason, which is the one
      // failure this whole design exists to make impossible.
      balances: rowCount === write.length + unchanged + localSkips.reduce((a, s) => a + s.count, 0),
    },
    skipped: localSkips,
    extraColumns,
    styles: {
      inFile: styles.size,
      unmatched: unmatched.size,
      unmatchedExamples: sample([...unmatched]),
    },
    labelMismatch: {
      styles: mismatches.length,
      ofStyles: styles.size,
      examples: sample(mismatches),
    },
    campaigns: [...campaigns],
    totals: {
      impressions: totals.impressions,
      clicks: totals.clicks,
      cost: money(totals.cost),
      conversions: money(totals.conversions),
      convValue: money(totals.convValue),
    },
    emptyDays: missingDays(window, datesPresent),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The campaign plan
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Plan the per-campaign report (adcost_summary_30) into google_campaign_daily.
 *
 * This table is ALSO written by C:\scripts\google-ads\update_google_stock_track.py today. Both writers do the identical idempotent
 * upsert from the identical source, so they cannot disagree — but the Python's CSV half is being retired precisely so only one route
 * into this table remains (spec §6.6). Until that lands, re-importing a window the Python has already taken shows up here as
 * `unchanged`, which is exactly what it should be.
 */
async function planCampaign(client, report) {
  const { rows, window, rowCount, skipped, extraColumns, filename, label } = report;

  const existing = new Map();
  if (window) {
    const exRes = await client.query(
      `SELECT to_char(snapshot_date,'YYYY-MM-DD') AS d, campaign, clicks, impressions, cost,
              search_imp_share, lost_is_rank, lost_is_budget, conversions, conv_value
         FROM google_campaign_daily
        WHERE snapshot_date BETWEEN $1::date AND $2::date`,
      [window.from, window.to]
    );
    for (const r of exRes.rows) existing.set(`${r.d}|${r.campaign}`, r);
  }

  const write = [];
  const localSkips = skipped.map((s) => ({ ...s }));
  let unchanged = 0;

  const datesPresent = new Set();
  const campaigns = new Set();
  const totals = { clicks: 0, impressions: 0, cost: 0, conversions: 0, convValue: 0 };
  let censored = 0;

  for (const row of rows) {
    datesPresent.add(row.date);
    campaigns.add(row.campaign);
    totals.clicks += row.clicks;
    totals.impressions += row.impressions;
    totals.cost += row.cost;
    totals.conversions += row.conversions || 0;
    totals.convValue += row.convValue || 0;
    // Days where Google withheld the impression share ('--', '< 10%', '> 90%'). Counted so a run of them reads as Google censoring
    // rather than as our import losing the column.
    if (row.searchImpShare === null) censored += 1;

    const key = `${row.date}|${row.campaign}`;
    const prev = existing.get(key);
    if (prev
      && Number(prev.clicks) === row.clicks
      && Number(prev.impressions) === row.impressions
      && money(prev.cost) === money(row.cost)
      && money(prev.search_imp_share) === money(row.searchImpShare)
      && money(prev.lost_is_rank) === money(row.lostIsRank)
      && money(prev.lost_is_budget) === money(row.lostIsBudget)
      && money(prev.conversions) === money(row.conversions)
      && money(prev.conv_value) === money(row.convValue)) {
      unchanged += 1;
      continue;
    }
    write.push(row);
  }

  return {
    type: 'CAMPAIGN',
    label,
    filename,
    window,
    rowsInFile: rowCount,
    write,
    counts: {
      write: write.length,
      unchanged,
      skipped: localSkips.reduce((a, s) => a + s.count, 0),
      balances: rowCount === write.length + unchanged + localSkips.reduce((a, s) => a + s.count, 0),
    },
    skipped: localSkips,
    extraColumns,
    campaigns: [...campaigns],
    censoredShareDays: censored,
    totals: {
      clicks: totals.clicks,
      impressions: totals.impressions,
      cost: money(totals.cost),
      conversions: money(totals.conversions),
      convValue: money(totals.convValue),
    },
    emptyDays: missingDays(window, datesPresent),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Build the full plan for whatever was uploaded. Either report may be absent — uploading only one is a first-class case, and the
 * other simply is not touched.
 */
async function buildPlan(client, parsed) {
  return {
    product: parsed.PRODUCT ? await planProduct(client, parsed.PRODUCT) : null,
    campaign: parsed.CAMPAIGN ? await planCampaign(client, parsed.CAMPAIGN) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------------------------------------------

/** Run one chunked multi-row upsert. `build(row, base)` returns that row's placeholder list; `values(row)` returns its bind values. */
async function upsertChunked(client, rows, columns, conflict, updateSet, values) {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    const chunk = rows.slice(i, i + CHUNK_ROWS);
    const params = [];
    const tuples = chunk.map((row) => {
      const vals = values(row);
      const start = params.length;
      params.push(...vals);
      return `(${vals.map((_, k) => `$${start + k + 1}`).join(',')})`;
    });
    const res = await client.query(
      `INSERT INTO ${columns.table} (${columns.list.join(',')}) VALUES ${tuples.join(',')}
       ON CONFLICT (${conflict}) DO UPDATE SET ${updateSet}`,
      params
    );
    written += res.rowCount;
  }
  return { written };
}

/**
 * Write the product rows. Upsert on (snapshot_date, groupid, campaign) — see the header for why this is not delete-then-insert.
 * `imported_at` is refreshed on update so the freshness banner reports when a figure was last CONFIRMED, not when it first arrived.
 */
async function applyProduct(client, rows, importedBy) {
  return upsertChunked(
    client,
    rows,
    {
      table: 'google_product_daily',
      list: ['snapshot_date', 'groupid', 'google_label', 'campaign', 'impressions', 'clicks', 'cost',
        'conversions', 'conv_value', 'imported_by'],
    },
    'snapshot_date, groupid, campaign, google_label',
    `impressions  = EXCLUDED.impressions,
     clicks       = EXCLUDED.clicks,
     cost         = EXCLUDED.cost,
     conversions  = EXCLUDED.conversions,
     conv_value   = EXCLUDED.conv_value,
     imported_at  = now(),
     imported_by  = EXCLUDED.imported_by`,
    (r) => [r.date, r.groupid, labelOf(r.googleLabel), r.campaign, r.impressions, r.clicks, r.cost,
      r.conversions, r.convValue, importedBy]
  );
}

/**
 * Write the campaign rows. Same upsert shape on (snapshot_date, campaign) — matching what the Python already does, so the two
 * writers cannot produce different rows from the same file while both still exist.
 */
async function applyCampaign(client, rows) {
  return upsertChunked(
    client,
    rows,
    {
      table: 'google_campaign_daily',
      list: ['snapshot_date', 'campaign', 'clicks', 'impressions', 'cost',
        'search_imp_share', 'lost_is_rank', 'lost_is_budget', 'conversions', 'conv_value'],
    },
    'snapshot_date, campaign',
    `clicks           = EXCLUDED.clicks,
     impressions      = EXCLUDED.impressions,
     cost             = EXCLUDED.cost,
     search_imp_share = EXCLUDED.search_imp_share,
     lost_is_rank     = EXCLUDED.lost_is_rank,
     lost_is_budget   = EXCLUDED.lost_is_budget,
     conversions      = EXCLUDED.conversions,
     conv_value       = EXCLUDED.conv_value`,
    (r) => [r.date, r.campaign, r.clicks, r.impressions, r.cost,
      r.searchImpShare, r.lostIsRank, r.lostIsBudget, r.conversions, r.convValue]
  );
}

module.exports = { readUploads, buildPlan, applyProduct, applyCampaign, identify };
