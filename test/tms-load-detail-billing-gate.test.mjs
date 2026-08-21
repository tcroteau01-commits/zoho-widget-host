// BPOC1 -- the TMS load board submits through /tms-submit, which now refuses a load
// whose customer has no billing contact. The booking picker shows that up front.
//
// An already-booked customer is a deliberate exception: ensureCustomerOption re-adds it
// on edit so the select can still display what the load is actually set to. Disabling
// that option would render the field blank and risk a save wiping the customer.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

const CUSTOMERS = [
  { customer_id: 'c1', customer_name: 'ACME', credit_decision: 'Approved', billing_complete: true },
  { customer_id: 'c2', customer_name: 'GAMMA', credit_decision: 'Approved', billing_complete: false },
  { customer_id: 'c3', customer_name: 'DELTA', credit_decision: 'Approved' }
];

function opts(w) {
  return [...w.document.querySelectorAll('#f-customer_id option')];
}

test('a bookable customer with no billing contact is disabled and labelled', () => {
  const w = boot();
  w.populateCustomers(CUSTOMERS);
  const bad = opts(w).find(o => o.value === 'c2');
  assert.ok(bad, 'GAMMA is still listed');
  assert.strictEqual(bad.disabled, true);
  assert.match(bad.textContent, /Billing contact required/);
});

test('a customer with billing on file is untouched', () => {
  const w = boot();
  w.populateCustomers(CUSTOMERS);
  const ok = opts(w).find(o => o.value === 'c1');
  assert.strictEqual(ok.disabled, false);
  assert.strictEqual(ok.textContent, 'ACME');
});

test('a customer with no billing flag at all is not blocked', () => {
  const w = boot();
  w.populateCustomers(CUSTOMERS);
  const unknown = opts(w).find(o => o.value === 'c3');
  assert.strictEqual(unknown.disabled, false, 'absence must fail open');
});

test('ensureCustomerOption re-enables the customer the load is already booked to', () => {
  // The real hazard: a load already booked to GAMMA, whose option populateCustomers
  // just disabled. A disabled option cannot be selected, so the field would render
  // blank and a save from a blank select would drop the customer off the load
  // entirely. The booked customer stays selectable; /tms-submit still refuses it.
  const w = boot();
  w.populateCustomers(CUSTOMERS);
  assert.strictEqual(opts(w).find(o => o.value === 'c2').disabled, true);

  w.ensureCustomerOption('c2');
  const booked = opts(w).find(o => o.value === 'c2');
  assert.strictEqual(booked.disabled, false, 'the booked customer must be selectable');
  assert.match(booked.textContent, /Billing contact required/,
    'but it still says why the load will not submit');
});
