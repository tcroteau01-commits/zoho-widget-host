# CNOAPORTAL1 Broker Portal Customer NOA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, run by the /loop) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give brokers a customer NOA status chip, a Send NOA flow, AP contacts and an NOA bell on Customer Approvals, shipped dark behind `CNOA_PORTAL_ENABLED = false`.

**Architecture:** One new browser module, `customer-noa-panel.js`, exposes `window.OperFiCustomerNoa`. `customer-approvals.html` gets one script tag and five guarded mount calls (`window.OperFiCustomerNoa && ...`), so a missing or 404ing script leaves the page exactly as it is today. The module owns every `/customer-noa/*` call; the page owns none. One companion change in operfi-broker-api adds the file to the portal asset allowlist.

**Tech Stack:** Plain ES5-style browser JS (house style of `customer-profile.js` / `credit-app-fraud-panel.js`), `node --test` + jsdom.

**Spec:** `C:\Claude Code\NOA Center\docs\handoffs\2026-11-03-broker-portal-cnoa-phase2.md` (contract) and `C:\Claude Code\NOA Center\docs\handoffs\2026-11-19-broker-portal-cnoa-delta.md` (what changed). Read both every iteration.

**Worktree / branch:** `C:\Claude Code\wt-cnoaportal1`, branch `cnoaportal1`, cut from `origin/main` 8b99789. API change: separate worktree off operfi-broker-api `origin/main`, branch `cnoaportal1-asset`.

## Global Constraints

- Do NOT edit any `customer_noa_*` module, `customer_noa_switches.py`, `permissions_catalog.py`, `permissions_gate.py`. API needs go to `C:\Claude Code\NOA Center\docs\handoffs\from-broker-portal-<date>.md`.
- `const CNOA_PORTAL_ENABLED = false;` is the first statement in the module and stays `false` on main until Tom says flip.
- Visible = `CNOA_PORTAL_ENABLED || (OPERFI_IMP.isStaff() && OPERFI_IMP.target())`. Not visible: render `''`, attach no listeners, make zero `/customer-noa/*` calls.
- Staff preview shows the tag text exactly: `Preview: hidden from clients`.
- Chip text = `chip.label` verbatim (including `Sent from FactorView`). `Waiting on OperFi verification` uses the in-progress style, never the done/green style. Send NOA is not rendered when `can_send !== true`.
- `GET /customer-noa/statuses` once per list load, ids chunked at 200 per request.
- Request bodies are built from allow lists: preview `{email, submission_id, contact:{email,name}, note}`; send `{email, submission_id, contact:{email,name,phone,role}, note, mode}`; add contact `{email, submission_id, contact:{email,name,phone,role}}`; seen `{email, submission_ids}`. Never `status`, `confirmed_by`, `kind`, `force`, `verified_domain`, `client`, `debtor`.
- `blocked_contact` gets reasons and a "use a different address" prompt. No override control of any kind.
- No release button. Optional link text "Request a Letter of Release" to `https://lor-request.operfi.com`.
- Help Center copy is not touched in this branch.
- Test sends: `ZZ TEST HAULING LLC` (CRM 3861668000172094001) or `TESTING OPERFI ACCOUNT` (3861668000072117012) as the impersonated client, AP address an OperFi-owned mailbox. Never a real client's record. A preview send REALLY emails (EMAIL_LIVE on).
- No em or en dashes in user-facing copy.

## Decisions (each with what would prove it wrong)

