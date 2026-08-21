// BPOC1 -- Customer Approvals warns when an approved customer has no billing contact
// on file, and puts the fix one click away using the CA1 inline edit that already
// exists on the detail panel. Without this the broker only finds out at Submit Load.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

function boot() {
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true }).window;
}

const BILLING = {
  Billing_Point_of_Contact: 'Pat Pay',
  Billing_AP_Contact_Number: '+15551112222',
  Billing_Email: 'ap@acme.com'
};

function rec(over) {
  return Object.assign({ ID: '1', Customer_Company_Name: 'ACME',
                         Credit_Decision: 'Approved' }, BILLING, over || {});
}

// ── the predicate ────────────────────────────────────────────────────────────

test('billingIncomplete is false when all three fields are on file', () => {
  assert.strictEqual(boot().billingIncomplete(rec()), false);
});

test('billingIncomplete is true when any one of the three is missing', () => {
  const w = boot();
  for (const f of Object.keys(BILLING)) {
    const r = rec(); delete r[f];
    assert.strictEqual(w.billingIncomplete(r), true, f + ' missing should count');
  }
});

test('billingIncomplete treats blank and whitespace-only as missing', () => {
  const w = boot();
  assert.strictEqual(w.billingIncomplete(rec({ Billing_Email: '' })), true);
  assert.strictEqual(w.billingIncomplete(rec({ Billing_Email: '   ' })), true);
  assert.strictEqual(w.billingIncomplete(rec({ Billing_Point_of_Contact: null })), true);
});

// ── who gets warned ──────────────────────────────────────────────────────────

test('needsBillingWarning fires for Approved and Credit Boost Requested', () => {
  const w = boot();
  const bare = { ID: '1', Customer_Company_Name: 'ACME' };
  assert.strictEqual(w.needsBillingWarning(Object.assign({}, bare,
    { Credit_Decision: 'Approved' })), true);
  assert.strictEqual(w.needsBillingWarning(Object.assign({}, bare,
    { Credit_Decision: 'Credit Boost Requested' })), true);
});

test('needsBillingWarning stays quiet for customers who cannot fund yet anyway', () => {
  // Nagging about billing on a customer still awaiting a credit decision is noise --
  // they may never be approved, and it buries the warning that matters.
  const w = boot();
  const bare = { ID: '1', Customer_Company_Name: 'ACME' };
  for (const d of ['Awaiting Credit Decision', 'Denied', 'Expired',
                   'Pending Credit Application', "Credit App Rec'd - Pending Review"]) {
    assert.strictEqual(w.needsBillingWarning(Object.assign({}, bare, { Credit_Decision: d })),
      false, d + ' should not warn');
  }
});

test('needsBillingWarning stays quiet when the billing contact is already on file', () => {
  assert.strictEqual(boot().needsBillingWarning(rec()), false);
});

// ── the row ──────────────────────────────────────────────────────────────────

test('an approved customer missing billing renders a warning on its row', () => {
  const w = boot();
  const h = w.rowHtml(rec({ Billing_Email: '' }), 0);
  assert.match(h, /billing-warn/, 'row should carry the warning element');
  assert.match(h, /Billing contact required/i);
});

test('a complete approved customer renders no warning on its row', () => {
  assert.doesNotMatch(boot().rowHtml(rec(), 0), /billing-warn/);
});

test('a denied customer missing billing renders no warning on its row', () => {
  const w = boot();
  const h = w.rowHtml(rec({ Credit_Decision: 'Denied', Billing_Email: '' }), 0);
  assert.doesNotMatch(h, /billing-warn/);
});

test('the row warning does not disturb the existing row actions', () => {
  // The warning is additive: an approved customer keeps Request Credit Boost.
  const h = boot().rowHtml(rec({ Billing_Email: '' }), 0);
  assert.match(h, /Request Credit Boost/);
});

// ── the detail panel ─────────────────────────────────────────────────────────

