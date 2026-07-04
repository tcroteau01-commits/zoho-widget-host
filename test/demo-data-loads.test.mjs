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

test('loads() totals.purchaseAmount equals the sum of every returned load\'s purchaseAmount', () => {
  const w = boot();
  const result = w.OPERFI_DEMO.loads({});
  const sum = Math.round(result.loads.reduce((s, l) => s + l.purchaseAmount, 0) * 100) / 100;
  assert.ok(Math.abs(sum - result.totals.purchaseAmount) < 1);
});

test('loads() filters by arStatus', () => {
  const w = boot();
  const open = w.OPERFI_DEMO.loads({ arStatus: 'open' });
  open.loads.forEach((l) => assert.equal(l.arStatus, 'open'));
});

test('loadPreview() settlement.netCash equals purchaseAmount + fees + carrierPay (all fees/carrier stored negative)', () => {
  const w = boot();
  const loadId = w.OPERFI_DEMO_LEDGER.loads[0].id;
  const p = w.OPERFI_DEMO.loadPreview(loadId);
  const feesTotal = p.settlement.fees.reduce((s, f) => s + f.amount, 0);
  const expected = Math.round((p.settlement.arPurchased + feesTotal + p.settlement.carrierPay) * 100) / 100;
  assert.ok(Math.abs(p.settlement.netCash - expected) < 0.02);
});
