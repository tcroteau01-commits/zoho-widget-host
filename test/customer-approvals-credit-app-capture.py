#!/usr/bin/env python3
"""Screenshot the Credit Application section (CREDITAPP1, Task 16) inside the
Customer Approvals detail pane, in every state the broker can land on.

This drives the real customer-approvals.html from this worktree (branch
creditapp1) in a headless browser and stubs every network call the widget
makes with page.route -- the Zoho widget SDK's getInitParams, /broker-report
(the list itself), /credit-app/status, /credit-app/status-bulk,
/credit-app/application, /credit-app/risk, and /credit-app/nudge -- so
nothing here depends on a live Creator session, a live backend, or hand-built
HTML standing in for the widget's own rendering.

REFRESH (this pass) adds three states Task 17 and the confidentiality-line
split introduced since the last capture:
  * the LIST rows' own progress indicator ("2 of 5") -- one bulk call
    (/credit-app/status-bulk) feeds every row, never a per-row fetch --
    plus the "waiting on" tooltip a hover/focus reveals.
  * the Application Details block every broker sees (/credit-app/application
    -- a deliberately narrower read than the one below).
  * the Full Submission block OperFi staff additionally see
    (/credit-app/risk -- gated client-side on allClients, same as the
    existing Domain Check / Make a Decision sections), with one reference's
    full answer and its risk signals.

Usage:
    python test/customer-approvals-credit-app-capture.py

Output: PNGs to C:\\Claude Code\\creditapp1-preview\\, continuing the sequence
started by the applicant/reference capture (which stopped at 31 this pass --
see render_checks/creditapp1/capture.py in the sibling worktree). Refuses to
overwrite a file that's already there.
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
    # as the applicant/reference/email capture.
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

# ── CREDITAPP1 Task 17 -- the broker's own Application Details block, the
# narrower of the two new reads. Field names follow renderCreditAppDetailSection
# in customer-approvals.html exactly (company/billing/credit/bank/references/
# signer) -- never EIN, formation, owners, the bank officer's own contact, a
# reference's actual answer, or a risk signal; those are the staff-only block
# below. ─────────────────────────────────────────────────────────────────────
APPLICATION_PAYLOAD = {
    "company": {
        "name": "REDSTONE BEVERAGE CO", "dba": "", "business_type": "Direct Shipper",
        "phone": "2145550142", "website": "www.redstonebeverage.com",
        "year_established": "2015", "parent_companies": "", "mc": "", "dot": "",
        "currently_factoring": "",
        "address": {"line1": "4820 Distribution Pkwy", "suite": "220", "city": "Dallas",
                    "state": "TX", "postal": "75247", "country": "US",
                    "formatted": "4820 Distribution Pkwy, Suite 220, Dallas, TX 75247"},
    },
    "billing": {"contact_name": "Dana Reyes", "phone": "2145550142",
               "ap_email": "ap@redstonebeverage.com",
               "instructions": "Tender loads by email with the PO number referenced; "
                                "rates are verified against the signed rate confirmation."},
    "credit": {"requested_limit": "75000", "expected_monthly_volume": "120000"},
    "bank": {"name": "Test Bank"},
    "references": [
        {"slot": "trade1", "company": "ABC Produce", "contact_name": "Steve Alvarez", "status": "completed"},
        {"slot": "trade2", "company": "Delta Foods", "contact_name": "Mia Tran", "status": "sent"},
        {"slot": "trade3", "company": "Vista Cold", "contact_name": "Ron Diaz", "status": "sent"},
    ],
    "signer": {"name": "Dana Reyes", "title": "Controller", "email": "ap@redstonebeverage.com"},
    "submitted_at": "2026-09-20T14:32:00Z",
}

# ── CREDITAPP1 -- the OperFi-staff-only Full Submission block. Superset of
# the payload above (EIN, formation, owners, the bank officer, risk
# disclosure, every reference's real address) plus `parties`, each carrying
# its own full survey response AND risk assessment -- renderCreditAppStaffSection's
# contract. trade3/Vista Cold reuses the SAME collusion scenario the emails
# capture already shows Tom (same_ip_as_applicant + a responder domain that
# does not match the reference company) -- one story, not two. ─────────────
RISK_PAYLOAD = {
    "status": "references_pending",
    "customer_verification": None,
    "application": {
        "business_type": "Direct Shipper",
        "company": dict(APPLICATION_PAYLOAD["company"],
                        ein="84-2210567", formation_state="TX", formation_date="03/14/2015",
                        commodities="Beverages, bottled and canned, palletized",
                        email="ap@redstonebeverage.com"),
        "billing": APPLICATION_PAYLOAD["billing"],
        "credit": APPLICATION_PAYLOAD["credit"],
        "owners": [{"name": "Dana Reyes", "title": "Owner", "percentage": "60"},
                  {"name": "Marcus Reyes", "title": "Owner", "percentage": "40"}],
        "bank": {"name": "Test Bank", "officer": "Bank Officer Test",
                "phone": "5559998888", "email": "officer@testbank.test"},
        "risk_disclosure": "No open judgments, liens or suits. No bankruptcy in the last seven years.",
        "references": [
            {"company": "ABC Produce", "contact": "Steve Alvarez", "phone": "5551112222",
             "email": "steve@abcproduce.test",
             "address": {"formatted": "1220 Produce Row, Suite B, Dallas, TX 75207"}},
            {"company": "Delta Foods", "contact": "Mia Tran", "phone": "5553334444",
             "email": "mia@deltafoods.test"},
            {"company": "Vista Cold", "contact": "Ron Diaz", "phone": "5556667777",
             "email": "ron@vistacold.test"},
        ],
        "signer": {"name": "Dana Reyes", "title": "Controller", "phone": "2145550142",
                  "email": "ap@redstonebeverage.com"},
        "submitted_at": "2026-09-20T14:32:00Z",
    },
    "parties": [
        {"slot": "trade1", "company": "ABC Produce", "name": "Steve Alvarez", "status": "completed",
         "response": {"customer_since": "Since 2022, about 4 years", "credit_limit": "50000",
                      "high_credit": "42000", "rating": 4, "verified_email": "steve@abcproduce.test",
                      "net_terms": "Net 30", "last_sale": "2026-09-10", "balance": "18500",
                      "aging": {"d0_30": "9200", "d31_60": "6300", "d61_plus": "3000"},
                      "comments": "Consistently pays within terms; no collection issues.",
                      "rep": {"name": "Steve Alvarez", "title": "Credit Manager",
                              "phone": "5551112222", "email": "steve@abcproduce.test"}},
         "risk": {"level": "low", "signals": []}},
        {"slot": "trade3", "company": "Vista Cold", "name": "Ron Diaz", "status": "completed",
         "response": {"customer_since": "Since 2021, about 5 years", "credit_limit": "30000",
                      "high_credit": "28000", "rating": 3, "verified_email": "ops@vistacoldstorage-llc.com",
                      "net_terms": "Net 15", "last_sale": "2026-08-22", "balance": "11400",
                      "aging": {"d0_30": "4200", "d31_60": "3200", "d61_plus": "4000"},
                      "comments": "Payments have slowed over the last two cycles.",
                      "rep": {"name": "Ron Diaz", "title": "AR Manager",
                              "phone": "5556667777", "email": "ops@vistacoldstorage-llc.com"}},
         "risk": {"level": "high", "signals": [
             {"code": "same_ip_as_applicant",
              "detail": "answered from the same IP as the applicant's own submission"},
             {"code": "domain_does_not_match_company",
              "detail": "vistacoldstorage-llc.com vs Vista Cold"},
         ]}},
    ],
    "pdf": {"exists": True, "retrieval_path": "/credit-app/pdf"},
}

# ── Task 17 -- the list's own bulk progress. Keyed by record ID; a row with
# no entry (or total<=0) renders nothing extra -- see caAppRowProgressHtml.
BULK_STATUS = {
    "9001": {"status": "references_pending", "completed": 2, "total": 5,
             "waiting_on": ["Mia Tran (Delta Foods)", "Ron Diaz (Vista Cold)",
                            "Bank Officer Test (Test Bank)"]},
    "9101": {"status": "references_pending", "completed": 4, "total": 5,
             "waiting_on": ["Bank Officer Test (Test Bank)"]},
    "9102": {"status": "ready_for_review", "completed": 5, "total": 5},
}


def install_routes(page, rec, status_payload, nudge, all_clients=False,
                   application_payload=None, risk_payload=None, bulk_status=None,
                   records=None):
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
            body = {"records": records if records is not None else [rec], "all_clients": all_clients}
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
            return
        if url.startswith(BROKER_API_BASE + "/credit-app/status-bulk"):
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"applications": bulk_status or {}}))
            return
        if url.startswith(BROKER_API_BASE + "/credit-app/application"):
            if application_payload is None:
                route.fulfill(status=404, content_type="application/json", body="{}")
            else:
                route.fulfill(status=200, content_type="application/json",
                              body=json.dumps(application_payload))
            return
        if url.startswith(BROKER_API_BASE + "/credit-app/risk"):
            if risk_payload is None:
                route.fulfill(status=404, content_type="application/json", body="{}")
            else:
                route.fulfill(status=200, content_type="application/json",
                              body=json.dumps(risk_payload))
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
        # them (allClients is false unless set above, we never save billing or a
        # decision), but refuse fast rather than let an unexpected call hang the
        # capture.
        route.fulfill(status=404, content_type="application/json", body="{}")

    page.route("**/*", handler)


def capture(pw, viewport, viewport_label, out_name, status_payload, rec_overrides, nudge,
           all_clients=False, application_payload=None, risk_payload=None):
    out_path = os.path.join(OUT_DIR, out_name + "-" + viewport_label + ".png")
    if os.path.exists(out_path):
        raise SystemExit("refusing to overwrite existing file: " + out_path)

    rec = record(**rec_overrides)
    browser = pw.chromium.launch()
    try:
        context = browser.new_context(viewport=viewport)
        page = context.new_page()
        install_routes(page, rec, status_payload, nudge, all_clients=all_clients,
                       application_payload=application_payload, risk_payload=risk_payload)
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

        # CREDITAPP1 -- Application Details, every broker: waits for
        # fetchCreditAppApplication's own fill, same discipline as the tracker
        # wait above.
        if application_payload is not None:
            page.wait_for_function(
                "document.getElementById('ca-app-detail-section')"
                " && document.getElementById('ca-app-detail-section').style.display !== 'none'",
                timeout=15000)
            page.eval_on_selector("#ca-app-detail-section", "el => el.scrollIntoView({block: 'start'})")

        # CREDITAPP1 -- Full Submission, OperFi staff only: same wait, gated on
        # allClients exactly as fetchCreditAppRisk itself is -- see that
        # function's own comment in customer-approvals.html.
        if risk_payload is not None and all_clients:
            page.wait_for_function(
                "document.getElementById('ca-app-staff-section')"
                " && document.getElementById('ca-app-staff-section').style.display !== 'none'",
                timeout=15000)
            # The Reference Answers subsection sits at the BOTTOM of this
            # block (renderCreditAppStaffSection appends it last, after
            # applicant/owners/billing/bank/references) -- scroll to the
            # high-risk badge itself, not the section's own top, so the
            # panel screenshot actually shows a reference's answers with its
            # signals rather than just Applicant Detail again.
            page.wait_for_selector(".ca-app-staff-risk-high", timeout=15000)
            page.eval_on_selector(".ca-app-staff-risk-high",
                                  "el => el.scrollIntoView({block: 'center'})")

        page.locator("#panel").screenshot(path=out_path)
        print("wrote", out_path)
    finally:
        browser.close()


def capture_list_progress(pw, viewport, viewport_label, out_name):
    """Task 17's own list-row progress -- NOT a panel shot: the list itself,
    several rows each carrying a bulk-fed progress bar, with one row's
    "waiting on" tooltip forced open via hover so both halves of the ask
    (the bars, and the tip's content) land in one screenshot."""
    out_path = os.path.join(OUT_DIR, out_name + "-" + viewport_label + ".png")
    if os.path.exists(out_path):
        raise SystemExit("refusing to overwrite existing file: " + out_path)

    records = [
        record(ID="9001", Customer_Company_Name="REDSTONE BEVERAGE CO",
              Credit_Decision="Credit App Sent - Awaiting Customer", Added_Time="18-Sep-2026"),
        record(ID="9101", Customer_Company_Name="Palmetto Wholesale Foods",
              Email="ap@palmettowholesale.test", Customer_Point_of_Contact="Grace Kim",
              Credit_Decision="Credit App Sent - Awaiting Customer", Added_Time="15-Sep-2026"),
        record(ID="9102", Customer_Company_Name="Ironwood Logistics Group",
              Email="ap@ironwoodlogistics.test", Customer_Point_of_Contact="Leo Marsh",
              Credit_Decision="Credit App Rec'd - Pending Review", Added_Time="21-Sep-2026"),
    ]

    browser = pw.chromium.launch()
    try:
        context = browser.new_context(viewport=viewport)
        page = context.new_page()
        install_routes(page, records[0], None, None, records=records, bulk_status=BULK_STATUS)
        page.goto(pathlib.Path(HTML_PATH).as_uri())
        page.wait_for_selector(".row", timeout=15000)
        # fetchCreditAppStatusBulk fires after the list itself renders and
        # re-renders the rows once it resolves -- give that a tick before
        # looking for the progress markup it paints in.
        page.wait_for_selector(".ca-app-rowprog-wrap", timeout=15000)
        wrap = page.locator(".ca-app-rowprog-wrap").first
        wrap.hover()
        page.wait_for_timeout(150)  # let the tooltip's opacity transition finish
        page.screenshot(path=out_path, full_page=True)
        print("wrote", out_path)
    finally:
        browser.close()


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if not os.path.exists(HTML_PATH):
        raise SystemExit("customer-approvals.html not found at " + HTML_PATH)

    with sync_playwright() as pw:
        # SCENARIOS (19-23) are unchanged since the last capture and are not
        # re-run this pass -- see the module docstring. The loop stays here,
        # commented, for a future full re-run:
        #
        # for out_name, status_payload, rec_overrides, nudge in SCENARIOS:
        #     capture(pw, DESKTOP, "desktop", out_name, status_payload, rec_overrides, nudge)
        #     capture(pw, PHONE, "phone", out_name, status_payload, rec_overrides, nudge)

        # ── New this pass ────────────────────────────────────────────────
        capture_list_progress(pw, DESKTOP, "desktop", "32-credit-app-list-progress")
        capture_list_progress(pw, PHONE, "phone", "32-credit-app-list-progress")

        capture(pw, DESKTOP, "desktop", "33-credit-app-details-broker", MIDFLIGHT,
               {"Credit_Decision": "Credit App Sent - Awaiting Customer"}, None,
               all_clients=False, application_payload=APPLICATION_PAYLOAD)
        capture(pw, PHONE, "phone", "33-credit-app-details-broker", MIDFLIGHT,
               {"Credit_Decision": "Credit App Sent - Awaiting Customer"}, None,
               all_clients=False, application_payload=APPLICATION_PAYLOAD)

        capture(pw, DESKTOP, "desktop", "34-credit-app-full-submission-staff", MIDFLIGHT,
               {"Credit_Decision": "Credit App Sent - Awaiting Customer"}, None,
               all_clients=True, application_payload=APPLICATION_PAYLOAD, risk_payload=RISK_PAYLOAD)
        capture(pw, PHONE, "phone", "34-credit-app-full-submission-staff", MIDFLIGHT,
               {"Credit_Decision": "Credit App Sent - Awaiting Customer"}, None,
               all_clients=True, application_payload=APPLICATION_PAYLOAD, risk_payload=RISK_PAYLOAD)


if __name__ == "__main__":
    main()
