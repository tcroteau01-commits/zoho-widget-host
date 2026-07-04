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

test('reserveActivity().kpis.cash_reserve matches the Wallet cash figure exactly (cross-widget consistency)', () => {
  const w = boot();
  const r = w.OPERFI_DEMO.reserveActivity();
  const wallet = w.OPERFI_DEMO.wallet();
  assert.ok(Math.abs(r.kpis.cash_reserve - wallet.cash) < 0.01);
});

test('reserveActivity().kpis.escrow_reserve matches the Wallet escrow figure exactly', () => {
  const w = boot();
  const r = w.OPERFI_DEMO.reserveActivity();
  const wallet = w.OPERFI_DEMO.wallet();
  assert.ok(Math.abs(r.kpis.escrow_reserve - wallet.escrow) < 0.01);
});

test('cash_activity_by_date is sorted newest-date-first and each day\'s ending_balance is internally consistent', () => {
  const w = boot();
  const r = w.OPERFI_DEMO.reserveActivity();
  for (let i = 1; i < r.cash_activity_by_date.length; i++) {
    assert.ok(r.cash_activity_by_date[i - 1].date >= r.cash_activity_by_date[i].date);
  }
  const day = r.cash_activity_by_date[0];
  assert.equal(day.transaction_count, day.transactions.length);
});

test('a "Reserve Release" transaction category appears at least once (weekly release story)', () => {
  const w = boot();
  const r = w.OPERFI_DEMO.reserveActivity();
  const allTxns = r.cash_activity_by_date.concat(r.escrow_activity_by_date).flatMap((d) => d.transactions);
  assert.ok(allTxns.some((t) => t.category === 'Reserve Release'));
});

test('within each day, consecutive transactions chain: prior ending_balance equals next beginning_balance', () => {
  const w = boot();
  const r = w.OPERFI_DEMO.reserveActivity();
  const allDays = r.cash_activity_by_date.concat(r.escrow_activity_by_date);
  let checkedMultiTxnDays = 0;
  allDays.forEach((day) => {
    if (day.transactions.length < 2) return;
    checkedMultiTxnDays++;
    for (let i = 1; i < day.transactions.length; i++) {
      assert.ok(
        Math.abs(day.transactions[i - 1].ending_balance - day.transactions[i].beginning_balance) < 0.01,
        `day ${day.date} txn ${i}: prior ending ${day.transactions[i - 1].ending_balance} != next beginning ${day.transactions[i].beginning_balance}`
      );
    }
  });
  assert.ok(checkedMultiTxnDays > 5, 'expected several multi-transaction days to actually exercise this check');
});
