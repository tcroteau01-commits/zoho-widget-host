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

test('agingReceipts() totals.count matches receipts.length and totals.amount matches the sum', () => {
  const w = boot();
  const r = w.OPERFI_DEMO.agingReceipts();
  assert.equal(r.totals.count, r.receipts.length);
  const sum = Math.round(r.receipts.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  assert.ok(Math.abs(sum - r.totals.amount) < 1);
});

test('agingCustomerReceipts(debtorId) returns only that debtor\'s receipts', () => {
  const w = boot();
  const debtorId = w.OPERFI_DEMO_LEDGER.debtors[0].id;
  const r = w.OPERFI_DEMO.agingCustomerReceipts(debtorId);
  r.receipts.forEach((x) => assert.equal(x.debtorId, debtorId));
});
