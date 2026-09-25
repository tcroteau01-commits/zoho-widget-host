#!/usr/bin/env python3
"""CREDITAPP2 Task 8 -- drive the REAL Customer Approvals pane (not source
inspection) and confirm Task 7's recovery-actions work landed the way the
spec asked for.

WHY THIS LIVES HERE, NOT IN render_checks/creditapp2/ IN THE API REPO:
Task 8's brief modeled this on render_checks/creditapp1/
check_reference_survey_optional_fields.py, which `import capture as cap`
to reuse that repo's in-process Flask + mongomock + Playwright bootstrap.
That harness boots credit_app_routes.register_routes and serves
credit_app_site/index.html and reference.html -- pages the Flask app itself
owns. The pane this task checks (Customer Approvals' credit-app section,
including the two new staff-only recovery controls) is customer-approvals
.html in THIS repo: a Zoho Creator widget, a static file the broker API
never serves. There is nothing for that Flask harness to boot here -- no
route in credit_app_routes.py returns this file, and adding one would mean
building a second, parallel copy of a page that already has its own real
DOM, own real click handlers and own real fetch() calls against
BROKER_API_BASE, i.e. inventing a server that does not exist in production
to make the brief's exact premise true. That is the "new harness" this
task's instructions say not to build.

What this repo already has, and what this script reuses instead: test/
customer-approvals-credit-app-capture.py -- CREDITAPP1's own established
pattern for driving this exact pane for real. It loads the real
customer-approvals.html over file://, stubs the Zoho widget SDK and every
BROKER_API_BASE call the widget itself fetches with Playwright's page.route
(no server, because there is no server to boot -- this file has none), and
clicks through the real rendered DOM. That is the SAME shape check_reference
_survey_optional_fields.py uses against capture.py (import the existing
capture module as a library, drive it with Playwright, assert against real
rendered elements) -- just built on top of the harness that actually exists
for this pane, not one that doesn't. Nothing here re-implements
customer-approvals.html's markup or JS; every assertion is against what a
real click produced.

Imported via importlib (not a plain `import`) because the sibling module's
filename carries hyphens, same layout constraint the whole test/ directory
already lives with.

Confirms, against the real pane:
  1. a stalled reference (sent, never opened, past the stall threshold)
     renders distinctly from one that is merely waiting;
  2. the bounced row routes the broker to credit, never asks them to fix an
     address the product will not let them touch;
  3. a staff viewer (allClients true) sees the Correct address and Waive
     controls; a broker viewer's DOM contains neither element at all -- not
     merely hidden, because fetchCreditAppRisk in customer-approvals.html
     refuses to even fetch /credit-app/risk when allClients is false, so
     the staff block that hosts those controls is never filled;
  4. a correction through the REAL /credit-app/correct-address route (a
     real click, a real fetch(), a stubbed network response) re-sends and
     resets the row -- the stalled/bounced marker clears and the input is
     wiped once the panel's own refresh re-reads the (now-updated) status/
     risk payloads;
  5. no rendered text anywhere in the open panel contains "[object Object]"
     (CREDITAPP1's own shipped defect -- see check_reference_survey_
     optional_fields.py's module docstring for why source inspection alone
     would have missed it there too).

Verified to FAIL against the pre-Task-7 markup (commit 2e9c91a, this repo):
that revision has no .ca-app-correct-address, .ca-app-waive or
.ca-app-state-stalled anywhere, and its bounced-row copy reads "Address
bounced, ask your customer for a new one" -- the literal defect check #2
above exists to catch. See task-8-report.md for the exact command run and
what it printed.

Not collected by pytest -- run directly:
    python test/customer-approvals-credit-app-recovery-check.py
"""
import importlib.util
import json
import os
import pathlib
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# customer-approvals-credit-app-capture.py -- hyphens in the filename, so a
# plain `import` can't reach it; loaded as a module the same way its own
# functions/constants (record, party, install_routes, HTML_PATH,
# BROKER_API_BASE, ZOHO_STUB_JS, DESKTOP) are meant to be reused elsewhere.
_CAP_PATH = os.path.join(HERE, "customer-approvals-credit-app-capture.py")
_spec = importlib.util.spec_from_file_location("ca_capture", _CAP_PATH)
cap = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cap)

from playwright.sync_api import sync_playwright                    # noqa: E402

failures = []


def check(condition, message):
    if not condition:
        failures.append(message)


