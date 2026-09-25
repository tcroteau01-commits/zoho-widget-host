// tests/approvals.test.js
// The drawer LOSES content on purpose. It became unusable by accretion; this
// test is what stops it happening again.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

// 🚨 Normalised to \n. The file is checked out with CRLF on Windows, and a
// pattern anchored on a bare \n matches nothing there -- which reads as "the
// code is missing" rather than "the test is wrong".
const html = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8')
               .replace(/\r\n/g, '\n');

test('the profile script is loaded', () => {
  assert.ok(/<script[^>]+src="customer-profile\.js"/.test(html));
});

// --- the drawer offers the same three decisions the profile does ------------
//
// Tom, 2026-09-25: "In the details pane, i noticed our team has the ability to
// select all of the decision statuses. The only ones our team should be able to
// choose should be Approved, Denied, or Pending Credit App. All the other
// decisions should be handled programatically."

test('the drawer dropdown is built from the three human decisions', () => {
  assert.ok(/var HUMAN_DECISION_VALUES = \['Approved', 'Denied', 'Pending Credit Application'\]/
            .test(html));
  // and the dropdown maps over THAT, not the full vocabulary
  const opts = html.match(/var optsHtml =[\s\S]*?\.join\(''\);/)[0];
  assert.ok(opts.includes('HUMAN_DECISION_VALUES.map'));
  assert.ok(!/\bDECISION_VALUES\.map/.test(opts.replace(/HUMAN_DECISION_VALUES/g, '')));
});

test('a status the system set is still shown, but not offered', () => {
  // Otherwise the box reads "Approved" on a record sitting at "Credit App Sent"
  // and the next save changes a status nobody meant to touch.
  const opts = html.match(/var optsHtml =[\s\S]*?\.join\(''\);/)[0];
  assert.ok(opts.includes('selected disabled'));
  assert.ok(opts.includes('set automatically'));
});

test('the full vocabulary survives for reading stored values', () => {
  // DECISION_VALUES is what a STORED value is validated against; narrowing it
  // would make every machine-set status read as invalid.
  assert.ok(/var DECISION_VALUES = \[[\s\S]*?'Expired'\]/.test(html));
});

// --- clicking "Use this" must visibly do something --------------------------
//
// 🚨 Confirming a company is no longer a quick write: it searches, buys a
// billable Creditsafe report and re-runs the gate. That is SECONDS behind one
// click, and the button gave no sign it had been pressed -- so the analyst's
// natural next move is to click again, and a second click on a DIFFERENT
// candidate races two pins with the loser silently overwriting the winner.
//
// Exercised against a real DOM rather than grepped: a lock that reads correctly
// and selects nothing looks exactly like one that works.
const { JSDOM } = require('jsdom');

function busyFns() {
  const src = html.match(/var PROFILE_ACTIONS =[\s\S]*?\n}\n/)[0];
  const dom = new JSDOM(`<div id="ca-profile">
    <button data-cs-pick="US1">Use this</button>
    <button data-cs-pick="US2">Use this</button>
    <button data-cs-absent="1">Not in Creditsafe</button>
    <button data-pull-report="1">Get credit report</button>
    <button data-decide="Approved">Approved</button>
    <button id="unrelated">Back</button>
  </div>`);
  const make = new Function('document', 'esc',
    src + '; return setProfileBusy;');
  return { dom, setProfileBusy: make(dom.window.document, String) };
}

test('confirming a company locks every action on the profile', () => {
  const { dom, setProfileBusy } = busyFns();
  const d = dom.window.document;
  const clicked = d.querySelector('[data-cs-pick="US1"]');
  setProfileBusy(clicked, 'Getting report…');

  assert.ok(clicked.disabled, 'the pressed button is still live');
  // 🚨 the one that actually matters: a second, DIFFERENT candidate
  assert.ok(d.querySelector('[data-cs-pick="US2"]').disabled);
  assert.ok(d.querySelector('[data-cs-absent]').disabled);
  assert.ok(d.querySelector('[data-pull-report]').disabled);
  assert.ok(d.querySelector('[data-decide]').disabled);
  // and nothing outside the action set
  assert.strictEqual(d.getElementById('unrelated').disabled, false);
});

test('the pressed button says what is happening, with a spinner', () => {
  const { dom, setProfileBusy } = busyFns();
  const clicked = dom.window.document.querySelector('[data-cs-pick="US1"]');
  setProfileBusy(clicked, 'Getting report…');
  assert.ok(clicked.textContent.includes('Getting report'));
  assert.ok(clicked.querySelector('.cp-spin'), 'no spinner rendered');
});

