"""
ONE-OFF setup (MUST be run by a HUMAN account owner, not the service account).

The Merchant API refuses ALL calls from a GCP project until that project is registered with the merchant
account once (developerRegistration:registerGcp). Google does NOT allow a service account to do this — it
explicitly requires a human user account (confirmed by a live 403: "GCP registration is not allowed for
service accounts"). So this script signs you in via a one-time browser consent (OAuth installed-app flow)
and registers as YOU, then the service-account scripts work from there on.

PREREQUISITES (one time, in the Google Cloud console for project merchant-feed-api-462809):
  1. Enable the "Merchant API" (APIs & Services → Library → search "Merchant API" → Enable).
  2. Create an OAuth client:  APIs & Services → Credentials → Create credentials → OAuth client ID →
     Application type "Desktop app". Download its JSON.
  3. Save that JSON next to this script as `client_secret.json` (or set OAUTH_CLIENT_SECRET to its path).
  4. If the OAuth consent screen is in "Testing", add brookfieldcomfort@gmail.com as a test user.

RUN:
    python register_gcp.py
  A browser opens — sign in as the Merchant Center admin (brookfieldcomfort@gmail.com) and allow.
  Then wait ~5 minutes and run create_supplemental_datasource.py (service account is fine from here on).

Reads GOOGLE_MERCHANT_ID from bcweb-server/.env. developer_email defaults to the account owner; override
with DEVELOPER_EMAIL in .env.
"""

import os
import sys

from dotenv import load_dotenv
from google_auth_oauthlib.flow import InstalledAppFlow
from google.shopping import merchant_accounts_v1

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_ENV = os.path.join(SCRIPT_DIR, "..", "..", ".env")
GOOGLE_SCOPES = ["https://www.googleapis.com/auth/content"]
DEFAULT_DEVELOPER_EMAIL = "brookfieldcomfort@gmail.com"
DEFAULT_CLIENT_SECRET = os.path.join(SCRIPT_DIR, "client_secret.json")


def main():
    load_dotenv(SERVER_ENV)
    merchant_id = os.environ.get("GOOGLE_MERCHANT_ID", "").strip()
    developer_email = os.environ.get("DEVELOPER_EMAIL", DEFAULT_DEVELOPER_EMAIL).strip()
    client_secret = os.environ.get("OAUTH_CLIENT_SECRET", DEFAULT_CLIENT_SECRET)
    if not merchant_id:
        print("ERROR: GOOGLE_MERCHANT_ID missing from .env", file=sys.stderr)
        sys.exit(1)
    if not os.path.isfile(client_secret):
        print(f"ERROR: OAuth client secret not found at {client_secret}\n"
              "Create a Desktop OAuth client in the Cloud console and save its JSON there "
              "(see this file's header).", file=sys.stderr)
        sys.exit(1)

    # One-time browser consent as the human admin -> user credentials (NOT the service account).
    flow = InstalledAppFlow.from_client_secrets_file(client_secret, scopes=GOOGLE_SCOPES)
    credentials = flow.run_local_server(port=0)

    client = merchant_accounts_v1.DeveloperRegistrationServiceClient(credentials=credentials)
    request = merchant_accounts_v1.RegisterGcpRequest(
        name=f"accounts/{merchant_id}/developerRegistration",
        developer_email=developer_email,
    )
    response = client.register_gcp(request=request)
    print("GCP project registered with the merchant account.")
    print(f"  response: {response}")
    print("Wait ~5 minutes, then run: python create_supplemental_datasource.py")


if __name__ == "__main__":
    main()
