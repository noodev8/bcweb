# DPD Local API — handover notes (throwaway, 2026-11-19)

Goal: book DPD parcels and print labels from BCWEB, built into the AMZ Shipment page area.
Spec: `docs/DPD Local API Domestic Specification v3.2.pdf`.

## Proven so far (scratch node scripts, nothing built yet)
- **Login** works: `POST https://api.dpdlocal.co.uk/user/?action=login`, header
  `Authorization: Basic base64(DPD_USERNAME:DPD_PASSWORD)` → `data.geoSession`.
- Every other call sends `GeoClient: account/<DPD_ACCOUNT>`, `GeoSession: <session>`, `Accept: application/json`.
- **Services** `GET /shipping/network/?...` works — collection AND delivery postcode are mandatory.
  Account has the full domestic list; default candidate `2^12` Parcel Next Day (also By 12 `2^13`,
  By 1030 `2^08`, Sat/Sun, Expak, Freight, Ship to Shop `2^91`, Return to Shop `2^22`).
- **Insert shipment dry run** `POST /shipping/shipment?test=true` with the PDF's example body
  (our address both ends, 1 kg, `2^12`) → `{"error":null,"data":{"shipmentId":null}}` = valid, nothing booked.
- Without `?test=true` it books a REAL consignment (no DPD test environment). Billing only happens
  if the parcel enters the network; void unwanted ones in MyDPD.

## .env (bcweb-server)
`DPD_USERNAME, DPD_PASSWORD, DPD_ACCOUNT, DPD_COLLECT_ORG, DPD_COLLECT_STREET, DPD_COLLECT_TOWN,
DPD_COLLECT_POSTCODE, DPD_COLLECT_PHONE`.
**Landmine:** never name them plain `username`/`password` — on Windows `process.env.username` is the
Windows user (env is case-insensitive and dotenv doesn't override), giving a 401.

## Labels / printer
- `GET /shipping/shipment/{shipmentId}/label/` with `Accept:` `text/vnd.citizen-clp`,
  `text/vnd.eltron-epl` or `text/html` (A4 only — never thermal, scaling fails sign-off).
- Printer at the unit: **TSC DA200** (4", direct thermal; ≥102 mm wide required, 105 advised). It is not
  Citizen; try EPL first — untested whether it prints raw EPL. A browser can't send raw printer
  strings, so this needs a print helper on the dispatch PC or a raw-capable driver.
- **Sign-off:** before live use DPD wants a test pack (labels BCWEB produced + the shipment JSON),
  ~48 h feedback, then one final pack with live details. MyDPD dispatching does NOT count.

## Decisions (owner, 2026-11-19) — Amazon shipments first
Booking starts from an AMZ Shipment booked with **our own DPD** (Amazon's DPD prints its own labels — none of this applies).
1. **Its own button** ("Book DPD") on the booked notice, after Confirm — not inside Confirm (for now).
2. **Parcel Next Day `2^12`**, always. One consignment: delivery = Amazon's warehouse (`getShipment` destination),
   `numberOfParcels` = box count, `totalWeight` = the boxes' kg from `amzshipment`, `shippingRef1` = FBA15 id.
3. **DPD labels print on the DPD printer (TSC DA200), NEVER the Zebra.** Raw printer string (EPL first) through QZ Tray, which
   already runs on the dispatch PC — untested whether the TSC takes EPL.
4. **Tracking goes to Amazon straight away** after booking (`updateShipmentTrackingDetails`, box U00000n → DPD parcel n).
   Amazon then holds the numbers, so nothing new is stored (no new table); the consignment number also goes in the bclog line.
5. **Collections: not now.**

Still to prove: one real label (to our own address, void in MyDPD) for the print test and DPD's sign-off pack.

Not in this spec: tracking, cancel/void, collections — ask DPD Customer Integration for those.
