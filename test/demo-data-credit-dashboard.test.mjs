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

test('creditDashboard() has 9 debtors, each with 6 monthly snapshots, and mixed risk scores', () => {
  const w = boot();
  const c = w.OPERFI_DEMO.creditDashboard();
  assert.equal(c.debtorCount, 9);
  assert.equal(c.totalSnapshots, 54);
  c.debtors.forEach((d) => assert.equal(d.snapshots.length, 6));
  const scores = new Set(c.debtors.map((d) => d.snapshots[0].riskScore));
  assert.ok(scores.size > 1, 'ratings should not all be identical');
});
