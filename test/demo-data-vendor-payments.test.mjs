import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const impJs = fs.readFileSync(new URL('../operfi-impersonate.js', import.meta.url), 'utf8');
const ledgerJs = fs.readFileSync(new URL('../demo-ledger.js', import.meta.url), 'utf8');
const dataJs = fs.readFileSync(new URL('../demo-data.js', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://x.github.io/' });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(impJs); w.localStorage.setItem('operfiImpersonate', 'demo@operfi.com');
  w.eval(ledgerJs); w.eval(dataJs);
  return w;
}

test('vendorPaymentsOpen() rows only include open loads and use Title-Case keys', () => {
  const w = boot();
  const r = w.OPERFI_DEMO.vendorPaymentsOpen();
  assert.ok(r.rows.length > 0);
  r.rows.forEach((row) => { assert.ok('Vendor Amount' in row); assert.ok('Vendor Due' in row); assert.equal(row['Payment Status'], 'Pending'); });
  assert.equal(r.totals.openLoads, r.rows.length);
});

test('vendorPaymentsHistory() rows only include closed loads with a Paid Date', () => {
  const w = boot();
  const r = w.OPERFI_DEMO.vendorPaymentsHistory();
  assert.ok(r.rows.length > 0);
  r.rows.forEach((row) => { assert.ok(row['Paid Date']); assert.equal(row['Payment Status'], 'Paid'); });
  assert.equal(r.totals.paymentCount, r.rows.length);
});
