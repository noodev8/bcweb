"""
Google Merchant Center price push — single GROUPID, on-demand (server helper). MERCHANT API version.

Mirrors the old Content-API-for-Shopping helper, rewritten for the new **Merchant API** because the
Content API for Shopping is discontinued on 2026-08-18. Same job: right after a Shopify Pricing "Apply"
(W1), push ONE product's new price to Google Merchant Center immediately so Google Shopping/ads don't
keep showing the old price until the next nightly C:\\scripts\\merchant-feed\\merchant_feed.py --upload
run (the full-feed SFTP upload — which is NOT affected by the Content API shutdown and still runs at 3:30am).

WHY A SUPPLEMENTAL DATA SOURCE:
The Merchant API split products into read-only *processed products* and writable *productInputs*, and every
productInput must belong to a data source. Our primary product data lands via the nightly SFTP feed, which
the API cannot write to. So this helper writes a *price-only override* into a dedicated API-type SUPPLEMENTAL
data source (created once by create_supplemental_datasource.py). The supplemental value overlays the primary
feed's price until the next nightly feed re-asserts it — exactly the old behaviour. Set env
GOOGLE_SUPPLEMENTAL_DATASOURCE to that data source's id (or full resource name).

A groupid maps to MULTIPLE Google offer ids (skumap.googleid, one per size/variant). The old code sent them
in one Content API products.custombatch call. The Merchant API has no custombatch, so we fire the per-offer
productInputs.insert calls CONCURRENTLY (ThreadPoolExecutor) to keep an Apply snappy. Per-offer failures are
collected in the summary rather than failing the whole run (one bad offer shouldn't block a style's other sizes).

Auth reuses the SAME service-account credential and content scope as before (the account is already a user on
the Merchant Center). NOTE: the "Merchant API" must be enabled in the Cloud project (separate from the old
"Content API for Shopping").

Loads DB creds + the Google service-account JSON from the SERVER's .env (bcweb-server/.env). Prints a
machine-readable JSON summary to stdout for the Node route; on any failure before per-item processing starts it
prints {"error": "<CODE>", "message": "..."} and exits non-zero. The stdout contract is IDENTICAL to the old
helper, so utils/googleMerchant.js is unchanged.

Usage:
    python push_google_price.py <GROUPID>

Exit codes: 0 = success (JSON summary on stdout, may list per-item errors); non-zero = failure before any push
was attempted (JSON error on stdout).
"""

import os
import sys
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
from dotenv import load_dotenv
from google.oauth2 import service_account
from google.shopping import merchant_products_v1
from google.shopping.type import Price

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_ENV = os.path.join(SCRIPT_DIR, "..", "..", ".env")

# Same scope as the old Content API helper — it carries over to the Merchant API unchanged.
GOOGLE_SCOPES = ["https://www.googleapis.com/auth/content"]

# The primary SFTP feed presents products as online:en:GB:<googleid>, i.e. content_language "en", feed_label "GB".
# The supplemental override MUST match on (offer_id, content_language, feed_label) to overlay the right product.
# Overridable via .env in case the feed's language/label ever change.
CONTENT_LANGUAGE = os.environ.get("GOOGLE_CONTENT_LANGUAGE", "en")
FEED_LABEL = os.environ.get("GOOGLE_FEED_LABEL", "GB")

# Cap on how many per-item errors we echo back — keeps stdout sane if something is very wrong.
MAX_ERRORS_RETURNED = 10

# How many productInputs.insert calls to run at once (the Merchant API has no custombatch).
MAX_CONCURRENCY = 8


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


def get_merchant_config():
    """Read merchant id, service-account creds and the supplemental data source id from .env. Returns (credentials, parent, data_source_name)."""
    merchant_id = os.environ.get("GOOGLE_MERCHANT_ID", "").strip()
    creds_json = os.environ.get("GOOGLE_MERCHANT_CREDENTIALS_JSON", "").strip()
    datasource = os.environ.get("GOOGLE_SUPPLEMENTAL_DATASOURCE", "").strip()
    if not merchant_id or not creds_json:
        fail("GOOGLE_NOT_CONFIGURED", "GOOGLE_MERCHANT_ID / GOOGLE_MERCHANT_CREDENTIALS_JSON missing from .env")
    if not datasource:
        fail("GOOGLE_NOT_CONFIGURED", "GOOGLE_SUPPLEMENTAL_DATASOURCE missing from .env (run create_supplemental_datasource.py once)")
    try:
        info = json.loads(creds_json)
    except Exception as e:
        fail("GOOGLE_NOT_CONFIGURED", f"GOOGLE_MERCHANT_CREDENTIALS_JSON is not valid JSON: {e}")
    try:
        credentials = service_account.Credentials.from_service_account_info(info, scopes=GOOGLE_SCOPES)
    except Exception as e:
        fail("GOOGLE_AUTH_FAILED", f"Could not build service-account credentials: {e}")

    parent = f"accounts/{merchant_id}"
    # Accept either a bare id or an already-qualified "accounts/.../dataSources/..." resource name.
    if datasource.startswith("accounts/"):
        data_source_name = datasource
    else:
        data_source_name = f"{parent}/dataSources/{datasource}"
    return credentials, parent, data_source_name


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


def build_price(price_str):
    """A Merchant API Price for the given 2dp price string, in GBP micros (amount_micros = value * 1,000,000)."""
    price = Price()
    price.amount_micros = round(float(price_str) * 1_000_000)
    price.currency_code = "GBP"
    return price


def insert_price_override(client, parent, data_source_name, offer_id, price_str):
    """
    Insert a price-only supplemental override for one offer_id. We set ONLY price + sale_price (mirrors the old
    helper feeding price=sale_price=shopifyprice) — a supplemental input overlays just the attributes it carries,
    leaving the primary feed's title/availability/etc. untouched. Returns None on success or an error string.
    """
    try:
        price = build_price(price_str)
        attributes = merchant_products_v1.ProductAttributes()
        attributes.price = price
        attributes.sale_price = price

        product_input = merchant_products_v1.ProductInput(
            content_language=CONTENT_LANGUAGE,
            feed_label=FEED_LABEL,
            offer_id=offer_id,
            product_attributes=attributes,
        )
        request = merchant_products_v1.InsertProductInputRequest(
            parent=parent,
            product_input=product_input,
            data_source=data_source_name,
        )
        client.insert_product_input(request=request)
        return None
    except Exception as e:  # per-item failure — collected, not fatal
        return f"{offer_id}: {e}"


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
    price_str = None
    for _, shopifyprice in targets:
        try:
            price_str = f"{float(shopifyprice):.2f}"
            break
        except (TypeError, ValueError):
            continue
    if price_str is None:
        fail("INVALID_PRICE", f"shopifyprice for {groupid} is not numeric")

    credentials, parent, data_source_name = get_merchant_config()

    try:
        client = merchant_products_v1.ProductInputsServiceClient(credentials=credentials)
    except Exception as e:
        fail("GOOGLE_AUTH_FAILED", f"Could not initialise Merchant API client: {e}")

    offer_ids = [googleid for googleid, _ in targets]

    # No custombatch in the Merchant API — fire the per-offer inserts concurrently to keep an Apply snappy.
    errors = []
    updated = 0
    with ThreadPoolExecutor(max_workers=min(MAX_CONCURRENCY, len(offer_ids))) as pool:
        futures = [
            pool.submit(insert_price_override, client, parent, data_source_name, offer_id, price_str)
            for offer_id in offer_ids
        ]
        for fut in as_completed(futures):
            err = fut.result()
            if err:
                errors.append(err)
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
