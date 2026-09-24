#!/usr/bin/env python3
"""Screenshot the Credit Application section (CREDITAPP1, Task 16) inside the
Customer Approvals detail pane, in every state the broker can land on.

This drives the real customer-approvals.html from this worktree (branch
creditapp1) in a headless browser and stubs every network call the widget
makes with page.route -- the Zoho widget SDK's getInitParams, /broker-report
(the list itself), /credit-app/status, and /credit-app/nudge -- so nothing
here depends on a live Creator session, a live backend, or hand-built HTML
standing in for the widget's own rendering.

Usage:
    python test/customer-approvals-credit-app-capture.py

Output: PNGs to C:\\Claude Code\\creditapp1-preview\\, continuing the sequence
started by the earlier applicant/reference/email capture (which stopped at
18-). Refuses to overwrite a file that's already there.
"""
import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
HTML_PATH = os.path.join(REPO, "customer-approvals.html")
OUT_DIR = r"C:\Claude Code\creditapp1-preview"
BROKER_API_BASE = "https://operfi-broker-api.onrender.com"
BROKER_EMAIL = "broker@operfidemo.com"

DESKTOP = {"width": 1280, "height": 900}
PHONE = {"width": 390, "height": 844}

# Stands in for the real Zoho widget SDK (js.zohostatic.com/.../widgetsdk-min.js),
# loaded render-blocking before the widget's own inline <script>, so ZOHO.CREATOR
# exists by the time bootApp() runs. loginUser is what the widget reads as brokerEmail.
ZOHO_STUB_JS = (
    "window.ZOHO = { CREATOR: { UTIL: { getInitParams: function() {"
    "  return Promise.resolve({ loginUser: %r });"
    "} } } };" % BROKER_EMAIL
)


def party(slot, name, company, status, waiting_days=0):
    return {"slot": slot, "name": name, "company": company,
            "status": status, "waiting_days": waiting_days}


def record(**overrides):
    # OperFi Demo's broker vetting REDSTONE BEVERAGE CO -- same believable data
    # as the earlier applicant/reference/email capture.
    r = {
        "ID": "9001",
        "Customer_Company_Name": "REDSTONE BEVERAGE CO",
        "Customer_Point_of_Contact": "Alicia Byrne",
        "Email": "alicia@redstonebeverage.com",
        "Phone_Number": "6025557890",
        "Phone_Number1": "6025557890",
        "Billing_Point_of_Contact": "Alicia Byrne",
        "Billing_AP_Contact_Number": "6025557890",
        "Billing_Email": "ap@redstonebeverage.com",
        "Company_Website": "https://redstonebeverage.com",
        "Credit_Decision": "Credit App Sent - Awaiting Customer",
        "Credit_Limit": "",
        "Credit_Decision_Date": "",
        "Added_Time": "18-Sep-2026",
        "Comments": "",
        "Additional_Supporting_Documents": None,
    }
    r.update(overrides)
    return r


REFS = {
    "trade1": ("Steve Alvarez", "ABC Produce"),
    "trade2": ("Mia Tran", "Delta Foods"),
    "trade3": ("Ron Diaz", "Vista Cold"),
    "bank": ("Bank Officer Test", "Test Bank"),
}


def parties(customer_status, trade1, trade2, trade3, bank):
    return [
        party("customer", "Alicia Byrne", "Redstone Beverage Co", customer_status),
        party("trade1", *REFS["trade1"], *trade1),
        party("trade2", *REFS["trade2"], *trade2),
        party("trade3", *REFS["trade3"], *trade3),
        party("bank", *REFS["bank"], *bank),
    ]


MIDFLIGHT = {
    "status": "references_pending",
    "parties": parties("completed", ("completed",), ("sent", 5), ("sent", 4), ("sent", 6)),
}
ALL_IN = {
    "status": "ready_for_review",
    "parties": parties("completed", ("completed",), ("completed",), ("completed",), ("completed",)),
}
BOUNCED = {
    "status": "references_pending",
    "parties": parties("completed", ("completed",), ("bounced",), ("sent", 2), ("sent", 2)),
}

