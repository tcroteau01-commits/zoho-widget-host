import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const impJs = fs.readFileSync(new URL('../operfi-impersonate.js', import.meta.url), 'utf8');
const ledgerJs = fs.readFileSync(new URL('../demo-ledger.js', import.meta.url), 'utf8');
const dataJs = fs.readFileSync(new URL('../demo-data.js', import.meta.url), 'utf8');

function boot(impersonateEmail) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://x.github.io/' });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(impJs);
  if (impersonateEmail) w.localStorage.setItem('operfiImpersonate', impersonateEmail);
  w.eval(ledgerJs);
  w.eval(dataJs);
  return w;
}

test('isDemo() is true only when impersonating the reserved demo email', () => {
  assert.equal(boot('demo@operfi.com').OPERFI_DEMO.isDemo(), true);
  assert.equal(boot('someone-else@client.com').OPERFI_DEMO.isDemo(), false);
  assert.equal(boot().OPERFI_DEMO.isDemo(), false);
});

test('isDemo() is also true for the other OperFi Demo authorized-user contacts (admin picker only shows one representative row per account, indistinguishable in the UI)', () => {
  assert.equal(boot('morgan.ellis@operfidemo.com').OPERFI_DEMO.isDemo(), true);
  assert.equal(boot('jordan.price@operfidemo.com').OPERFI_DEMO.isDemo(), true);
  assert.equal(boot('casey.nguyen@operfidemo.com').OPERFI_DEMO.isDemo(), true);
});

test('offsetISO converts a daysAgo offset into a real past ISO date', () => {
  const w = boot('demo@operfi.com');
  const today = new Date();
  const iso = w.OPERFI_DEMO.offsetISO(10);
  const expected = new Date(today.getTime() - 10 * 86400000).toISOString().slice(0, 10);
  assert.equal(iso, expected);
});

test('wallet() returns {cash, escrow, account_name} matching the real /wallet-reserves shape', () => {
  const w = boot('demo@operfi.com');
  const result = w.OPERFI_DEMO.wallet();
  assert.equal(typeof result.cash, 'number');
  assert.equal(typeof result.escrow, 'number');
  assert.equal(typeof result.account_name, 'string');
  assert.ok(Math.abs(result.cash - 18240.55) < 0.01);
  assert.ok(result.escrow > 0);
});

test('wallet.html renders demo balances when impersonating the demo account, without calling fetch', async () => {
  const html = fs.readFileSync(new URL('../wallet.html', import.meta.url), 'utf8');
  const impJs = fs.readFileSync(new URL('../operfi-impersonate.js', import.meta.url), 'utf8');
  const ledgerJs = fs.readFileSync(new URL('../demo-ledger.js', import.meta.url), 'utf8');
  const dataJs = fs.readFileSync(new URL('../demo-data.js', import.meta.url), 'utf8');
  let fetchCalled = false;
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/wallet.html?email=demo@operfi.com',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.localStorage.setItem('operfiImpersonate', 'demo@operfi.com');
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      const realFetch = window.fetch;
      window.fetch = (url, opts) => { if (typeof url === 'string' && url.indexOf('/wallet-reserves') !== -1) fetchCalled = true; return realFetch ? realFetch(url, opts) : Promise.resolve({ json: () => Promise.resolve({}) }); };
      // Load demo modules before HTML parsing so scripts can find them
      window.eval(impJs);
      window.eval(ledgerJs);
      window.eval(dataJs);
    }
  });
  await new Promise((r) => setTimeout(r, 100));
  try {
    assert.equal(fetchCalled, false, 'demo mode must never call the real /wallet-reserves endpoint');
    const cashHTML = dom.window.document.getElementById('cashValue').innerHTML;
    assert.ok(cashHTML.includes('18,240') && cashHTML.includes('.55'), `expected demo cash value 18,240.55 in: ${cashHTML}`);
  } finally { dom.window.close(); }
});