# ── Fixture: one open application, references pending, with a bounced trade2
# and a stalled trade1 -- the exact two rows Task 7's copy/marker changes are
# about, plus trade3/bank left as an ordinary in-flight "sent" for contrast. ──
STATUS_PAYLOAD = {
    "status": "references_pending",
    "parties": [
        cap.party("customer", "Alicia Byrne", "Redstone Beverage Co", "completed"),
        cap.party("trade1", "Steve Alvarez", "ABC Produce", "sent", waiting_days=6),
        cap.party("trade2", "Mia Tran", "Delta Foods", "bounced"),
        cap.party("trade3", "Ron Diaz", "Vista Cold", "sent", waiting_days=2),
        cap.party("bank", "Bank Officer Test", "Test Bank", "sent", waiting_days=2),
    ],
}
# waiting_days doesn't carry `stalled` through cap.party's own defaults --
# set it explicitly on the one row this check needs stalled.
STATUS_PAYLOAD["parties"][1]["stalled"] = True

RISK_PAYLOAD = {
    "status": "references_pending",
    "customer_verification": None,
    "application": {
        "company": {"name": "REDSTONE BEVERAGE CO"},
        "billing": {}, "credit": {}, "owners": [], "bank": {}, "references": [],
        "signer": {},
    },
    "parties": [
        {"slot": "trade1", "company": "ABC Produce", "name": "Steve Alvarez",
         "status": "sent", "waiting_days": 6, "stalled": True,
         "risk": None, "address_risk": None, "response": None},
        {"slot": "trade2", "company": "Delta Foods", "name": "Mia Tran",
         "status": "bounced", "waiting_days": 2, "stalled": False,
         "risk": None, "address_risk": None, "response": None},
        {"slot": "trade3", "company": "Vista Cold", "name": "Ron Diaz",
         "status": "sent", "waiting_days": 2, "stalled": False,
         "risk": None, "address_risk": None, "response": None},
        {"slot": "bank", "company": "Test Bank", "name": "Bank Officer Test",
         "status": "sent", "waiting_days": 2, "stalled": False,
         "risk": None, "address_risk": None, "response": None},
    ],
    "correction_count": 0,
    "pdf": {"exists": False, "retrieval_path": "/credit-app/pdf?submission_id=9001"},
}

# The refreshed state a real correct-address call would produce: trade1 no
# longer stalled, waiting resets to 0 (sent_at bumped by the correction).
STATUS_PAYLOAD_AFTER = json.loads(json.dumps(STATUS_PAYLOAD))
STATUS_PAYLOAD_AFTER["parties"][1] = cap.party(
    "trade1", "Steve Alvarez", "ABC Produce", "sent", waiting_days=0)
RISK_PAYLOAD_AFTER = json.loads(json.dumps(RISK_PAYLOAD))
RISK_PAYLOAD_AFTER["parties"][0]["waiting_days"] = 0
RISK_PAYLOAD_AFTER["parties"][0]["stalled"] = False
RISK_PAYLOAD_AFTER["correction_count"] = 1

CORRECTED_EMAIL = "ap-updated@redstonebeverage.test"

# Mutated by the correct-address stub once it fires, so the follow-on
# caAppRefreshPane fetches (a REAL consequence of the REAL route, not
# scripted here) see the post-correction state.
state = {"corrected": False}


def install_recovery_routes(page, all_clients):
    rec = cap.record(**{"Credit_Decision": "Credit App Sent - Awaiting Customer"})

    def status_payload():
        return STATUS_PAYLOAD_AFTER if state["corrected"] else STATUS_PAYLOAD

    def risk_payload():
        return RISK_PAYLOAD_AFTER if state["corrected"] else RISK_PAYLOAD

    # Base install_routes from the existing capture harness -- Zoho SDK stub,
    # /broker-report, /credit-app/status, /credit-app/risk (all_clients-gated
    # exactly as production), /credit-app/application, /customer-events*.
    # Passing plain dict payloads (not callables) here would freeze the
    # response at install time; the correct-address flow needs the SAME
    # endpoints to answer differently after the real POST lands, so the two
    # routes this check cares about are re-registered below, AFTER this one,
    # which Playwright gives priority (most-recently-registered matches
    # first, falling back to this one for everything else).
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
        if url.startswith(cap.BROKER_API_BASE + "/credit-app/correct-address") and req.method == "POST":
            sent = json.loads(req.post_data or "{}")
            check(sent.get("slot") == "trade1",
                  "correct-address POST did not target slot=trade1: %r" % sent)
            check(sent.get("new_email") == CORRECTED_EMAIL,
                  "correct-address POST did not carry the typed address: %r" % sent)
            state["corrected"] = True
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"ok": True}))
            return
        route.fallback()

    page.route("**/*", handler)


