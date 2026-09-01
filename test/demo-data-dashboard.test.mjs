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

test('dashboardSummary() matches the /dashboard/summary shape', () => {
  const s = boot().OPERFI_DEMO.dashboardSummary();
  assert.equal(typeof s.accountName, 'string');
  assert.ok(s.header && 'usdot' in s.header && 'mc' in s.header && 'status' in s.header);
  assert.ok(s.watch && s.watch.chargebackRisk && typeof s.watch.dsoDays !== 'undefined');
  assert.ok(s.snapshot && s.snapshot.openAR && s.snapshot.openAP && s.snapshot.thisMonth);
  assert.ok(Array.isArray(s.insights.agingBuckets));
  assert.ok(Array.isArray(s.insights.concentration));
  assert.equal(s.insights.monthly.length, 12);
});

test('openAR total matches the sum of open loads purchase amounts', () => {
  const w = boot();
  const s = w.OPERFI_DEMO.dashboardSummary();
  const expected = w.OPERFI_DEMO_LEDGER.loads.filter((l) => l.status === 'open').reduce((sum, l) => sum + l.purchaseAmount, 0);
  assert.ok(Math.abs(s.snapshot.openAR.amount - Math.round(expected * 100) / 100) < 1);
});

test('thisMonth marginPct falls within the 15-20% target band', () => {
  const s = boot().OPERFI_DEMO.dashboardSummary();
  assert.ok(s.snapshot.thisMonth.marginPct >= 14 && s.snapshot.thisMonth.marginPct <= 21);
});

// The dashboard paints the Chargeback Risk card and the AR Aging donut side by
// side, both labelled "75+". Before this they came from different places — the
// donut summed the real 75+ bucket while the card was a hardcoded zero — so the
// demo showed $40k of 75+ money next to a card claiming there was none.
test('the Chargeback Risk card equals the 75+ aging bucket', () => {
  const s = boot().OPERFI_DEMO.dashboardSummary();
  const b75 = s.insights.agingBuckets.find((b) => b.label === '75+');
  assert.equal(s.watch.chargebackRisk.amount, b75.amount);
  assert.equal(s.watch.chargebackRisk.invoiceCount, b75.count);
  assert.ok(b75.amount > 0, 'the 75 Day Reserve Notice beat needs a non-zero 75+ balance');
});