test('the panel callout markup names the three fields and offers the fix', () => {
  const w = boot();
  const h = w.billingAlertHtml(rec({ Billing_Email: '' }));
  assert.match(h, /ca-billing-alert/);
  assert.match(h, /ca-billing-alert-fix/, 'callout needs a button that opens the editor');
  assert.match(h, /name.*phone.*email/is, 'callout should say which fields are needed');
});

test('the panel callout is empty for a customer that does not need it', () => {
  const w = boot();
  assert.strictEqual(w.billingAlertHtml(rec()), '');
  assert.strictEqual(w.billingAlertHtml(rec({ Credit_Decision: 'Denied', Billing_Email: '' })), '');
});

test('the callout Fix button opens the existing CA1 inline billing editor', () => {
  const w = boot();
  const d = w.document;
  // Stand up the panel fragment the same way renderPanel does, then wire it.
  d.body.innerHTML =
    '<button id="ca-edit-billing"></button>' +
    w.billingAlertHtml(rec({ Billing_Email: '' })) +
    '<div id="ca-billing-edit" style="display:none;">' +
      '<input id="ca-bill-poc"><input id="ca-bill-phone"><input id="ca-bill-email">' +
      '<div id="ca-bill-msg"></div>' +
      '<button id="ca-bill-cancel"></button><button id="ca-bill-save"></button>' +
    '</div>';
  w.wireBillingEdit(rec({ Billing_Email: '' }));

  assert.strictEqual(d.getElementById('ca-billing-edit').style.display, 'none');
  d.getElementById('ca-billing-alert-fix').dispatchEvent(new w.Event('click'));
  assert.notStrictEqual(d.getElementById('ca-billing-edit').style.display, 'none',
    'clicking Fix should reveal the editor');
  assert.strictEqual(d.getElementById('ca-bill-poc').value, 'Pat Pay',
    'editor should be prefilled from the record');
});

test('the amber warning style is defined, not borrowed from the denied/red palette', () => {
  assert.match(html, /\.billing-warn\s*\{/, 'billing-warn needs its own rule');
});

test('saving billing info clears the warning from the row behind the panel', async () => {
  // The panel re-renders itself on save. The row underneath must refresh too, or the
  // broker fixes the billing contact, closes the panel, and the warning is still there.
  const w = boot();
  const d = w.document;
  // Let the widget's own window-load boot run FIRST (with no ZOHO stub it bails out
  // via showError, rewriting #results). Rendering after it means nothing but the save
  // can touch #results, so this test cannot pass by having the list wiped out from
  // under it -- which is exactly how an earlier version of it passed while broken.
  await new Promise(r => setTimeout(r, 50));

  const record = { ID: '7', Customer_Company_Name: 'ACME', Credit_Decision: 'Approved',
                   Credit_Limit: '30000' };
  w.brokerEmail = 'b@x.com';
  w.onRecordsLoaded([record]);
  const results = () => d.getElementById('results').innerHTML;
  assert.match(results(), /billing-warn/, 'row starts out warning');
  assert.match(results(), /ACME/, 'row is rendered');

  d.body.insertAdjacentHTML('beforeend',
    '<button id="ca-edit-billing"></button>' +
    '<div id="ca-billing-edit" style="display:none;">' +
      '<input id="ca-bill-poc"><input id="ca-bill-phone"><input id="ca-bill-email">' +
      '<div id="ca-bill-msg"></div>' +
      '<button id="ca-bill-cancel"></button><button id="ca-bill-save"></button>' +
    '</div>');
  w.wireBillingEdit(record);
  d.getElementById('ca-bill-poc').value = 'Pat Pay';
  d.getElementById('ca-bill-phone').value = '5551112222';
  d.getElementById('ca-bill-email').value = 'ap@acme.com';
  w.fetch = () => Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') });

  d.getElementById('ca-bill-save').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 900));   // save resolves, then re-render fires

  assert.match(results(), /ACME/, 'the row must still be rendered, not wiped');
  assert.doesNotMatch(results(), /billing-warn/,
    'row warning should be gone after the save');
});
