// BPOC1 -- Draft Loads promotes through /draft-loads/submit, a path of its own that
// never calls /funding-submit. It gets the same billing gate, so the customer picker
// has to show it and the skip reason has to read like English.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../draft-loads.html', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

test('the customer_billing_incomplete skip reason has plain-English text', () => {
  const w = boot();
  const text = w.REASON_TEXT && w.REASON_TEXT.customer_billing_incomplete;
  assert.ok(text, 'REASON_TEXT needs a customer_billing_incomplete entry');
  assert.match(text, /billing/i);
  assert.doesNotMatch(text, /_/, 'must not leak the raw reason code to the broker');
});

test('the picker disables and labels a customer with no billing contact', () => {
  const w = boot();
  w.__state.customers = [
    { customer_id: 'c1', customer_name: 'ACME', billing_complete: true },
    { customer_id: 'c2', customer_name: 'GAMMA', billing_complete: false }
  ];
  const d = new JSDOM('<select>' + w.customerOptions('', []) + '</select>').window.document;
  const opts = [...d.querySelectorAll('option')];
  const ok = opts.find(o => o.value === 'c1');
  const bad = opts.find(o => o.value === 'c2');
  assert.strictEqual(ok.disabled, false);
  assert.strictEqual(bad.disabled, true, 'incomplete customer must not be pickable');
  assert.match(bad.textContent, /Billing contact required/);
});

test('a match candidate is gated on the flag from the loaded customer list', () => {
  // Candidates come back from the name matcher and carry no billing flag of their own,
  // so the gate has to look the customer up in __state.customers. Without that, every
  // matched customer would sail through the picker.
  const w = boot();
  w.__state.customers = [{ customer_id: 'c2', customer_name: 'GAMMA', billing_complete: false }];
  const html = w.customerOptions('', [{ customer_id: 'c2', name: 'GAMMA', score: 0.91 }]);
  const d = new JSDOM('<select>' + html + '</select>').window.document;
  const bad = d.querySelector('option[value="c2"]');
  assert.strictEqual(bad.disabled, true);
  assert.match(bad.textContent, /91% match/, 'the match score is still shown');
  assert.match(bad.textContent, /Billing contact required/);
});

test('an unknown customer is not blocked just because it is missing from the list', () => {
  // Fail open on absence, same rule as the Load Details picker.
  const w = boot();
  w.__state.customers = [];
  const html = w.customerOptions('', [{ customer_id: 'cX', name: 'MYSTERY', score: 0.8 }]);
  const d = new JSDOM('<select>' + html + '</select>').window.document;
  assert.strictEqual(d.querySelector('option[value="cX"]').disabled, false);
});
