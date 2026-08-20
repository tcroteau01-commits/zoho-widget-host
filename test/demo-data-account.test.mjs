import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const impJs = fs.readFileSync(new URL('../operfi-impersonate.js', import.meta.url), 'utf8');
const ledgerJs = fs.readFileSync(new URL('../demo-ledger.js', import.meta.url), 'utf8');
const dataJs = fs.readFileSync(new URL('../demo-data.js', import.meta.url), 'utf8');

// DEMOUSER1: the fixture used to trigger only on the ADMIN IMPERSONATION target
// matching a hardcoded list of demo contact emails. A demo user invited through
// Add Trusted Contact and logging in directly had no impersonation target, so
// every report widget fell through to the real backend and rendered
// "HTTP 404" / "Unauthorized" against an account with no FVClientID.
//
// The trigger is now account membership, reported by /whoami as `is_demo`.

function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://x.github.io/' });
  const w = dom.window;
  const calls = [];
  w.fetch = function (url) {
    calls.push(String(url));
    if (opts.fetchFails) return Promise.reject(new Error('network'));
    return Promise.resolve({
      json: function () {
        if (opts.badJson) return Promise.reject(new Error('not json'));
        return Promise.resolve(opts.whoami || {});
      }
    });
  };
  w.eval(impJs);                                   // installs OPERFI_IMP + wraps fetch
  if (opts.impersonate) w.localStorage.setItem('operfiImpersonate', opts.impersonate);
  w.eval(ledgerJs); w.eval(dataJs);
  return { w: w, calls: calls };
}

test('ready() flips isDemo() on when /whoami reports the demo account', async () => {
  const { w } = boot({ whoami: { is_admin: false, is_demo: true } });
  assert.equal(w.OPERFI_DEMO.isDemo(), false, 'must not guess before /whoami answers');
  await w.OPERFI_DEMO.ready('newdemo@x.com');
  assert.equal(w.OPERFI_DEMO.isDemo(), true);
});

test('ready() leaves isDemo() off for a real client account', async () => {
  const { w } = boot({ whoami: { is_admin: false, is_demo: false } });
  await w.OPERFI_DEMO.ready('broker@marek.com');
  assert.equal(w.OPERFI_DEMO.isDemo(), false);
});

test('ready() resolves rather than rejects when /whoami fails, and fails closed', async () => {
  // A network hiccup must never hand a real client fabricated AR numbers, and
  // must never leave the widget stuck on a rejected promise that skips render.
  const { w } = boot({ fetchFails: true });
  await w.OPERFI_DEMO.ready('broker@marek.com');
  assert.equal(w.OPERFI_DEMO.isDemo(), false);
});

test('ready() survives a non-JSON /whoami response', async () => {
  const { w } = boot({ badJson: true });
  await w.OPERFI_DEMO.ready('broker@marek.com');
  assert.equal(w.OPERFI_DEMO.isDemo(), false);
});

test('ready() calls /whoami once however many widgets ask', async () => {
  const { w, calls } = boot({ whoami: { is_demo: true } });
  await Promise.all([
    w.OPERFI_DEMO.ready('newdemo@x.com'),
    w.OPERFI_DEMO.ready('newdemo@x.com'),
    w.OPERFI_DEMO.ready('newdemo@x.com')
  ]);
  const whoamiCalls = calls.filter(function (u) { return u.indexOf('/whoami') !== -1; });
  assert.equal(whoamiCalls.length, 1);
});

test('ready() with no email never calls the backend', async () => {
  const { w, calls } = boot({ whoami: { is_demo: true } });
  await w.OPERFI_DEMO.ready('');
  assert.equal(calls.length, 0);
  assert.equal(w.OPERFI_DEMO.isDemo(), false);
});

test('an early ready() with no email does not poison the later real one', async () => {
  // reserve-report resolves its email out of initParams, which can legitimately
  // come back empty on the admin ?clientId= path. Memoizing that empty answer
  // would permanently pin isDemo() to false for the rest of the page.
  const { w } = boot({ whoami: { is_demo: true } });
  await w.OPERFI_DEMO.ready('');
  await w.OPERFI_DEMO.ready('newdemo@x.com');
  assert.equal(w.OPERFI_DEMO.isDemo(), true);
});

test('ready() absorbs a fetch that throws synchronously', async () => {
  // The init chains .then() off this, so a synchronous throw would land in each
  // widget's .catch and blank the page rather than merely losing the fixture.
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://x.github.io/' });
  const w = dom.window;
  w.fetch = function () { throw new Error('blocked'); };
  w.eval(impJs); w.eval(ledgerJs); w.eval(dataJs);
  await w.OPERFI_DEMO.ready('broker@marek.com');
  assert.equal(w.OPERFI_DEMO.isDemo(), false);
});

test('the /whoami call carries the impersonation target', async () => {
  // demo-data.js calls the wrapped window.fetch, so OPERFI_IMP.decorate appends
  // ?impersonate= for us. That is what lets an admin impersonating a NEWLY
  // invited demo contact get the fixture without that contact being listed anywhere.
  const { w, calls } = boot({ impersonate: 'newdemo@x.com', whoami: { is_demo: true } });
  await w.OPERFI_DEMO.ready('admin@operfi.com');
  const whoami = calls.find(function (u) { return u.indexOf('/whoami') !== -1; });
  assert.ok(whoami.indexOf('impersonate=newdemo%40x.com') !== -1, whoami);
});

test('the legacy impersonation email list still works on its own', async () => {
  // Kept as an OR so a slow or failing /whoami cannot break the live sales demo.
  // The list is no longer load-bearing for new users, and needs no maintenance.
  const { w } = boot({ impersonate: 'demo@operfi.com', fetchFails: true });
  assert.equal(w.OPERFI_DEMO.isDemo(), true, 'legacy path must not wait on ready()');
  await w.OPERFI_DEMO.ready('admin@operfi.com');
  assert.equal(w.OPERFI_DEMO.isDemo(), true);
});

// ---- pdf-lib, which the fixture's PDF exports hard-depend on --------------
// aging / loads-margins / reserve-report / vendor-payments each lazy-load pdf-lib
// at page load, gated on isDemo(). That check runs BEFORE ready() resolves, so on
// the direct-login path it is false and pdf-lib never loads. demo-data.js's
// pdfFromRows() then rejects with "pdf-lib not loaded" and the PDF button silently
// does nothing -- for exactly the users this feature exists for.

function pdfTags(w) {
  return Array.prototype.slice.call(w.document.querySelectorAll('script'))
    .filter(function (s) { return (s.src || '').indexOf('pdf-lib') !== -1; });
}

test('ready() loads pdf-lib once the demo account is confirmed', async () => {
  const { w } = boot({ whoami: { is_demo: true } });
  assert.equal(pdfTags(w).length, 0);
  await w.OPERFI_DEMO.ready('newdemo@x.com');
  assert.equal(pdfTags(w).length, 1, 'PDF export would reject with "pdf-lib not loaded"');
});

test('ready() does not load pdf-lib for a real client account', async () => {
  const { w } = boot({ whoami: { is_demo: false } });
  await w.OPERFI_DEMO.ready('broker@marek.com');
  assert.equal(pdfTags(w).length, 0);
});

test('ensurePdfLib() is idempotent', async () => {
  const { w } = boot({ whoami: { is_demo: true } });
  await w.OPERFI_DEMO.ready('newdemo@x.com');
  w.OPERFI_DEMO.ensurePdfLib();
  w.OPERFI_DEMO.ensurePdfLib();
  assert.equal(pdfTags(w).length, 1);
});