# ── Scenarios: (out_name, status_payload_or_None, record_overrides, nudge) ──
# nudge is None, or (slot, response_status, response_body) to click that row's
# Nudge button and drive the 409-refusal path the test file exercises.
SCENARIOS = [
    ("19-credit-app-midflight", MIDFLIGHT,
     {"Credit_Decision": "Credit App Sent - Awaiting Customer"}, None),
    ("20-credit-app-all-in", ALL_IN,
     {"Credit_Decision": "Credit App Rec'd - Pending Review"}, None),
    ("21-credit-app-bounced-address", BOUNCED,
     {"Credit_Decision": "Credit App Sent - Awaiting Customer"}, None),
    ("22-credit-app-nudge-refused", MIDFLIGHT,
     {"Credit_Decision": "Credit App Sent - Awaiting Customer"},
     ("trade2", 409, {"error": "nudged 6h ago"})),
    ("23-credit-app-flag-off", None,
     {"Credit_Decision": "Awaiting Credit Decision"}, None),
]


def install_routes(page, rec, status_payload, nudge):
    def handler(route):
        req = route.request
        url = req.url

        if "js.zohostatic.com" in url and "widgetsdk" in url:
            route.fulfill(status=200, content_type="application/javascript", body=ZOHO_STUB_JS)
            return
        if url.startswith("https://app.operfi.com/"):
            # operfi-impersonate.js / pdf.min.js / operfi-docviewer.js -- none of
            # this capture's scenarios open the doc viewer or the admin bar.
            route.fulfill(status=200, content_type="application/javascript", body="// stubbed for capture\n")
            return
        if url.startswith(BROKER_API_BASE + "/broker-report"):
            route.fulfill(status=200, content_type="application/json",
                           body=json.dumps({"records": [rec], "all_clients": False}))
            return
        if url.startswith(BROKER_API_BASE + "/credit-app/status"):
            if status_payload is None:
                route.fulfill(status=404, content_type="application/json", body="{}")
            else:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(status_payload))
            return
        if url.startswith(BROKER_API_BASE + "/credit-app/nudge") and req.method == "POST":
            if nudge:
                _, code, body = nudge
            else:
                code, body = 200, {"ok": True}
            route.fulfill(status=code, content_type="application/json", body=json.dumps(body))
            return
        if url.startswith("file://"):
            route.continue_()
            return
        # Anything else (customer-fraud-check, credit-decision, credit-doc,
        # broker-edit-customer-billing, ...) -- none of these scenarios trigger
        # them (allClients is false, we never save billing or a decision), but
        # refuse fast rather than let an unexpected call hang the capture.
        route.fulfill(status=404, content_type="application/json", body="{}")

    page.route("**/*", handler)


def capture(pw, viewport, viewport_label, out_name, status_payload, rec_overrides, nudge):
    out_path = os.path.join(OUT_DIR, out_name + "-" + viewport_label + ".png")
    if os.path.exists(out_path):
        raise SystemExit("refusing to overwrite existing file: " + out_path)

    rec = record(**rec_overrides)
    browser = pw.chromium.launch()
    try:
        context = browser.new_context(viewport=viewport)
        page = context.new_page()
        install_routes(page, rec, status_payload, nudge)
        page.goto(pathlib.Path(HTML_PATH).as_uri())

        page.wait_for_selector(".row", timeout=15000)
        page.click(".row")
        page.wait_for_selector("#panel.show", timeout=15000)

        if status_payload is not None:
            page.wait_for_function(
                "document.getElementById('ca-app-section')"
                " && document.getElementById('ca-app-section').style.display !== 'none'",
                timeout=15000)
            page.eval_on_selector("#ca-app-section", "el => el.scrollIntoView({block: 'center'})")
            if nudge:
                slot, code, body = nudge
                sel = '.ca-app-nudge[data-slot="%s"]' % slot
                page.click(sel)
                page.wait_for_function(
                    "sel => { var b = document.querySelector(sel); return !!b && b.disabled === true; }",
                    arg=sel, timeout=5000)
                page.wait_for_timeout(150)  # let the msg text paint before the shot
        else:
            # 404 (flag off): give fetchCreditAppStatus's .then() a tick to resolve
            # and confirm it left the section hidden rather than racing the check.
            page.wait_for_timeout(600)
            still_hidden = page.eval_on_selector(
                "#ca-app-section", "el => el.style.display === 'none'")
            if not still_hidden:
                raise AssertionError("flag-off case: ca-app-section did not stay hidden")

        page.locator("#panel").screenshot(path=out_path)
        print("wrote", out_path)
    finally:
        browser.close()


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if not os.path.exists(HTML_PATH):
        raise SystemExit("customer-approvals.html not found at " + HTML_PATH)

    with sync_playwright() as pw:
        for out_name, status_payload, rec_overrides, nudge in SCENARIOS:
            capture(pw, DESKTOP, "desktop", out_name, status_payload, rec_overrides, nudge)
            capture(pw, PHONE, "phone", out_name, status_payload, rec_overrides, nudge)


if __name__ == "__main__":
    main()
