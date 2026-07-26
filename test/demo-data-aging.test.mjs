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

test('aging() bucket total equals the sum of all open loads\' purchase amounts', () => {
  const w = boot();
  const a = w.OPERFI_DEMO.aging('purchase');
  const expected = w.OPERFI_DEMO_LEDGER.loads.filter((l) => l.status === 'open').reduce((s, l) => s + l.purchaseAmount, 0);
  assert.ok(Math.abs(a.buckets.total - Math.round(expected * 100) / 100) < 1);
});

test('aging() has a non-empty 90+ bucket (straggler loads)', () => {
  const a = boot().OPERFI_DEMO.aging('purchase');
  assert.ok(a.buckets.b90_plus > 0);
});

test('every customer\'s per-bucket total equals the sum of its own bucket totals', () => {
  const a = boot().OPERFI_DEMO.aging('purchase');
  a.customers.forEach((c) => {
    const sum = c.buckets.b0_30 + c.buckets.b31_45 + c.buckets.b46_60 + c.buckets.b61_90 + c.buckets.b90_plus;
    assert.ok(Math.abs(sum - c.buckets.total) < 0.02, `${c.name} bucket sum mismatch`);
  });
});

test('one customer\'s invoices sum to that customer\'s bucket total', () => {
  const a = boot().OPERFI_DEMO.aging('purchase');
  const c = a.customers[0];
  const sum = c.invoices.reduce((s, inv) => s + inv.openBalance, 0);
  assert.ok(Math.abs(sum - c.buckets.total) < 0.02);
});

test('exactly the slow-payer customers carry 61+ aging (only they highlight)', () => {
  const w = boot();
  const a = w.OPERFI_DEMO.aging('purchase');
  const hot = a.customers.filter((c) => (c.buckets.b61_90 + c.buckets.b90_plus) > 0);
  const slowIds = w.OPERFI_DEMO_LEDGER.SLOW_PAYER_IDS;
  assert.equal(hot.length, slowIds.length, `expected ${slowIds.length} highlighted, got ${hot.length}`);
  hot.forEach((c) => assert.ok(slowIds.indexOf(c.debtorId) !== -1, `${c.name} highlighted but not a slow payer`));
});

test('every slow-payer customer is actually highlighted (has a 61+ balance)', () => {
  const w = boot();
  const a = w.OPERFI_DEMO.aging('purchase');
  w.OPERFI_DEMO_LEDGER.SLOW_PAYER_IDS.forEach((id) => {
    const c = a.customers.find((x) => x.debtorId === id);
    assert.ok(c && (c.buckets.b61_90 + c.buckets.b90_plus) > 0, `slow payer ${id} not highlighted`);
  });
});

test('no non-slow-payer customer has any 61+ open balance', () => {
  const w = boot();
  const a = w.OPERFI_DEMO.aging('purchase');
  const slowIds = w.OPERFI_DEMO_LEDGER.SLOW_PAYER_IDS;
  a.customers.filter((c) => slowIds.indexOf(c.debtorId) === -1).forEach((c) => {
    assert.equal(c.buckets.b61_90 + c.buckets.b90_plus, 0, `${c.name} (clean) has 61+ balance`);
  });
});

test('the aging table still lists most of the 20 customers', () => {
  const a = boot().OPERFI_DEMO.aging('purchase');
  assert.ok(a.customers.length >= 18, `expected ~20 customers, got ${a.customers.length}`);
});
