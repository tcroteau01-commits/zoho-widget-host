// BPOC1 -- the Submit Load customer picker grays out an approved customer whose
// billing contact is not on file, instead of letting the broker build the whole load
// and collect a 403 from /funding-submit at the very end.
//
// Mirrors the carrier gate in load-details.test.mjs: a suffix on the label, `disabled`
// on the option, and a hint that says what to do about it.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function boot(fetchImpl) {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = fetchImpl;
  w.ZOHO = { CREATOR: { UTIL: { getInitParams: () => ({ loginUser: 'b@x.com' }) },
                        init: () => Promise.resolve() } };
  w.OperFiAV = { carrierBadge: () => {}, customerCredit: () => {} };
  w.brokerEmail = 'b@x.com';
  return w;
}

function customersFetch(customers) {
  return (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(
    String(url).includes('/tms-customers') ? { customers } : { carriers: [] }) });
}

const APPROVED_COMPLETE = { customer_id: 'c1', customer_name: 'ACME',
                            credit_decision: 'Approved', billing_complete: true };
const APPROVED_MISSING = { customer_id: 'c2', customer_name: 'GAMMA',
                           credit_decision: 'Approved', billing_complete: false };

function options(w) {
  return [...w.document.querySelectorAll('#customer-select option')];
}

test('customerBillingIncomplete is true only when the backend explicitly says false', () => {
  const w = boot(customersFetch([]));
  assert.strictEqual(w.customerBillingIncomplete({ billing_complete: false }), true);
  assert.strictEqual(w.customerBillingIncomplete({ billing_complete: true }), false);
});

test('a customer with no billing_complete field at all is NOT blocked', () => {
  // Fail open on absence. The widget can be served from cache against a backend that
  // predates this flag; blocking every customer because a field is missing would take
  // the whole portal down, and /funding-submit is the real gate either way.
  const w = boot(customersFetch([]));
  assert.strictEqual(w.customerBillingIncomplete({}), false);
  assert.strictEqual(w.customerBillingIncomplete({ billing_complete: undefined }), false);
});

test('an approved customer missing billing info is disabled and labelled', async () => {
  const w = boot(customersFetch([APPROVED_COMPLETE, APPROVED_MISSING]));
  await w.loadCustomers();
  const ok = options(w).find(o => o.value === 'c1');
  const bad = options(w).find(o => o.value === 'c2');
  assert.strictEqual(ok.disabled, false, 'complete customer stays selectable');
  assert.doesNotMatch(ok.textContent, /Billing contact required/);
  assert.strictEqual(bad.disabled, true, 'incomplete customer is disabled');
  assert.match(bad.textContent, /GAMMA/);
  assert.match(bad.textContent, /Billing contact required/);
});

test('the incomplete customer is still LISTED, not filtered out', async () => {
  // Hiding it would just reproduce the current confusion -- the broker looks for a
  // customer they know is approved, cannot find it, and calls support.
  const w = boot(customersFetch([APPROVED_MISSING]));
  await w.loadCustomers();
  assert.ok(options(w).some(o => o.value === 'c2'), 'GAMMA should appear in the list');
});

test('the billing hint appears only when at least one customer is blocked', async () => {
  const w1 = boot(customersFetch([APPROVED_COMPLETE]));
  await w1.loadCustomers();
  const hint1 = w1.document.getElementById('customer-billing-hint');
  assert.ok(hint1, '#customer-billing-hint should exist in the markup');
  assert.strictEqual(hint1.style.display, 'none', 'hidden when nothing is blocked');

  const w2 = boot(customersFetch([APPROVED_COMPLETE, APPROVED_MISSING]));
  await w2.loadCustomers();
  const hint2 = w2.document.getElementById('customer-billing-hint');
  assert.notStrictEqual(hint2.style.display, 'none', 'shown when one is blocked');
  assert.match(hint2.textContent, /Customer Approvals/,
    'hint must say where to go fix it');
});

test('a non-fundable customer is still filtered out entirely, billing or not', async () => {
  const w = boot(customersFetch([
    { customer_id: 'c8', customer_name: 'BETA', credit_decision: 'Declined', billing_complete: true }
  ]));
  await w.loadCustomers();
  assert.ok(!options(w).some(o => o.value === 'c8'), 'Declined stays filtered out');
});

test('a boost-pending customer is gated on billing like any other fundable one', async () => {
  const w = boot(customersFetch([
    { customer_id: 'c7', customer_name: 'DELTA',
      credit_decision: 'Credit Boost Requested', billing_complete: false }
  ]));
  await w.loadCustomers();
  const o = options(w).find(x => x.value === 'c7');
  assert.ok(o, 'boost customer is listed');
  assert.strictEqual(o.disabled, true);
});

test('the submit path surfaces the backend billing refusal in plain words', () => {
  // /funding-submit answers 403 {code:"billing_incomplete"}; the widget must not show
  // a bare "403" or the generic failure copy for it.
  assert.match(HTML, /billing_incomplete/,
    'index.html should recognise the billing_incomplete error code');
});
