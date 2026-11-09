# Brookfield Comfort — Security Incident Response Plan

Covers Amazon information received through the Selling Partner API (SP-API) and any other customer or
business data held in BCWEB (the internal platform: `bcweb-server` on our VPS, its PostgreSQL database
`brookfield_prod`, and the `bcweb-web` front end on Vercel behind the app login).

Adopted: 2026-11-09 · Next review: 2027-05-09 (every 6 months)

## 1. Roles

| Role | Person | Responsibility |
|---|---|---|
| Incident lead | Andreas Andreou (owner) — brookfieldcomfort@gmail.com, +44 7818 443886 | Decides an incident has happened, runs every step below, reports to Amazon, keeps the record |
| Staff user | Summer | Reports anything suspicious to the incident lead at once; does not try to fix it alone |

There are two staff users. Each has their own BCWEB login. Logins and passwords are never shared.

## 2. What counts as an incident

Report it straight away, even if you are unsure. Examples:

- someone other than staff using BCWEB, Seller Central, the server or the database, or a login we don't recognise;
- an SP-API credential (LWA client ID / secret, refresh token) or any `.env` secret seen anywhere it shouldn't be: an email, a chat, a screenshot, a public repository;
- unexpected price, listing or stock changes on Amazon that no one in the team made;
- a lost or stolen laptop or phone that has staff logins on it;
- the server, database or a backup copied, exposed or reachable from outside when it shouldn't be;
- a warning from Amazon, our hosting provider, Google or Shopify about suspicious activity.

## 3. Steps — within the first hours

1. **Contain.**
   - Revoke the app's access in Seller Central (Apps and Services → Manage Your Apps → remove the authorisation) so the refresh token stops working.
   - Rotate the LWA client secret in the Solution Provider Portal.
   - Change the passwords of any affected login (Seller Central, BCWEB, server, database), and change `JWT_SECRET` in the server `.env` so every BCWEB session is signed out.
   - If the server is affected, stop the API (PM2) until it is checked.
2. **Assess.** Check the server's API log (every route call is logged), `bclog` (every write, with the user and time), the database's recent changes, and Seller Central's own logs. Write down what was reached, when, and by whom.
3. **Report to Amazon.** Email **security@amazon.com within 24 hours of detection** if Amazon information may be involved, even if the facts are not all known yet. Say what happened, when it was found, what data may be affected and what has been done. Send updates as more is learned.
4. **Tell others who need to know**: affected customers, and the ICO within 72 hours if personal data is involved (UK GDPR).
5. **Recover.** Put fresh credentials into `.env` on the server, re-authorise the app, restart the API, and check that it works and that nothing unexpected changed.
6. **Learn.** Within a week, write up what happened and what was changed so it doesn't happen again. Add it to the incident record below.

## 4. Everyday controls that support this plan

- Amazon information is stored only in our own database on our own server. It is used only by our staff, and nothing is shared with outside parties.
- Secrets (API keys, tokens, database passwords) live only in `.env` files on the server and the development PC. They are never committed to git, hard-coded in code, or sent in email or chat.
- All traffic is encrypted in transit (HTTPS / TLS).
- Every staff login uses a long, unique password, and two-step verification is on wherever the service offers it (Seller Central, Google, Shopify). Passwords are changed at least once a year and straight away if exposed.
- We request no buyer personal information (no restricted SP-API roles).
- The API keeps a log of every call, and every write records who made it.

## 5. Review

The incident lead reviews this plan every 6 months, and after any incident, and updates the date at the top.

| Date | Reviewed by | Changes |
|---|---|---|
| 2026-11-09 | Andreas | Plan adopted |

## 6. Incident record

| Date found | What happened | Reported to Amazon (date) | Actions taken |
|---|---|---|---|
| — | none so far | — | — |
