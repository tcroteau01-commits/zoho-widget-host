#!/usr/bin/env python3
"""CREDITAPP3 Task 8 -- drive the REAL Customer Approvals pane (not source
inspection, not the jsdom suite) to confirm the supplemental-references
feature actually renders, the way CREDITAPP2 Task 8's recovery-actions
check does for that feature.

WHY A THIRD CHECK, ON TOP OF THE JSDOM SUITE:
customer-approvals-credit-app-supplement.test.mjs (Task 7) already proves
every function's OUTPUT string is correct in isolation -- caAppOrderedParties
sorts trade4 after bank, caAppRowHtml embeds "Added after signing", showIdentity
gates who-asked. None of that proves the browser ever PAINTS it: CREDITAPP1's
own two shipped defects (a step impossible to submit, and a literal
"[object Object]" on screen) were both invisible to markup assertions and both
needed a rendered page to catch. CREDITAPP3 has already produced eight tests
that passed against both a bug and its fix (see this task's brief) -- another
markup-only test would make nine.

Reuses test/customer-approvals-credit-app-capture.py exactly the way
customer-approvals-credit-app-recovery-check.py does: `record`, `party`,
`install_routes`, `HTML_PATH`, `BROKER_API_BASE`, `DESKTOP` are that module's
own helpers, loaded via importlib because the filename carries hyphens. No
second harness -- see that file's own docstring for why one isn't warranted
here either (this pane has no Flask route to boot; it is a static Zoho
Creator widget file this repo already knows how to drive with Playwright +
page.route stubs, no server involved).

What this check drives and confirms, against the real rendered DOM:
  1. a trade4 party renders at all -- the defect this task exists for; a
     stale five-slot table/list would filter it out with no error;
  2. display order puts bank ahead of the supplementals on screen, even
     though storage order (credit_app_store.SLOTS) puts trade4+ right after
     bank for an unrelated reason (index stability);
  3. a supplemental row (trade4) carries its "Added after signing (not on
     the signed PDF)" note, and none of the canonical five rows do;
  4. the "Ask customer for more references" control POSTs a real
     /credit-app/request-references call (real click, real fetch, stubbed
     network response) and the pane actually re-renders from the refreshed
     payload -- proven by asserting the banner shows a DIFFERENT reason/count
     after the POST than it showed before, not just an optimistic "Sent to
     the customer" toast;
  5. a broker viewer never sees risk detail on a supplemental reference:
     #ca-app-staff-section is entirely absent from a broker's DOM (same
     allClients gate CREDITAPP2's own recovery check already verified for
     Correct address / Waive), and a risk-signal marker planted only in the
     staff-only /credit-app/risk payload never appears anywhere in the
     broker's rendered panel;
  6. no rendered text anywhere in the open panel contains "[object Object]".

THE GAP THIS CLOSES FROM TASK 7: that task's own fixture (SIX_REFERENCES in
customer-approvals-credit-app-capture.py) has its one supplement_requests
entry at status "completed" -- by design, since a completed request is what
put trade4/trade5 on the tracker in the first place -- so the OPEN ("sent")
banner, its date, and the two staff-only lines (who asked, and a prior send
failure) never appeared in any screenshot or real-browser check. This file's
fixture starts with an OPEN request from the very first page load (see
STATUS_PAYLOAD / RISK_PAYLOAD below) specifically to drive that state for
real, in both viewer types:
  * the SHARED tracker banner (#ca-app-supplement, fed by /credit-app/status)
    shows count/date/reason to BOTH viewers, and NEITHER "Asked by ..." NOR
    "Send failed ..." -- that banner's renderer (caAppSupplementSectionHtml)
    passes showIdentity=false unconditionally, a structural guard rather than
    a bet that the broker payload happens to omit those keys;
  * the STAFF-ONLY Full Submission block (#ca-app-staff-body, fed by
    /credit-app/risk, present only when allClients is true) additionally
    shows "Asked by ops@operfi.com (operfi)" and "Send failed ... Could not
    obtain a Graph token." -- the two facts Task 7 recorded server-side
    (Task 5's record_supplement_send_failure) and rendered client-side (Task
    7 fix round 1) but never actually painted in a browser until this check.

Verified to FAIL against the pre-Task-7 markup (commit c6bd642's parent,
8df7672, this repo) -- see task-8-report.md for the exact command and output.
That revision has no #ca-app-supplement element at all and filters trade4
out of caAppOrderedParties with no error, so a customer's fourth reference
answer is silently invisible to the broker who is supposed to review it.

Not collected by pytest -- run directly:
    python test/customer-approvals-credit-app-supplement-check.py
"""
import importlib.util
import json
import os
import pathlib
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# customer-approvals-credit-app-capture.py -- hyphens in the filename, so a
# plain `import` can't reach it; loaded the same way its own functions/
# constants (record, party, install_routes, HTML_PATH, BROKER_API_BASE,
# DESKTOP) are meant to be reused elsewhere (see
# customer-approvals-credit-app-recovery-check.py, the model for this file).
_CAP_PATH = os.path.join(HERE, "customer-approvals-credit-app-capture.py")
_spec = importlib.util.spec_from_file_location("ca_capture", _CAP_PATH)
cap = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cap)

