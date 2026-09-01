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
  assert.equal(JSON.stringify(w1.OPERFI_DEMO_LEDGER.loads), JSON.stringify(w2.OPERFI_DEMO_LEDGER.loads));
  assert.equal(JSON.stringify(w1.OPERFI_DEMO_LEDGER.reserveTxns), JSON.stringify(w2.OPERFI_DEMO_LEDGER.reserveTxns));
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

test('net cash reserve (sum of GL 2005+2006 reserveTxns) lands on the $18,240.55 target', () => {
  const w = boot();
  const net = w.OPERFI_DEMO_LEDGER.reserveTxns
    .filter((t) => t.glCode === '2006' || t.glCode === '2005')
    .reduce((sum, t) => sum + t.amount, 0);
  assert.ok(Math.abs(net - 18240.55) < 0.01, `net cash ${net} != 18240.55`);
});

test('the 90+ aging tail exists but stays to a single invoice', () => {
  const w = boot();
  const stragglers = w.OPERFI_DEMO_LEDGER.loads.filter((l) => l.status === 'open' && l.daysAgo > 90);
  assert.equal(stragglers.length, 1, `expected exactly one 90+ open load, got ${stragglers.length}`);
});

// The 75+ balance is what the AR Aging donut and the dashboard's Chargeback Risk
// card both render. It is deliberately tiny — the demo account is the marketing
// shoot account, and a five-figure 75+ number undercuts the whole pitch.
test('open AR past 74 days is exactly the three AGED_OPEN invoices', () => {
  const w = boot();
  const aged = w.OPERFI_DEMO_LEDGER.loads.filter((l) => l.status === 'open' && l.daysAgo > 74);
  assert.equal(aged.length, 3);
  const total = aged.reduce((s, l) => s + l.purchaseAmount, 0);
  assert.ok(total < 10000, `75+ open balance ${total} should stay under $10k`);
});

test('a quarter of carriers are factored, each with a factor name and matching terms', () => {
  const w = boot();
  const carriers = w.OPERFI_DEMO_LEDGER.carriers;
  const factored = carriers.filter((c) => c.factor);
  assert.ok(factored.length >= 10, `expected a visible factored population, got ${factored.length}`);
  factored.forEach((c) => assert.equal(c.payTerms, 'Factoring Company', `${c.name} terms`));
  carriers.filter((c) => !c.factor).forEach((c) => {
    assert.ok(['Quick Pay', 'Standard Net 30'].includes(c.payTerms), `${c.name} terms ${c.payTerms}`);
  });
});

test('designates exactly 5 slow-payer debtors', () => {
  const w = boot();
  assert.equal(w.OPERFI_DEMO_LEDGER.SLOW_PAYER_IDS.length, 5);
  w.OPERFI_DEMO_LEDGER.SLOW_PAYER_IDS.forEach((id) => {
    assert.ok(w.OPERFI_DEMO_LEDGER.debtors.some((d) => d.id === id), `${id} not a real debtor`);
  });
});

test('9 debtors have 6 months of rating history each', () => {
  const w = boot();
  const byDebtor = {};
  w.OPERFI_DEMO_LEDGER.ratings.forEach((r) => { byDebtor[r.debtorId] = (byDebtor[r.debtorId] || 0) + 1; });
  assert.equal(Object.keys(byDebtor).length, 9);
  Object.values(byDebtor).forEach((count) => assert.equal(count, 6));
});
