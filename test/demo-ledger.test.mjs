import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const js = fs.readFileSync(new URL('../demo-ledger.js', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://x.github.io/' });
  dom.window.eval(js);
  return dom.window;
}

test('produces 20 debtors and 65 carriers', () => {
  const w = boot();
  assert.equal(w.OPERFI_DEMO_LEDGER.debtors.length, 20);
  assert.equal(w.OPERFI_DEMO_LEDGER.carriers.length, 65);
});

test('is fully deterministic across independent runs', () => {
  const w1 = boot();
  const w2 = boot();
  assert.deepEqual(w1.OPERFI_DEMO_LEDGER.loads, w2.OPERFI_DEMO_LEDGER.loads);
  assert.deepEqual(w1.OPERFI_DEMO_LEDGER.reserveTxns, w2.OPERFI_DEMO_LEDGER.reserveTxns);
});

test('every load\'s margin matches purchase + discountFee + vendorPayable (backend formula)', () => {
  const w = boot();
  w.OPERFI_DEMO_LEDGER.loads.forEach((l) => {
    const expected = Math.round((l.purchaseAmount + l.discountFee + l.vendorPayable) * 100) / 100;
    assert.equal(l.margin, expected, `load ${l.id} margin mismatch`);
  });
});

test('margin percent falls within the 15-20% target band for every load', () => {
  const w = boot();
  w.OPERFI_DEMO_LEDGER.loads.forEach((l) => {
    assert.ok(l.marginPct >= 14.9 && l.marginPct <= 20.1, `load ${l.id} marginPct=${l.marginPct} out of band`);
  });
});

test('escrow reserve is always exactly 6.5% of purchase amount', () => {
  const w = boot();
  w.OPERFI_DEMO_LEDGER.loads.forEach((l) => {
    const expected = Math.round(l.purchaseAmount * 0.065 * 100) / 100;
    assert.equal(Math.abs(l.escrowReserve), expected, `load ${l.id} escrow mismatch`);
  });
});

test('net cash reserve (sum of GL 2006 reserveTxns) lands on the $18,240.55 target', () => {
  const w = boot();
  const net = w.OPERFI_DEMO_LEDGER.reserveTxns
    .filter((t) => t.glCode === '2006')
    .reduce((sum, t) => sum + t.amount, 0);
  assert.ok(Math.abs(net - 18240.55) < 0.01, `net cash ${net} != 18240.55`);
});

test('at least a few loads sit in the 90+ day aging tail (open, daysAgo > 90)', () => {
  const w = boot();
  const stragglers = w.OPERFI_DEMO_LEDGER.loads.filter((l) => l.status === 'open' && l.daysAgo > 90);
  assert.ok(stragglers.length >= 5, `expected some 90+ day open loads, got ${stragglers.length}`);
});

test('9 debtors have 6 months of rating history each', () => {
  const w = boot();
  const byDebtor = {};
  w.OPERFI_DEMO_LEDGER.ratings.forEach((r) => { byDebtor[r.debtorId] = (byDebtor[r.debtorId] || 0) + 1; });
  assert.equal(Object.keys(byDebtor).length, 9);
  Object.values(byDebtor).forEach((count) => assert.equal(count, 6));
});
