/*
=======================================================================================================================================
Module: utils/orderChannels.js   — the list of sales channels Update Orders reads
=======================================================================================================================================
Purpose: utils/orderSync.js → runOrderSync() walks this list. The Update Orders button (POST /order-sync) and the cron
         (scripts/order-sync.js) both call runOrderSync, so a channel listed here is on the button AND the timer — there is no
         other place to wire it in.

A CHANNEL is one file exporting `channel`:

    {
      name:         'Shopify'                       // for the log and the server log only — the screen shows one total
      isConfigured: () => boolean                   // its .env credentials are present
      setupHint:    'X / Y in bcweb-server/.env'    // logged when isConfigured() is false
      fetch:        async () => fetched             // NETWORK READ. Runs before the transaction opens, never holds one. Throw on
                                                    // failure: the run carries on without this channel ("not checked").
      write:        async (client, fetched) => {    // DATABASE WRITE, on the run's transaction client, under its lock
                      newOrders,                    // distinct orders new to orderstatus — summed into the headline
                      notes: [],                    // per-line warnings (server log + response, not the button)
                      log: 'short text',            // this channel's part of the bclog audit row
                      detail: {}                    // anything else worth returning (counts)
                    }
      code:         'SHOPIFY'                       // the orderstatus.channel value its rows carry
      fulfil: {                                     // the Fulfil buttons (routes/order-status-customer-fulfil.js): mark a PACKED order
        isConfigured: () => boolean,                // shipped on the marketplace. The route has already worked out the tracking
        setupHint:    '…',                          // (Click & Drop number, or fba=true); the channel only tells its marketplace.
        run: async ({ ordernum, fba, tracking, codes }) => ({ outcome: 'fulfilled'|'already'|'skipped'|'failed', reason })
                                                    // read the order first: already shipped -> 'already', send nothing (re-press safe)
      }
    }

WHAT write() OWNS — its own channel's rows and nothing else:
  * new orders -> orderstatus (ordertype 1, its own `channel` value, its own ordernum prefix), refresh delivery details on a re-read;
  * its sales rows (its own sales.channel code), booked once per new line with a duplicate guard on (channel, ordernum, code);
  * posted / cancelled orders -> orderstatus_archive, and their picks dealt with (posted: delete; cancelled: back to '#FREE').
    Archive ONLY rows with its own `channel` value, and never on a partial read (archive-by-absence on a truncated fetch would
    archive live orders).
WHAT IT DOES NOT DO — pick allocation and housekeeping. runOrderSync runs those ONCE, after every channel has written, so a new
order from any channel is picked in the same run and two channels can never allocate the same shelf row.

ADDING A CHANNEL (e.g. TikTok): write utils/<name>Orders.js (the API read) and utils/<name>OrderSync.js (write + `channel`, with its
fulfil step), add one line below, add its sales.channel code to the Sales screen. The order of the list is only the order channels write in — phase E
allocates over orderstatus as a whole once they all have.

AMAZON (2026-11-09, utils/amzOrderSync.js): a channel that writes SALES ONLY — FBA orders need no picking, so no orderstatus rows,
no fulfil step. Counted in the headline (owner: "Even though we dont have to pack them, its good to see").
=======================================================================================================================================
*/

const CHANNELS = [
  require('./shopifyOrderSync').channel,
  require('./ebayOrderSync').channel,
  require('./amzOrderSync').channel,
];

module.exports = { CHANNELS };