def open_panel(page, all_clients):
    install_recovery_routes(page, all_clients)
    page.goto(pathlib.Path(cap.HTML_PATH).as_uri())
    page.wait_for_selector(".row", timeout=15000)
    page.click(".row")
    page.wait_for_selector("#panel.show", timeout=15000)
    page.wait_for_function(
        "document.getElementById('ca-app-section')"
        " && document.getElementById('ca-app-section').style.display !== 'none'",
        timeout=15000)
    if all_clients:
        # Soft wait -- pre-Task-7 markup never grows this element at all, and
        # this check must FAIL (via the check() list below), not crash, on
        # that markup. staff body still gets whatever the fetch renders,
        # which is enough of a settle point either way.
        try:
            page.wait_for_selector(".ca-app-recovery", timeout=5000)
        except Exception:
            page.wait_for_timeout(500)


# ── 1 + 2: tracker rendering, both viewers see the same tracker copy ────────

def check_tracker_rendering(page):
    stalled_row = page.locator('.ca-app-row[data-slot="trade1"] .ca-app-row-state')
    waiting_row = page.locator('.ca-app-row[data-slot="trade3"] .ca-app-row-state')
    bounced_row = page.locator('.ca-app-row[data-slot="trade2"] .ca-app-row-state')

    check(stalled_row.count() > 0, "stalled row (trade1) not found in the tracker")
    check(waiting_row.count() > 0, "plain-waiting row (trade3) not found in the tracker")
    check(bounced_row.count() > 0, "bounced row (trade2) not found in the tracker")
    if not (stalled_row.count() and waiting_row.count() and bounced_row.count()):
        return

    stalled_class = stalled_row.first.get_attribute("class") or ""
    waiting_class = waiting_row.first.get_attribute("class") or ""
    check("ca-app-state-stalled" in stalled_class,
          "a stalled reference (trade1) does not carry ca-app-state-stalled: %r" % stalled_class)
    check("ca-app-state-stalled" not in waiting_class,
          "a plain-waiting reference (trade3) incorrectly carries ca-app-state-stalled: %r"
          % waiting_class)

    stalled_text = stalled_row.first.inner_text()
    waiting_text = waiting_row.first.inner_text()
    check("never opened" in stalled_text,
          "the stalled row's text does not say 'never opened': %r" % stalled_text)
    check(stalled_text != waiting_text,
          "the stalled row reads identically to the plain-waiting row: %r" % stalled_text)

    bounced_text = bounced_row.first.inner_text()
    check("ask your customer" not in bounced_text.lower(),
          "the bounced row tells the broker to fix the address themselves "
          "(correction is credit-only): %r" % bounced_text)
    check("ask credit" in bounced_text.lower(),
          "the bounced row does not route the broker to credit: %r" % bounced_text)


# ── 3: staff sees the recovery controls, broker's DOM has neither ───────────

def check_staff_controls_present(page):
    correct_btn = page.locator('.ca-app-correct-address[data-slot="trade1"]')
    waive_btn = page.locator('.ca-app-waive[data-slot="trade1"]')
    check(correct_btn.count() > 0, "staff viewer: .ca-app-correct-address not found for trade1")
    check(waive_btn.count() > 0, "staff viewer: .ca-app-waive not found for trade1")


def check_broker_controls_absent(page):
    correct_count = page.locator(".ca-app-correct-address").count()
    waive_count = page.locator(".ca-app-waive").count()
    check(correct_count == 0,
          "broker viewer's DOM contains %d .ca-app-correct-address element(s); "
          "must be none" % correct_count)
    check(waive_count == 0,
          "broker viewer's DOM contains %d .ca-app-waive element(s); must be none"
          % waive_count)


# ── 4: a correction through the real route re-sends and resets the row ──────