**D1. Row chip: in the Customer cell, under the existing warning lines (`billing-warn`, co-broker), with a small `Send NOA` button right beside it.** It reads as a fact about the customer, next to the other "can this customer carry a load" warnings, and leaves the crowded action column alone. The button carries class `row-action` (so the existing row-click guard skips opening the drawer) and `data-cnoa-send`, NOT `data-action` (so renderList's existing binder ignores it); the module binds it with one delegated listener on `#results`.
*Wrong if:* at the 1100px widget width the chip wraps the Customer cell to three lines on most rows, or brokers in the staff preview look for it in the action column. Then move the button into `actionCell` and keep only the chip in the Customer cell.

**D2. "Profile" for a broker is the drawer, not `customer-profile.js`.** The full profile is staff-only: `customer-approvals.html:1566-1574` offers it only when `allClients`, and the backend answers 403 to a broker. So the NOA section goes at the top of the drawer's `panel-body`, right after `coBrokerAlertHtml(r)`: chip, Send NOA, AP contacts, LOR link.
*Wrong if:* brokers get the full profile later. Then add `OperFiCustomerNoa.panelHtml(p)` to `renderHeader` in `customer-profile.js`; the module API already fits.

**D3. "Have OperFi send it for me" is a second button on the send form,** beside `Send now`, with one line under it: "OperFi sends it for you. Nothing is emailed until we do." A checkbox hides the fact that the primary button then emails nobody.
*Wrong if:* in the first two weeks after the flip, `mode:"operfi"` requests outnumber `mode:"self"` sends by more than 3:1 (brokers treating it as the default and flooding ops). Then demote it to a link.

**D4. Bell: a broker-facing `NOA updates` chip in the Customer Approvals toolbar (`#chips`), first in the row, mounted at the end of `buildChips()`.** There is no portal-wide bell (checked widget-host and operfi-broker-api), and the existing CUSTEVENT1 bell is staff-only (`allClients`), which is false for brokers and for staff impersonating, so the two never render together. Quiet when empty: renders nothing. Click opens a dropdown of items (debtor name, chip label, relative time) and POSTs `/customer-noa/seen` for the shown ids; clicking an item opens that customer's drawer.
*Wrong if:* Tom wants NOA events on every portal page (dashboard, load board). Then this needs a shell-level bell, which is a SHELL1 build, not this one.

## Help Center correction (ships with the flip, not before)

Replace the "Sent" then "Acknowledged" description in `help-center.html` with:

> When you send an NOA, your customer's accounts payable team gets a secure link to confirm it. Once they acknowledge it, OperFi verifies it, usually by calling a number we find independently. You'll get an email and a notification when it's confirmed, or if anything needs your attention.

Add one line listing the statuses brokers see: Not sent, Sent from FactorView, Waiting on (AP address), Waiting on OperFi verification, Confirmed, Action needed, Released.

## Review Focus

1. **whoami arrives after the list.** `OPERFI_IMP.isStaff()` is false until `/whoami` returns. Staff impersonating must still get the preview: when not visible but `target()` is set, re-check every 250ms up to 40 times, then give up. A broker with a hand-set localStorage target never passes `isStaff()`. Test in Task 1.
2. **Stale statuses after impersonation switch or reload.** A slow `/statuses` response from a previous load must not paint. Sequence guard, test in Task 1.
3. **Partial and failed statuses.** Ids omitted from `chips` render no chip and no button; a 4xx/5xx renders nothing and logs nothing to the user. Test in Task 2.
4. **Double click on Send now.** Both buttons disable on first click until the response; a second click sends nothing. Test in Task 4.
5. **Hostile values.** `label`, `waiting_on`, `debtor_name`, contact names and check reasons are escaped; preview `html` renders only in an `<iframe sandbox>` via `srcdoc`, never `innerHTML`. Test in Tasks 2 and 4.

---

### Task 1: Module skeleton, dark gate, batched statuses

**Files:**
- Create: `customer-noa-panel.js`
- Create: `tests/customer-noa-panel.test.js`
- Modify: `customer-approvals.html` (script tag after `credit-app-fraud-panel.js` at :809; one call at the end of `onRecordsLoaded` :1201)

**Interfaces:**
- Produces: `window.OperFiCustomerNoa = { visible(), isPreview(), onRecords(records, opts), chipFor(id), _state }` where `opts = { email, apiBase, rerender }`; `chipFor(id)` returns the chip object or `null`.
- Test helper (in the test file): `loadPage({ staff, target, enabledOverride, fetchImpl })` builds a JSDOM, defines `window.OPERFI_IMP` stub, evaluates the module source (with `false` swapped to `true` only when `enabledOverride` is set), returns `{ window, calls }` where `calls` lists every fetched URL.

- [x] **Step 1: Write the failing tests**
  - `dark: a broker session makes zero /customer-noa calls and renders nothing` — shipped source unmodified; `staff:false, target:''`; `onRecords(300 records)`; assert `calls.filter(u => u.includes('/customer-noa/')).length === 0`, `visible() === false`.
  - `dark: a broker with a hand-set impersonate target still sees nothing` — `staff:false, target:'x@y.com'`; after 40 ticks, zero calls.
  - `dark: staff NOT impersonating sees nothing` — `staff:true, target:''`; zero calls.
  - `the shipped file has the flag off` — regex `^\s*(['"]use strict['"];\s*)?const CNOA_PORTAL_ENABLED = false;` on the file.
  - `staff impersonating: preview on, statuses batched at 200` — `staff:true, target:'b@x.com'`, 450 records; exactly 3 calls to `/customer-noa/statuses`, each with `email=` and at most 200 ids; `isPreview() === true`.
  - `whoami late: preview turns on when isStaff flips` — staff false at load, true after 5 ticks; statuses called once.
  - `stale response is dropped` — two `onRecords` calls; first response resolves last; `chipFor` reflects the second.
  - `flag on: a broker gets statuses` — `enabledOverride`, `staff:false`; one call; `isPreview() === false`.
- [x] **Step 2:** `npm test -- tests/customer-noa-panel.test.js` → FAIL (module missing).
- [x] **Step 3:** Implement the module. Chunk ids, `Promise.all`, merge `payload.chips` into `_state.chips`, call `opts.rerender()` once after all chunks. Add the script tag and `if (window.OperFiCustomerNoa) OperFiCustomerNoa.onRecords(allRecords, { email: brokerEmail, apiBase: BROKER_API_BASE, rerender: renderList });` at the end of `onRecordsLoaded`.
- [x] **Step 4:** `npm test` → all PASS, including existing suites.
- [x] **Step 5:** Commit `CNOAPORTAL1 Task 1: dark module, gate, batched statuses`.

_Done 11-19: 9/9 new tests pass. Full suite 2556/2574; the 18 failures are pre-existing on origin/main 8b99789 (same 18 on a clean checkout)._

### Task 2: Row chip and row Send NOA button

**Files:** Modify `customer-noa-panel.js`, `tests/customer-noa-panel.test.js`, `customer-approvals.html` (`rowHtml` Customer cell after `caAppRowProgressHtml(r)` :1464; chip CSS in the module via `injectStyles()`, called from `onRecords` only when visible).

**Interfaces:**
- Produces: `rowChipHtml(rec) -> string`, `chipToneClass(chip) -> 'cnoa-tone-done'|'cnoa-tone-wait'|'cnoa-tone-action'|'cnoa-tone-muted'`, `onSendClick(handler)` (Task 4 registers the real handler; default no-op).
- Tone: `Confirmed` → done; status `action_needed` → action; `Released` and `Not sent` → muted; everything else, `Waiting on OperFi verification` included → wait.

- [x] **Step 1: Failing tests**
  - `dark: rowChipHtml returns '' for a broker` (shipped source).
  - `label is verbatim` for each of the 7 labels in the hand-offs, including `Sent from FactorView` and `Action needed: Claim review`.
  - `verification is not styled done` — `chipToneClass({label:'Waiting on OperFi verification', status:'acknowledged'}) === 'cnoa-tone-wait'`.
  - `Send NOA only when can_send === true` — absent for `can_send:false`, `undefined`, `'true'`.
  - `preview tag shows in staff preview` — the text `Preview: hidden from clients` appears once in the row chip html when `isPreview()`; absent with flag on.
  - `no chip for an id the API omitted`, `no chip after a 500`.
  - `label is escaped` — `<img onerror>` label renders as text.
  - `row click on Send NOA does not open the drawer` — JSDOM with the real page html: button has class `row-action`, no `data-action`.
- [x] **Step 2:** Run → FAIL.
- [x] **Step 3:** Implement; add the guarded mount `(window.OperFiCustomerNoa ? OperFiCustomerNoa.rowChipHtml(r) : '') +` in `rowHtml`; one delegated click listener on `#results` bound once.
- [x] **Step 4:** `npm test` → PASS.
- [x] **Step 5:** Commit `CNOAPORTAL1 Task 2: row chip and Send NOA button`.

_Done 11-19: 19/19 module tests. Click binding is one delegated document listener (survives renderList rebuilding #results)._

### Task 3: Drawer section and AP contacts

**Files:** Modify `customer-noa-panel.js`, tests, `customer-approvals.html` (`renderPanel` body after `coBrokerAlertHtml(r) +` :1707; one `wirePanel` call next to the other panel wiring ~:1853).

**Interfaces:**
- Produces: `panelHtml(rec) -> string` (section `id="cnoa-panel"`: chip, `waiting_on` line, `last_sent_at` relative, Send NOA if `can_send`, contacts list placeholder, LOR link), `wirePanel(rec, rootEl)` (GETs `/customer-noa/contacts?email=&submission_id=` once per open, renders `{email,name,phone,role,source,primary}`; `source:"submission"` shows "Suggested from the credit submission"; Add contact form POSTs `/customer-noa/contacts`).
- Errors: 400 `bad_email` → "Not a valid email address."; 400 `too_many_contacts` → "A customer can have up to 10 AP contacts."; 403 → hide the add form.

- [x] **Step 1: Failing tests**
  - `dark: panelHtml '' and wirePanel makes no call for a broker`.
  - `contacts load once per drawer open` (one GET).
  - `add contact body is exactly {email, submission_id, contact:{email,name,phone,role}}` — deepEqual on parsed body, extra fields typed into the DOM ignored.
  - `primary cannot be set from the portal` — no control writes `primary`.
  - `bad_email and too_many_contacts show the mapped text`.
  - `LOR link points to https://lor-request.operfi.com and there is no release button` — no element with text matching /release/i that is a `<button>`.
- [x] **Step 2:** Run → FAIL. **Step 3:** Implement + mounts. **Step 4:** `npm test` → PASS. **Step 5:** Commit `CNOAPORTAL1 Task 3: drawer NOA section and AP contacts`.

_Done 11-19: 29/29 module tests; full suite unchanged apart from +10 passing (18 pre-existing failures). Contacts cached per submission in `_contacts` for the Task 4 picker._

### Task 4: Send form (preview, send now, have OperFi send)

**Pre-step (before any code): live template check.** Read-only Mongo query against Atlas `core_access` permission templates (handle per `reference_local_mongo_read_write_is_localhost` memory): list every template assigned to an active broker account that includes `page.customer_approvals`, and whether it carries `action.customer.send_noa`. Write the result (template name, account count, has/lacks) into this plan under the task. Report gaps to Tom. Do not patch templates. Owner gets it automatically, per the hand-off.

**Template check result (11-19, Atlas core_access, read-only):** every template that holds `page.customer_approvals` LACKS `action.customer.send_noa`: global `Owner / Full Access` and `Credit`, plus account copies `Credit (copy)` (0 active users), `Freight Agent Access` (3), `Accounting (copy)` (1). Account owners (384 active, `is_account_owner`) get it automatically per the hand-off. **Gap: ~157 active non-owner users** (133 on Owner / Full Access without a direct grant, 19 on Credit, 3 Freight Agent, 1 Accounting copy, 1 other) would get 403 on preview/send/add-contact. Cause: `seed_starter_templates` reuses existing templates and never rewrites them, so the cap added to STARTER_TEMPLATES never reached the stored ones. NOT patched (rule). Must be resolved before the flip; reported to Tom.

**Files:** Modify `customer-noa-panel.js`, tests.

**Interfaces:**
- Consumes: `onSendClick` (Task 2), `panelHtml` Send NOA button (Task 3), contacts (Task 3).
- Produces: `openSendForm(rec)` modal: contact picker (existing contacts + "New contact": email, name, phone, role), note, `Preview` button, iframe preview, `Send now` (`mode:"self"`), `Have OperFi send it for me` (`mode:"operfi"`).
- `CHECK_TEXT` map, copied verbatim from the 11-03 hand-off table: `free_mail`, `lookalike_domain`, `client_domain`, `client_user`, `credit_contact`, `bad_email`, `domain_mismatch` (warning), `role_address` (positive). Unknown code → "This address can't be used for an NOA."
- Response handling: 200 → close, toast "NOA sent to <email>" / "Request sent. OperFi will send it.", refresh that id's chip via `GET /customer-noa/status`; 409 `no_master` → "We don't have a signed NOA on file for your company yet. OperFi will reach out."; 409 `blocked_contact` → list block reasons + "Use a different address."; 409 `bad_state` → "This customer has already acknowledged or confirmed the NOA."; 503 → "Sending is unavailable right now. Try again in a few minutes."; 403 → "You don't have permission to send NOAs. Ask your account owner."

- [x] **Step 1: Failing tests**
  - `preview body is exactly {email, submission_id, contact:{email,name}, note}`.
  - `send body is exactly {email, submission_id, contact:{email,name,phone,role}, note, mode}` for both modes.
  - `no forbidden key ever leaves the module` — wrap fetch, across every POST in the suite assert none of `status, confirmed_by, kind, force, verified_domain, client, debtor` at any depth.
  - `each check code shows its mapped text`; `unknown code shows the fallback`.
  - `blocked_contact offers no override` — no button other than Back / change-address after a block.
  - `double click sends once`.
  - `preview html goes into a sandboxed iframe srcdoc, never innerHTML` — iframe has `sandbox=""`.
  - `each error status shows its mapped text`.
  - `dark: openSendForm is a no-op for a broker`.
- [x] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS. **Step 5:** Commit `CNOAPORTAL1 Task 4: send form`.

_Done 11-19: 42/42 module tests. A preview that returns blocks also switches the form to the blocked state, so a blocked address never reaches Send. Template gap above still open (pre-flip)._

### Task 5: NOA bell

**Files:** Modify `customer-noa-panel.js`, tests, `customer-approvals.html` (one guarded call at the end of `buildChips()`: `if (window.OperFiCustomerNoa) OperFiCustomerNoa.mountBell(chips, openPanelForId);` where `openPanelForId(id)` is a 3-line helper next to `openPanel`).

**Interfaces:**
- Consumes: `onRecords` opts (email, apiBase).
- Produces: `mountBell(chipsEl, openFn)`. `GET /customer-noa/attention?email=` once per list load (fetched inside `onRecords`, cached; `mountBell` only paints, since `buildChips` reruns on filter changes). Chip text `🔔 NOA updates <count>`. Click: dropdown of items; POST `/customer-noa/seen` `{email, submission_ids}` with the shown ids; on 200 the count clears.

- [x] **Step 1: Failing tests**
  - `dark: no bell, no attention call for a broker`.
  - `attention fetched once per load even when buildChips runs 5 times`.
  - `no bell when items is empty`.
  - `seen body is exactly {email, submission_ids}`; `count clears only on 200`.
  - `kind confirmed vs action_needed show different item lines` ("NOA confirmed" / chip label).
  - `debtor_name escaped`.
- [x] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS. **Step 5:** Commit `CNOAPORTAL1 Task 5: NOA bell`.

_Done 11-19: 50/50 module tests. `openPanelForId` clears status/search/attention filters when the target row is filtered out, since openPanel only opens visible rows._

### Task 6: Portal asset allowlist (operfi-broker-api)

`broker_portal.py` is shell code this session owns; it is not a `customer_noa_*` module.

**Files:** operfi-broker-api `broker_portal.py:130` `ALLOWED_ASSETS`; the existing allowlist test (find with `git grep -n ALLOWED_ASSETS tests/`).

- [ ] **Step 1:** Worktree off operfi-broker-api `origin/main` (fetch first), branch `cnoaportal1-asset`.
- [ ] **Step 2:** Add a failing assertion that `"customer-noa-panel.js" in ALLOWED_ASSETS`; run that test file → FAIL.
- [ ] **Step 3:** Add the entry with a comment: "CNOAPORTAL1. Makes its own /customer-noa/* calls; dark behind CNOA_PORTAL_ENABLED in the file."
- [ ] **Step 4:** Run the test file → PASS; run the full suite.
- [ ] **Step 5:** Commit, push, open PR. Merge rules in Task 7.

### Task 7: Browser verification, PRs, merge

- [ ] **Step 1:** Local build only: temporarily set the flag to `true` in the worktree (never committed), serve widget-host locally, open Customer Approvals in Chrome as OperFi staff impersonating `ZZ TEST HAULING LLC` or `TESTING OPERFI ACCOUNT`. Read the rendered page: chips on rows, drawer section, contacts, send form, preview iframe, bell, `Preview: hidden from clients` tag. Screenshot each.
- [ ] **Step 2:** One real send, `mode:"self"`, to an OperFi-owned AP mailbox on the test client. Confirm the email lands and the chip moves to `Waiting on <address>`. One `mode:"operfi"` request. Tell the NOA Center session both test records exist so ops can clear them.
- [ ] **Step 3:** Revert the flag, confirm `git diff` shows `false`; rerun `npm test`.
- [ ] **Step 4:** Also verify dark on the real page: impersonation off, as a broker view, DevTools network shows zero `/customer-noa/` requests.
- [ ] **Step 5:** Push `cnoaportal1`, open the widget-host PR (body: what it adds, dark switch, how to flip, Help Center text to ship with the flip, template-check result).
- [ ] **Step 6 (merge, Tom authorized overnight 11-19):** Merge order: API allowlist PR first, then widget-host. Before merging the API PR: check `ops_telemetry.carrier_live_runs` for a fresh in-flight run (judge row age), and that no other API deploy landed in the last 30 minutes. Wait for Render deploy live, then merge widget-host. After deploy: load Customer Approvals as a broker and confirm zero `/customer-noa/` calls. Flag stays `false`.