from playwright.sync_api import sync_playwright                    # noqa: E402

failures = []


def check(condition, message):
    if not condition:
        failures.append(message)


# ── Fixture ──────────────────────────────────────────────────────────────
# Six parties (the canonical five, all answered or in flight, plus a
# supplemental trade4), and ONE open ("sent") supplement request from the
# very first load -- the exact state Task 7's own fixture never exercised.

RISK_MARKER = "MERIDIAN-RISK-DETAIL-9F3K"  # planted only in the staff payload

# /credit-app/status -- what BOTH broker and staff receive (same endpoint,
# no identity fields ever, per _supplement_request_entry's include_identity
# split server-side).
STATUS_PAYLOAD = {
    "status": "references_pending",
    "parties": [
        cap.party("customer", "Alicia Byrne", "Redstone Beverage Co", "completed"),
        cap.party("trade1", "Steve Alvarez", "ABC Produce", "completed"),
        cap.party("trade2", "Mia Tran", "Delta Foods", "completed"),
        cap.party("trade3", "Ron Diaz", "Vista Cold", "sent", waiting_days=4),
        cap.party("bank", "Bank Officer Test", "Test Bank", "completed"),
        cap.party("trade4", "Priya Shah", "Meridian Wholesale", "sent", waiting_days=2),
    ],
    "supplement_requests": [
        {"id": "req1", "count": 1, "reason": "Trade 1 and 3 were thin on volume history",
         "status": "sent", "at": "2026-09-25T14:30:00", "completed_at": None,
         "slots_created": []},
    ],
}

# The reason/count a REAL click on Send will actually POST -- used both to
# drive the click and to prove the pane re-rendered from a genuinely
# refreshed payload afterward (not just an optimistic toast).
NEW_COUNT = 2
NEW_REASON = "Need one more for a fresh account, per underwriting"

STATUS_PAYLOAD_AFTER_ASK = json.loads(json.dumps(STATUS_PAYLOAD))
STATUS_PAYLOAD_AFTER_ASK["supplement_requests"] = [
    {"id": "req2", "count": NEW_COUNT, "reason": NEW_REASON, "status": "sent",
     "at": "2026-09-25T16:00:00", "completed_at": None, "slots_created": []},
]

# /credit-app/risk -- staff only. Same open request, PLUS the two staff-only
# facts: who asked, and a prior send failure. Also carries trade4's own risk
# assessment (RISK_MARKER) -- the fact a broker must never see anywhere.
RISK_PAYLOAD = {
    "status": "references_pending",
    "customer_verification": None,
    "application": {
        "company": {"name": "REDSTONE BEVERAGE CO"},
        "billing": {}, "credit": {}, "owners": [], "bank": {}, "references": [],
        "signer": {},
    },
    "parties": [
        {"slot": "trade4", "company": "Meridian Wholesale", "name": "Priya Shah",
         "status": "sent", "waiting_days": 2, "response": None,
         "risk": {"level": "high", "signals": [
             {"code": "new_reference_no_history", "detail": RISK_MARKER},
         ]},
         "address_risk": None},
    ],
    "supplement_requests": [
        {"id": "req1", "count": 1, "reason": "Trade 1 and 3 were thin on volume history",
         "status": "sent", "at": "2026-09-25T14:30:00", "completed_at": None,
         "slots_created": [], "requested_by": "ops@operfi.com",
         "requested_by_role": "operfi",
         "send_error": {"detail": "Could not obtain a Graph token.",
                        "at": "2026-09-25T15:00:00+00:00"}},
    ],
    "correction_count": 0,
    "pdf": {"exists": False, "retrieval_path": "/credit-app/pdf?submission_id=9001"},
}
RISK_PAYLOAD_AFTER_ASK = json.loads(json.dumps(RISK_PAYLOAD))
RISK_PAYLOAD_AFTER_ASK["supplement_requests"] = [
    {"id": "req2", "count": NEW_COUNT, "reason": NEW_REASON, "status": "sent",
     "at": "2026-09-25T16:00:00", "completed_at": None, "slots_created": [],
     "requested_by": "ops@operfi.com", "requested_by_role": "operfi",
     "send_error": None},
]

