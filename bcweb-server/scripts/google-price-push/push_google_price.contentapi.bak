"""
Google Merchant Center price push — single GROUPID, on-demand (server helper).

Mirrors update_google_price() from C:\\scripts\\price_update.py, adapted so the bcweb Express
server can push ONE product's new price to Google Merchant Center immediately after a Shopify
Pricing "Apply" (W1). Without this, Google Shopping/ads would keep showing the old price until
the next nightly C:\\scripts\\merchant-feed\\merchant_feed.py --upload cron run, since that
script is the only thing that regenerates and re-uploads the feed.

A groupid can map to MULTIPLE Google product ids (skumap.googleid, one per size/variant). A
first version pushed each one with its own products.update call, but that's N sequential HTTP
round-trips to Google for one Apply (noticeably slow for a style with many sizes) — so this
instead sends all of them in a SINGLE products.custombatch call (one HTTP request, method
"update" per entry), each setting price + salePrice to the new shopifyprice (mirrors
merchant_feed.py, which always feeds price=rrp, sale_price=shopifyprice).

Loads DB creds + the Google service-account JSON from the SERVER's .env (bcweb-server/.env),
not C:\\scripts\\.env. Prints a machine-readable JSON summary to stdout for the Node route; on
any failure before per-item processing starts it prints {"error": "<CODE>", "message": "..."}
and exits non-zero. Per-item Content API failures are collected in the summary instead of
failing the whole run (one bad googleid shouldn't block the rest of that style's sizes).

Usage:
    python push_google_price.py <GROUPID>

Exit codes: 0 = success (JSON summary on stdout, may list per-item errors); non-zero = failure
before any push was attempted (JSON error on stdout).
"""

import os
import sys
import json

import psycopg2
from dotenv import load_dotenv
from google.oauth2 import service_account
from googleapiclient.discovery import build

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_ENV = os.path.join(SCRIPT_DIR, "..", "..", ".env")

GOOGLE_SCOPES = ["https://www.googleapis.com/auth/content"]

# Cap on how many per-item errors we echo back — keeps stdout sane if something is very wrong.
MAX_ERRORS_RETURNED = 10


def fail(code, message):
    """Emit a JSON error envelope on stdout and exit non-zero for the Node route to map to a return_code."""
    print(json.dumps({"error": code, "message": message}))
    sys.exit(1)


def get_db_connection():
    """Connect to PostgreSQL using the server's .env credentials."""
    try:
        return psycopg2.connect(
            host=os.environ["DB_HOST"],
            port=os.environ.get("DB_PORT", "5432"),
            dbname=os.environ["DB_NAME"],
            user=os.environ["DB_USER"],
            password=os.environ["DB_PASSWORD"],
        )
    except KeyError as e:
        fail("DB_CONFIG", f"Missing DB env var: {e}")
    except Exception as e:
        fail("DB_CONNECT", f"Could not connect to the database: {e}")


def get_google_service():
    """Build the Content API v2.1 client from the service-account JSON in .env. Returns (service, merchant_id)."""
    merchant_id = os.environ.get("GOOGLE_MERCHANT_ID", "").strip()
    creds_json = os.environ.get("GOOGLE_MERCHANT_CREDENTIALS_JSON", "").strip()
    if not merchant_id or not creds_json:
        fail("GOOGLE_NOT_CONFIGURED", "GOOGLE_MERCHANT_ID / GOOGLE_MERCHANT_CREDENTIALS_JSON missing from .env")
    try:
        info = json.loads(creds_json)
    except Exception as e:
        fail("GOOGLE_NOT_CONFIGURED", f"GOOGLE_MERCHANT_CREDENTIALS_JSON is not valid JSON: {e}")
    try:
        credentials = service_account.Credentials.from_service_account_info(info, scopes=GOOGLE_SCOPES)
        service = build("content", "v2.1", credentials=credentials, static_discovery=True)
        return service, merchant_id
    except Exception as e:
        fail("GOOGLE_AUTH_FAILED", f"Could not initialise Google Content API: {e}")


def fetch_targets(conn, groupid):
    """
    googleid + current shopifyprice for every active, google-eligible size under groupid.
    Mirrors merchant_feed.py's WHERE clause (sm.googlestatus=1 AND sm.shopify=1 AND m.googlestatus=1) so we only ever push
    products that are actually meant to be in the Google feed.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.googleid, sm.shopifyprice
            FROM skusummary sm
            JOIN skumap m ON m.groupid = sm.groupid
            WHERE sm.groupid = %s
              AND sm.googlestatus = 1 AND sm.shopify = 1 AND m.googlestatus = 1
              AND COALESCE(m.deleted, 0) = 0
              AND m.googleid IS NOT NULL AND m.googleid <> ''
            """,
            (groupid,),
        )
        return cur.fetchall()


def push_prices_batch(service, merchant_id, google_ids, price):
    """
    One Content API products.custombatch call covering every google_id — price and salePrice both set to the new Shopify
    price, GBP (mirrors price_update.py's per-item body). batchId is just the list index; the response echoes it back so we
    can map each result to its google_id regardless of the order Google returns them in.
    """
    entries = [
        {
            "batchId": i,
            "merchantId": merchant_id,
            "method": "update",
            "productId": f"online:en:GB:{google_id}",
            "product": {
                "price": {"value": price, "currency": "GBP"},
                "salePrice": {"value": price, "currency": "GBP"},
            },
        }
        for i, google_id in enumerate(google_ids)
    ]
    return service.products().custombatch(body={"entries": entries}).execute()


def main():
    if len(sys.argv) != 2:
        fail("BAD_ARGS", "Usage: push_google_price.py <GROUPID>")

    groupid = sys.argv[1].strip().upper()
    if not groupid:
        fail("BAD_ARGS", "GROUPID is empty")

    load_dotenv(SERVER_ENV)

    conn = get_db_connection()
    try:
        targets = fetch_targets(conn, groupid)
    finally:
        conn.close()

    if not targets:
        # Nothing eligible (not live on Google, no sizes, or no googleid assigned yet) — not an error, just nothing to push.
        print(json.dumps({"groupid": groupid, "updated": 0, "failed": 0, "total": 0, "errors": []}))
        return

    # All rows share the same skusummary.shopifyprice (it's a per-groupid, not per-size, column) — take the first valid one.
    price = None
    for _, shopifyprice in targets:
        try:
            price = f"{float(shopifyprice):.2f}"
            break
        except (TypeError, ValueError):
            continue
    if price is None:
        fail("INVALID_PRICE", f"shopifyprice for {groupid} is not numeric")

    service, merchant_id = get_google_service()

    google_ids = [google_id for google_id, _ in targets]
    try:
        response = push_prices_batch(service, merchant_id, google_ids, price)
    except Exception as e:
        # The batch REQUEST itself failed (auth/network/schema issue) — none of the entries were attempted.
        fail("GOOGLE_PUSH_FAILED", f"Content API batch request failed: {e}")

    updated = 0
    errors = []
    for entry in response.get("entries", []):
        google_id = google_ids[entry["batchId"]] if 0 <= entry.get("batchId", -1) < len(google_ids) else "?"
        if "errors" in entry:
            errors.append(f"{google_id}: {entry['errors'].get('message', 'unknown error')}")
        else:
            updated += 1

    print(json.dumps({
        "groupid": groupid,
        "updated": updated,
        "failed": len(errors),
        "total": len(targets),
        "errors": errors[:MAX_ERRORS_RETURNED],
    }))


if __name__ == "__main__":
    main()
