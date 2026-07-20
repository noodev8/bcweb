"""
ONE-OFF setup: create the API-type SUPPLEMENTAL product data source used by push_google_price.py.

The Merchant API can only write productInputs into a data source, and it cannot write to our primary
SFTP feed. So we create one dedicated API supplemental data source; push_google_price.py then writes
price-only overrides into it after each Shopify Apply. Run this ONCE, then copy the printed data source
id into bcweb-server/.env as GOOGLE_SUPPLEMENTAL_DATASOURCE.

Leaving feed_label / content_language UNSET on the SupplementalProductDataSource makes it apply to ALL
(feedLabel, contentLanguage) combinations (per Google's sample) — fine for our single en/GB feed and
future-proof if a label is ever added.

Reuses the SAME service-account credential as the price push (bcweb-server/.env). The "Merchant API" must
be enabled in the Cloud project and the service account must be a user on the Merchant Center account
(it already is — it has been pushing prices via the Content API).

Idempotency: this does NOT check for an existing source — running it twice creates two. Run once; if you
must re-run, delete the old one first (Merchant Center → Data sources, or the delete_data_source sample).

Usage:
    python create_supplemental_datasource.py
"""

import os
import sys
import json

from dotenv import load_dotenv
from google.oauth2 import service_account
from google.shopping import merchant_datasources_v1

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_ENV = os.path.join(SCRIPT_DIR, "..", "..", ".env")
GOOGLE_SCOPES = ["https://www.googleapis.com/auth/content"]

DISPLAY_NAME = "bcweb instant price override (Merchant API)"


def main():
    load_dotenv(SERVER_ENV)

    merchant_id = os.environ.get("GOOGLE_MERCHANT_ID", "").strip()
    creds_json = os.environ.get("GOOGLE_MERCHANT_CREDENTIALS_JSON", "").strip()
    if not merchant_id or not creds_json:
        print("ERROR: GOOGLE_MERCHANT_ID / GOOGLE_MERCHANT_CREDENTIALS_JSON missing from .env", file=sys.stderr)
        sys.exit(1)

    credentials = service_account.Credentials.from_service_account_info(json.loads(creds_json), scopes=GOOGLE_SCOPES)
    client = merchant_datasources_v1.DataSourcesServiceClient(credentials=credentials)

    data_source = merchant_datasources_v1.DataSource()
    data_source.display_name = DISPLAY_NAME
    data_source.supplemental_product_data_source = merchant_datasources_v1.SupplementalProductDataSource()

    request = merchant_datasources_v1.CreateDataSourceRequest(
        parent=f"accounts/{merchant_id}",
        data_source=data_source,
    )

    response = client.create_data_source(request=request)
    # response.name looks like: accounts/{account}/dataSources/{datasource_id}
    datasource_id = response.name.rsplit("/", 1)[-1]
    print("Supplemental data source created.")
    print(f"  resource name : {response.name}")
    print(f"  datasource id : {datasource_id}")
    print()
    print("Add this line to bcweb-server/.env:")
    print(f"  GOOGLE_SUPPLEMENTAL_DATASOURCE={datasource_id}")


if __name__ == "__main__":
    main()