# Mutated by the request-references stub once the real POST fires, so the
# follow-on caAppRefreshPane fetches (a REAL consequence of the REAL route,
# not scripted here) see the post-ask state.
state = {"asked": False}
posted = {}


def install_supplement_routes(page, all_clients):
    rec = cap.record(**{"Credit_Decision": "Credit App Rec'd - Pending Review"})

    def status_payload():
        return STATUS_PAYLOAD_AFTER_ASK if state["asked"] else STATUS_PAYLOAD

    def risk_payload():
        return RISK_PAYLOAD_AFTER_ASK if state["asked"] else RISK_PAYLOAD

    # Base install_routes from the existing capture harness -- Zoho SDK stub,
    # /broker-report, /credit-app/application (unused here, 404 -> stays
    # hidden), /customer-events*. Passing plain dict payloads here would
    # freeze the response at install time; the ask-flow needs status/risk to
    # answer DIFFERENTLY after the real POST lands, so those two routes are
    # re-registered below, AFTER this one, which Playwright gives priority
    # (most-recently-registered matches first, falling back to this one for
    # everything else -- same pattern customer-approvals-credit-app-
    # recovery-check.py already uses for correct-address).
    cap.install_routes(page, rec, STATUS_PAYLOAD, None, all_clients=all_clients,
                       risk_payload=RISK_PAYLOAD if all_clients else None)

    def handler(route):
        req = route.request
        url = req.url
        if url.startswith(cap.BROKER_API_BASE + "/credit-app/status") and \
                not url.startswith(cap.BROKER_API_BASE + "/credit-app/status-bulk"):
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps(status_payload()))
            return
        if url.startswith(cap.BROKER_API_BASE + "/credit-app/risk"):
            if not all_clients:
                route.fulfill(status=403, content_type="application/json",
                              body=json.dumps({"error": "Forbidden"}))
                return
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps(risk_payload()))
            return
        if url.startswith(cap.BROKER_API_BASE + "/credit-app/request-references") and req.method == "POST":
            sent = json.loads(req.post_data or "{}")
            posted.update(sent)
            check(sent.get("count") == NEW_COUNT,
                  "request-references POST did not carry the chosen count: %r" % sent)
            check(sent.get("reason") == NEW_REASON,
                  "request-references POST did not carry the typed reason: %r" % sent)
            state["asked"] = True
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True}))
            return
        route.fallback()

    page.route("**/*", handler)


def open_panel(page, all_clients):
    install_supplement_routes(page, all_clients)
    page.goto(pathlib.Path(cap.HTML_PATH).as_uri())
    page.wait_for_selector(".row", timeout=15000)
    page.click(".row")
    page.wait_for_selector("#panel.show", timeout=15000)
    page.wait_for_function(
        "document.getElementById('ca-app-section')"
        " && document.getElementById('ca-app-section').style.display !== 'none'",
        timeout=15000)
    # Soft wait -- pre-Task-7 markup never grows a trade4 row (it is filtered
    # out) or #ca-app-supplement at all, and this check must FAIL (via the
    # check() list below), not crash, on that markup.
    try:
        page.wait_for_selector('.ca-app-row[data-slot="trade4"]', timeout=5000)
    except Exception:
        page.wait_for_timeout(300)
    if all_clients:
        try:
            page.wait_for_function(
                "document.getElementById('ca-app-staff-section')"
                " && document.getElementById('ca-app-staff-section').style.display !== 'none'",
                timeout=5000)
        except Exception:
            page.wait_for_timeout(300)


# ── 1: trade4 renders at all ────────────────────────────────────────────────

def check_trade4_renders(page, label):
    row = page.locator('.ca-app-row[data-slot="trade4"]')
    check(row.count() > 0,
          "%s: a trade4 party does not render at all -- filtered out, "
          "the exact defect this task exists to catch" % label)


# ── 2: display order -- bank before the supplementals ───────────────────────