def check_correction_flow(page):
    """Drives the REAL button through the REAL fetch() call. Note on the
    'Address corrected, survey resent' toast: caAppSubmitCorrectAddress sets
    it, then immediately calls caAppRefreshPane, which re-fetches
    /credit-app/risk and renderCreditAppStaffSection replaces the entire
    staff body's innerHTML wholesale -- including the message element that
    toast lives on. Once the refresh resolves, that toast is gone by design,
    not by defect (confirmed against this same real page, manually, before
    writing this check), so asserting on it here would be a race against the
    app's own refresh rather than a real regression guard. What this DOES
    assert is verifiable without a race: the POST that actually re-sends the
    survey fires with the corrected address (network boundary), the input
    clears synchronously in the same click handler, and the tracker row --
    driven by a SEPARATE re-fetch (/credit-app/status) than the one that
    wipes the toast -- settles on 'no longer stalled' once that refresh
    lands."""
    if page.locator('.ca-app-correct-address[data-slot="trade1"]').count() == 0:
        check(False, "no .ca-app-correct-address control to drive -- the "
                      "correction flow cannot be exercised on this markup")
        return
    page.fill('.ca-app-recovery[data-slot="trade1"] .ca-app-address-input', CORRECTED_EMAIL)
    page.click('.ca-app-correct-address[data-slot="trade1"]')

    deadline = time.time() + 8
    while time.time() < deadline and not state["corrected"]:
        page.wait_for_timeout(100)
    check(state["corrected"] is True,
          "the correct-address route was never actually called")

    # state["corrected"] flips inside the Python route handler, before the
    # 200 response even reaches the page -- give the browser-side .then()
    # callback (which clears the input) its own moment to actually run.
    input_sel = '.ca-app-recovery[data-slot="trade1"] .ca-app-address-input'
    try:
        page.wait_for_function(
            "sel => document.querySelector(sel).value === ''", arg=input_sel, timeout=8000)
    except Exception:
        pass
    input_val = page.locator(input_sel).input_value()
    check(input_val == "", "the address input was not cleared after a successful correction")

    # caAppRefreshPane re-fetches status/application/risk for real -- wait for
    # the tracker's OWN re-render (a separate DOM subtree from the staff
    # body the toast lives on) to settle on the post-correction payload.
    try:
        page.wait_for_function(
            "sel => { var e = document.querySelector(sel); "
            "return !!e && e.className.indexOf('ca-app-state-stalled') === -1; }",
            arg='.ca-app-row[data-slot="trade1"] .ca-app-row-state', timeout=8000)
    except Exception:
        pass
    row_state = page.locator('.ca-app-row[data-slot="trade1"] .ca-app-row-state')
    row_class = row_state.first.get_attribute("class") if row_state.count() else ""
    row_text = row_state.first.inner_text() if row_state.count() else ""
    check(row_class is not None and "ca-app-state-stalled" not in row_class,
          "trade1's row still reads stalled after a correction the server accepted: %r"
          % row_class)
    check("never opened" not in row_text,
          "trade1's row still reads 'never opened' after a correction the server accepted: %r"
          % row_text)


# ── 5: no [object Object] anywhere in the open panel ─────────────────────────

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
            # Staff viewer (allClients true) -- sees the tracker, the bounced/
            # stalled copy, and the recovery controls.
            context = browser.new_context(viewport=cap.DESKTOP)
            page = context.new_page()
            open_panel(page, all_clients=True)
            check_tracker_rendering(page)
            check_staff_controls_present(page)
            check_no_object_object(page, "staff viewer, before correction")
            check_correction_flow(page)
            check_no_object_object(page, "staff viewer, after correction")
            context.close()

            # Broker viewer (allClients false) -- same tracker, same bounced/
            # stalled copy, but the staff block (and its controls) must never
            # even be fetched, let alone rendered.
            state["corrected"] = False
            context = browser.new_context(viewport=cap.DESKTOP)
            page = context.new_page()
            open_panel(page, all_clients=False)
            check_tracker_rendering(page)
            check_broker_controls_absent(page)
            check_no_object_object(page, "broker viewer")
            context.close()
        finally:
            browser.close()

    if failures:
        print("CREDITAPP2 RECOVERY-ACTIONS CHECK: FAILED")
        for f in failures:
            print(" - " + f)
        sys.exit(1)

    print("CREDITAPP2 RECOVERY-ACTIONS CHECK: PASSED "
          "(stalled reads distinct from waiting, bounced routes to credit not "
          "the broker, staff-only controls are staff-only, and a real "
          "correct-address POST re-sends and resets the row)")


if __name__ == "__main__":
    main()
