// CRSTAT1 — a Customer_Submission created through the portal API lands with a BLANK
// Credit_Decision, because Creator's form-level initial value only fires when a human
// opens the form and the form's on-load rule hides the field. The backend now stamps it,
// but the widget treats blank as Awaiting anyway: any record that slips through must not
// fall out of the credit team's queue again.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

function boot() {
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true }).window;
}

test('a blank Credit_Decision reads as Awaiting Decision, not a bare dash', () => {
  const w = boot();
  const m = w.statusMeta({ ID: '1', Credit_Decision: '' });
  assert.strictEqual(m.key, 'awaiting');
  assert.strictEqual(m.label, 'Awaiting Decision');
  assert.strictEqual(m.pill, 'awaiting');
});

test('a missing Credit_Decision field reads the same way', () => {
  assert.strictEqual(boot().statusMeta({ ID: '1' }).key, 'awaiting');
});

test('whitespace counts as blank', () => {
  assert.strictEqual(boot().statusMeta({ ID: '1', Credit_Decision: '   ' }).key, 'awaiting');
});

test('a genuinely unrecognised value still shows as unknown, not silently Awaiting', () => {
  // Masking an unexpected value would hide the next breakage. Only BLANK is assumed.
  const m = boot().statusMeta({ ID: '1', Credit_Decision: 'Somebody Renamed This' });
  assert.strictEqual(m.key, 'unknown');
  assert.strictEqual(m.label, 'Somebody Renamed This');
});

test('the eight known decisions are untouched', () => {
  const w = boot();
  assert.strictEqual(w.statusMeta({ Credit_Decision: 'Approved' }).key, 'approved');
  assert.strictEqual(w.statusMeta({ Credit_Decision: 'Denied' }).key, 'denied');
  assert.strictEqual(w.statusMeta({ Credit_Decision: 'Expired' }).key, 'expired');
  assert.strictEqual(w.statusMeta({ Credit_Decision: 'Credit Boost Requested' }).key, 'boost');
});

test('blank records are counted in the Awaiting KPI and chip', async () => {
  // The whole point: 200+ submissions were invisible in the queue because blank was not
  // a recognised status.
  const w = boot();
  await new Promise(r => setTimeout(r, 50));    // let the widget's own boot settle
  w.onRecordsLoaded([
    { ID: '1', Customer_Company_Name: 'BLANK CO', Credit_Decision: '' },
    { ID: '2', Customer_Company_Name: 'AWAIT CO', Credit_Decision: 'Awaiting Credit Decision' },
    { ID: '3', Customer_Company_Name: 'OK CO', Credit_Decision: 'Approved', Credit_Limit: '30000' }
  ]);
  assert.strictEqual(w.document.getElementById('kpi-awaiting').textContent, '2');
  const results = w.document.getElementById('results').innerHTML;
  assert.match(results, /BLANK CO/);
  assert.doesNotMatch(results, /s-unknown/, 'no row should render as unknown');
});

test('a blank record does not preselect Approved in the decision editor', () => {
  // DECISION_VALUES[0] is 'Approved', so with nothing marked selected the browser picks
  // it -- a credit user opening an untouched submission would see "Approved" already in
  // the box. Blank must land on Awaiting Credit Decision instead.
  const w = boot();
  assert.strictEqual(w.DECISION_VALUES[0], 'Approved', 'guard: first option is still Approved');
  const sel = w.decisionSelectValue({ Credit_Decision: '' });
  assert.strictEqual(sel, 'Awaiting Credit Decision');
});

test('the decision editor still preselects whatever decision is actually set', () => {
  const w = boot();
  assert.strictEqual(w.decisionSelectValue({ Credit_Decision: 'Denied' }), 'Denied');
  assert.strictEqual(w.decisionSelectValue({ Credit_Decision: 'Approved' }), 'Approved');
});