def check_display_order(page, label):
    slots = page.eval_on_selector_all(".ca-app-row", "els => els.map(e => e.dataset.slot)")
    check(slots == ["customer", "trade1", "trade2", "trade3", "bank", "trade4"],
          "%s: display order is wrong, expected bank ahead of trade4: %r" % (label, slots))
    if "bank" in slots and "trade4" in slots:
        check(slots.index("bank") < slots.index("trade4"),
              "%s: bank must sort before the supplemental trade4 on screen, even though "
              "storage order (credit_app_store.SLOTS) is reversed: %r" % (label, slots))


# ── 3: the signed-PDF divergence note, only on the supplemental row ─────────

def check_supplemental_note(page, label):
    row = page.locator('.ca-app-row[data-slot="trade4"]')
    text = row.first.inner_text() if row.count() else ""
    check("Added after signing" in text,
          "%s: trade4's row does not carry the 'added after signing' note: %r" % (label, text))
    check("not on the signed PDF" in text,
          "%s: trade4's row does not explain the signed-PDF divergence: %r" % (label, text))
    for slot in ["customer", "trade1", "trade2", "trade3", "bank"]:
        r = page.locator('.ca-app-row[data-slot="%s"]' % slot)
        if r.count():
            t = r.first.inner_text()
            check("Added after signing" not in t,
                  "%s: %s incorrectly carries the supplemental-reference note" % (label, slot))


# ── the shared tracker banner: visible to both, identity to neither ────────

def check_tracker_banner(page, label):
    supplement = page.locator("#ca-app-supplement")
    check(supplement.count() > 0, "%s: #ca-app-supplement not found" % label)
    text = supplement.inner_text() if supplement.count() else ""
    check(re.search(r"Asked for 1 more reference\b", text) is not None,
          "%s: shared tracker banner does not show the open request's count: %r" % (label, text))
    check("2026-09-25 14:30 UTC" in text,
          "%s: shared tracker banner does not show the request date: %r" % (label, text))
    check("Trade 1 and 3 were thin on volume history" in text,
          "%s: shared tracker banner does not show the reason: %r" % (label, text))
    check("Asked by" not in text,
          "%s: the SHARED tracker banner must never show who asked (broker-visible surface): %r"
          % (label, text))
    check("Send failed" not in text,
          "%s: the SHARED tracker banner must never show a send failure (staff-only fact): %r"
          % (label, text))
    ask_btn = page.locator("#ca-app-supplement-ask")
    check(ask_btn.count() > 0,
          "%s: the 'Ask customer for more references' control must be present for every viewer: %r"
          % (label, text))


# ── staff-only Full Submission block: who asked, and the prior send failure ─

def check_staff_full_submission_identity(page):
    body = page.locator("#ca-app-staff-body")
    text = body.inner_text() if body.count() else ""
    # The heading's raw markup, not inner_text() -- .ca-app-doc-head is
    # text-transform: uppercase in CSS, so the rendered text is "SUPPLEMENTAL
    # REFERENCE REQUESTS" even though the source string is mixed case.
    html = body.inner_html() if body.count() else ""
    check("Supplemental Reference Requests" in html,
          "staff Full Submission block does not show the Supplemental Reference Requests "
          "heading: %r" % html)
    check("Asked by ops@operfi.com" in text,
          "staff Full Submission block does not show who asked: %r" % text)
    check("(operfi)" in text,
          "staff Full Submission block does not show the requester's role: %r" % text)
    check("Send failed" in text,
          "staff Full Submission block does not show the prior send failure: %r" % text)
    check("Could not obtain a Graph token." in text,
          "staff Full Submission block's send-failure detail is missing: %r" % text)


def check_staff_sees_trade4_risk(page):
    # Sanity leg for check_broker_no_risk_detail below -- if this fails, the
    # marker never reached the staff DOM at all, and the broker-side "not
    # found" assertion would be meaningless (nothing to have leaked).
    body = page.locator("#ca-app-staff-body")
    text = body.inner_text() if body.count() else ""
    check(RISK_MARKER in text,
          "fixture problem, not the widget: staff viewer does not see trade4's own risk "
          "detail at all, so the broker-absence check below would prove nothing: %r" % text)


# ── 5: a broker sees no risk detail on the new reference, anywhere ─────────

def check_broker_no_risk_detail(page):
    check(page.locator("#ca-app-staff-section").count() == 0,
          "broker viewer's DOM contains #ca-app-staff-section; the Full Submission block "
          "(and every reference's risk detail) must be entirely absent, not merely hidden")
    panel_text = page.locator("#panel").inner_text()
    check(RISK_MARKER not in panel_text,
          "broker viewer's panel renders trade4's staff-only risk detail somewhere -- leak")
    check("Asked by" not in panel_text,
          "broker viewer's panel shows who asked for more references -- identity leak")
    check("Send failed" not in panel_text,
          "broker viewer's panel shows a staff-only send-failure line")


