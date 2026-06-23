# Clickable Address (Maps) + FMCSA SAFER Link — Design

**Date:** 2026-06-22
**Tracker:** ADDR1 + CP3
**Repo:** `zoho-widget-host` (widget-only — no backend, no API key, no billing)
**Status:** Design approved by Tom 2026-06-22

## Problem

Two small quality-of-life links on the broker portal:
- **ADDR1:** a carrier's / shipper's stored address should be a clickable link that opens Google Maps.
- **CP3:** the carrier profile should have a one-click link to look the carrier up on FMCSA (by USDOT).

## Goals / Non-goals

**Goals:** Add the two links using data the widgets already have. Open in a new tab. Degrade gracefully when the data is missing (plain text / no link, never a broken/dead link).

**Non-goals:** No PO-box / address-validation logic (that's ADDR2, gated on enabling the Google Address Validation API — separate). No backend changes. No new shared module.

## ADDR1 — clickable Google Maps address

**URL:** `https://www.google.com/maps/search/?api=1&query=` + `encodeURIComponent(<address string>)`. This is Google's documented, key-free Maps search deep-link; it opens the Maps app on mobile and maps.google.com on desktop.

**Address string:** join the address parts the widget already renders, comma-separated, skipping blanks: `"<line1> <line2>, <city>, <state> <zip>"`. Each widget has slightly different field names (read the existing address render in each):
- `carrier-profile.html` — uses `address` / `address_city` / `address_state` (physical address block).
- `view-vendors.html` — uses `address_line_1`/`address_line_2` + city/state/zip.
- `customer-approvals.html` — uses `address_line_1`/`address_line_2` + city/state/zip.

**Placement (all three):** wrap the **already-displayed** address text in an anchor — don't add a new row, just make the existing address a link. `<a href="<maps url>" target="_blank" rel="noopener">`.

**Graceful degradation:** if there's no usable address (no street line AND no city), render the address text exactly as today with NO link. Never emit a link whose query is empty/just a comma.

**DRY:** each file gets a tiny local helper `mapsHref(parts)` (build + encode the query, return "" when there's nothing usable); the render wraps in a link only when `mapsHref` is non-empty. A 5-line helper per file is simpler than wiring a shared module into all three; don't add a shared script.

## CP3 — FMCSA SAFER company snapshot link

**URL (verified live, deep-links by USDOT):**
`https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=` + `encodeURIComponent(<dot>)`.
(Confirmed 2026-06-22: opens the carrier's SAFER snapshot by DOT — the MOTUS URL from the tracker did not deep-link, so SAFER is used instead.)

**Placement:** `carrier-profile.html` only, in the header / Authority & Operating History section (near where the DOT is shown). A small link/button labeled e.g. "View on FMCSA SAFER", `target="_blank" rel="noopener"`.

**Field:** the carrier's USDOT (the page already has it — `USDOT` / the DOT shown on the profile). **Hidden entirely when there's no DOT on file** (same gap as OB3/MOTUS-style links — no DOT, no link).

## Security

- URL params built with `encodeURIComponent`; any address/DOT text rendered into the DOM stays `esc()`'d as it is today (we only wrap existing text in an anchor — don't introduce an unescaped sink).
- All links `target="_blank" rel="noopener"`.

## Testing (jsdom, `test/*.test.mjs`)

- ADDR1 per widget: with a full address → an anchor whose href contains `google.com/maps` and the url-encoded address; with no street+city → plain text, no anchor.
- CP3: with a DOT → a "FMCSA SAFER" anchor whose href contains `safer.fmcsa.dot.gov` + the DOT; with no DOT → no anchor.

## Sequencing
1. ADDR1 in carrier-profile.html (+ test).
2. ADDR1 in view-vendors.html (+ test).
3. ADDR1 in customer-approvals.html (+ test).
4. CP3 SAFER link in carrier-profile.html (+ test).
5. Review, merge, `?v=` bump (Carrier Profile, View Vendors, Customer Approvals embeds), QA.

## Decisions (Tom 2026-06-22)
- ADDR1 on all three panes (carrier profile + View Vendors + Customer Approvals). CP3 via FMCSA SAFER (MOTUS URL didn't deep-link). Missing address → plain text; missing DOT → no SAFER link.
