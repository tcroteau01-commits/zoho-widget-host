import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

// Fixture mirrors the SORT1 (view-vendors) fixture shape: one missing-date
// record to prove "missing dates sort last" in both date directions.
const RECORDS = [
  { ID: '1', Customer_Company_Name: 'Charlie Co',  Added_Time: '01-Jan-2024 00:00:00' },
  { ID: '2', Customer_Company_Name: 'alpha co',    Added_Time: '15-Jun-2026 00:00:00' },
  { ID: '3', Customer_Company_Name: 'Bravo Co' /* no Added_Time */ }
];

function names(arr) {
  return arr.map(function(r) { return r.Customer_Company_Name; });
}

test('sort-select exists in the toolbar with the four options, Newest selected by default', () => {
  const w = boot();
  const sel = w.document.getElementById('sort-select');
  assert.ok(sel, '#sort-select present');
  const vals = [...sel.options].map(function(o) { return o.value; });
  assert.deepEqual(vals, ['newest', 'oldest', 'name_asc', 'name_desc']);
  assert.strictEqual(sel.value, 'newest');
});

test('sortRecords does not mutate the input array', () => {
  const w = boot();
  const copy = RECORDS.slice();
  w.sortRecords(RECORDS, 'oldest');
  assert.deepEqual(RECORDS, copy);
});

test('newest sorts Added_Time descending, missing date last', () => {
  const w = boot();
  assert.deepEqual(names(w.sortRecords(RECORDS, 'newest')), ['alpha co', 'Charlie Co', 'Bravo Co']);
});

test('oldest sorts Added_Time ascending, missing date last', () => {
  const w = boot();
  assert.deepEqual(names(w.sortRecords(RECORDS, 'oldest')), ['Charlie Co', 'alpha co', 'Bravo Co']);
});

test('name_asc sorts case-insensitively', () => {
  const w = boot();
  assert.deepEqual(names(w.sortRecords(RECORDS, 'name_asc')), ['alpha co', 'Bravo Co', 'Charlie Co']);
});

test('name_desc reverses the case-insensitive name order', () => {
  const w = boot();
  assert.deepEqual(names(w.sortRecords(RECORDS, 'name_desc')), ['Charlie Co', 'Bravo Co', 'alpha co']);
});

test('sortRecords with no sortKey falls back to the currentSort module state (default newest)', () => {
  const w = boot();
  assert.deepEqual(names(w.sortRecords(RECORDS)), ['alpha co', 'Charlie Co', 'Bravo Co']);
});

test('changing the sort-select updates currentSort and re-renders without changing the active chip/search filter', () => {
  const w = boot();
  // Boot the widget's data path directly via the exposed hook (no ZOHO SDK needed
  // for this file's other tests) by calling onRecordsLoaded, which the file exposes
  // for tests the same way it exposes rowHtml/sendCreditApp elsewhere.
  w.onRecordsLoaded(RECORDS.map(function(r) { return Object.assign({ Credit_Decision: 'Approved' }, r); }));
  const sel = w.document.getElementById('sort-select');
  sel.value = 'name_asc';
  sel.dispatchEvent(new w.Event('change'));
  const rows = [...w.document.querySelectorAll('.row .cell-val.lg')].map(function(e) { return e.textContent.trim(); });
  assert.deepEqual(rows, ['alpha co', 'Bravo Co', 'Charlie Co']);
});