# ── 4: the ask control posts for real, and the pane actually updates ────────

def check_ask_flow_updates_pane(page):
    ask_btn = page.locator("#ca-app-supplement-ask")
    if ask_btn.count() == 0:
        check(False, "no 'Ask customer for more references' control to drive -- the "
                      "request flow cannot be exercised on this markup")
        return
    ask_btn.click()
    page.wait_for_selector("#ca-app-supplement-form", state="visible", timeout=5000)
    page.select_option("#ca-app-supplement-count", str(NEW_COUNT))
    page.fill("#ca-app-supplement-reason", NEW_REASON)
    page.click("#ca-app-supplement-send")

    deadline = time.time() + 8
    while time.time() < deadline and not state["asked"]:
        page.wait_for_timeout(100)
    check(state["asked"] is True, "the request-references route was never actually called")

    # caAppRefreshPane re-fetches status/application/risk for real once the
    # POST resolves -- wait for the SHARED banner to settle on the refreshed
    # payload's new reason, proving a genuine re-render rather than the
    # optimistic "Sent to the customer." toast sitting there unchanged.
    try:
        page.wait_for_function(
            "text => { var e = document.getElementById('ca-app-supplement'); "
            "return !!e && e.innerText.indexOf(text) !== -1; }",
            arg=NEW_REASON, timeout=8000)
    except Exception:
        pass
    supplement_text = page.locator("#ca-app-supplement").inner_text()
    check(NEW_REASON in supplement_text,
          "the pane did not update to the refreshed request after a successful POST -- "
          "still shows the pre-ask banner: %r" % supplement_text)
    check(re.search(r"Asked for %d more references\b" % NEW_COUNT, supplement_text) is not None,
          "the refreshed banner does not show the new count: %r" % supplement_text)


# ── no [object Object] anywhere in the open panel ───────────────────────────

def check_no_object_object(page, label):
    text = page.locator("#panel").inner_text()
    check("[object Object]" not in text,
          "%s: the open panel renders the literal text '[object Object]'" % label)


def main():
    if not os.path.exists(cap.HTML_PATH):
        raise SystemExit("customer-approvals.html not found at " + cap.HTML_PATH)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            # Staff viewer (allClients true) -- everything a broker sees,
            # PLUS the Full Submission block's identity/send-failure lines
            # and trade4's own risk detail; also the one context this check
            # drives the real ask-flow POST through.
            context = browser.new_context(viewport=cap.DESKTOP)
            page = context.new_page()
            open_panel(page, all_clients=True)
            check_trade4_renders(page, "staff viewer")
            check_display_order(page, "staff viewer")
            check_supplemental_note(page, "staff viewer")
            check_tracker_banner(page, "staff viewer")
            check_staff_sees_trade4_risk(page)
            check_staff_full_submission_identity(page)
            check_no_object_object(page, "staff viewer, before ask")
            check_ask_flow_updates_pane(page)
            check_no_object_object(page, "staff viewer, after ask")
            context.close()

            # Broker viewer (allClients false) -- same tracker, same order,
            # same shared banner (no identity, no send failure), but the
            # staff-only block -- and every risk detail it carries -- must
            # never even be fetched, let alone rendered.
            state["asked"] = False
            context = browser.new_context(viewport=cap.DESKTOP)
            page = context.new_page()
            open_panel(page, all_clients=False)
            check_trade4_renders(page, "broker viewer")
            check_display_order(page, "broker viewer")
            check_supplemental_note(page, "broker viewer")
            check_tracker_banner(page, "broker viewer")
            check_broker_no_risk_detail(page)
            check_no_object_object(page, "broker viewer")
            context.close()
        finally:
            browser.close()

    if failures:
        print("CREDITAPP3 SUPPLEMENT-REFERENCES CHECK: FAILED")
        for f in failures:
            print(" - " + f)
        sys.exit(1)

    print("CREDITAPP3 SUPPLEMENT-REFERENCES CHECK: PASSED "
          "(trade4 renders, bank sorts ahead of it, the supplemental note shows, the ask "
          "control posts a real request and the pane refreshes to prove it, a broker sees "
          "no risk detail anywhere, and the open-request banner's date/who-asked/send-error "
          "lines render for staff and only the date+reason for a broker)")


if __name__ == "__main__":
    main()