test('a failure gives the buttons back, with their labels', () => {
  const { dom, setProfileBusy } = busyFns();
  const d = dom.window.document;
  const clicked = d.querySelector('[data-cs-pick="US1"]');
  const undo = setProfileBusy(clicked, 'Getting report…');
  undo();
  assert.strictEqual(clicked.disabled, false);
  assert.strictEqual(clicked.textContent.trim(), 'Use this');
  assert.strictEqual(d.querySelector('[data-cs-pick="US2"]').disabled, false);
});

test('a button already disabled stays disabled after an undo', () => {
  // Otherwise a failed pin hands back a control the page had deliberately
  // switched off.
  const { dom, setProfileBusy } = busyFns();
  const other = dom.window.document.querySelector('[data-cs-pick="US2"]');
  other.disabled = true;
  const undo = setProfileBusy(dom.window.document.querySelector('[data-cs-pick="US1"]'), 'x');
  undo();
  assert.ok(other.disabled);
});

test('success does NOT hand the buttons back before the re-render', () => {
  // The pin has landed and the profile re-fetch is another wait; flicking back
  // to live buttons for a second invites the double-click all over again.
  const pin = html.match(/function pinCustomer[\s\S]*?\n}\n/)[0];
  const thenBlock = pin.slice(pin.indexOf('.then(function()'), pin.indexOf('.catch('));
  assert.ok(!/undo\(\)/.test(thenBlock), 'success path restores the buttons');
  assert.ok(/undo\(\)/.test(pin.slice(pin.indexOf('.catch('))), 'failure path does not');
});

test('every control that starts server work passes its button', () => {
  // A caller that forgets leaves that one button looking dead-but-clickable.
  ['data-cs-pick', 'data-fv-pick', 'data-cs-absent', 'data-cs-unabsent',
   'data-cs-clear'].forEach((attr) => {
    const re = new RegExp('\\[' + attr + '\\][\\s\\S]{0,420}?pinCustomer\\([^;]*?btn,');
    assert.ok(re.test(html), attr + ' calls pinCustomer without its button');
  });
});

test('there is a control that opens the full profile', () => {
  assert.ok(/id="ca-open-profile"/.test(html));
});

test('the drawer no longer carries the sections that moved out', () => {
  assert.ok(!html.includes('>Customer Company<'));
  assert.ok(!html.includes('>Broker Comments<'));
  // Customer Contacts as a DISPLAY (the read-only contact fields) is gone --
  // its heading no longer appears. The billing editor that used to sit inside
  // it is an ACTION, not a display, and stays under its own "Billing Info"
  // heading, so this must not regress if that heading is ever renamed back.
  assert.ok(!html.includes('>Customer Contacts<'));
});

test('the decision form stays in the drawer', () => {
  assert.ok(html.includes('panel-section-title">Make a Decision</div>'));
});

test('the billing editor stays in the drawer as an action, not a display', () => {
  assert.ok(/id="ca-edit-billing"/.test(html));
  assert.ok(/id="ca-billing-edit"/.test(html));
  assert.ok(html.includes('wireBillingEdit(r)'));
});

test('the profile fetches by submission id', () => {
  assert.ok(html.includes("'/customer-profile/'"));
});

test('the profile container exists and starts hidden', () => {
  assert.ok(/id="ca-profile"/.test(html));
});

test('the profile button is not offered to brokers', () => {
  // The page is broker-facing. An unconditional button advertises a staff-only
  // page and then fails with a message about their connection.
  assert.ok(/allClients[\s\S]{0,400}ca-open-profile|ca-open-profile[\s\S]{0,400}allClients/.test(html));
});

test('a permissions failure does not read as a network problem', () => {
  assert.ok(/403/.test(html));
});

test('a missing renderer is reported as a deploy problem, not a network one', () => {
  // 🚨 customer-profile.js is served through broker_portal.py's ALLOWED_ASSETS,
  // and CUSTPROF1 shipped without it listed. The page said "Check your
  // connection and try again" -- the one diagnosis that was certainly wrong --
  // after the GET had already bought a billable Creditsafe search.
  assert.ok(/typeof OperFiCustomerProfile === 'undefined'/.test(html));
  assert.ok(/not your connection/i.test(html));
  // and the guard must come BEFORE the fetch, or the search is already paid for
  assert.ok(html.indexOf("typeof OperFiCustomerProfile === 'undefined'")
            < html.indexOf('fetchProfile(rec);'));
});

test("the profile's own styles reach the browser", () => {
  // injectStyles() is only reachable through mount() inside customer-profile.js;
  // render() alone never calls it. renderProfile must call it itself, or the
  // cp-* candidate rows render with no card layout at all -- and an analyst can
  // misclick "Use this" against the wrong company.
  assert.ok(/injectStyles\s*\(\s*\)/.test(html));
});
