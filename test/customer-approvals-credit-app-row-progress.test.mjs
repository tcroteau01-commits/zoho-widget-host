// CREDITAPP1 Task 17 -- the same Credit Application tracker (Task 16, see
// customer-approvals-credit-app-tracker.test.mjs), compressed onto the LIST row so a
// broker sees an application moving without opening the panel. One bulk call
// (/credit-app/status-bulk) feeds every row; never a fetch per row, the list can hold
// 200 customers. Same discipline as the panel tracker: no risk/fraud/score/reason ever
// reaches this markup, and a 404 (flag off), a malformed body, or a dropped connection
// all leave the list exactly as it renders today.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

function boot() {
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                           url: 'https://x.github.io/' }).window;
}

function rec(over) {
  return Object.assign({ ID: '1', Customer_Company_Name: 'ACME', Credit_Decision: '' }, over || {});
}

function manyRecords(n) {
  var out = [];
  for (var i = 1; i <= n; i++) out.push(rec({ ID: String(i), Customer_Company_Name: 'Co ' + i }));
  return out;
}

function wait(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// Same pattern customer-approvals-billing-gate.test.mjs uses: the widget's own
// window-load boot runs on its own timer and, with no ZOHO SDK present, calls
// showError() and rewrites #results to "SDK unavailable". Let that settle FIRST,
// so the only thing touching #results after is this test driving onRecordsLoaded.
async function bootSettled() {
  const w = boot();
  await wait(50);
  return w;
}

// ── one call for the whole list ─────────────────────────────────────────────

test('fetchCreditAppStatusBulk hits status-bulk once for a list of many rows, not per row', async () => {
  const w = await bootSettled();
  w.brokerEmail = 'b@x.com';
  var calls = [];
  w.fetch = function(url) {
    calls.push(url);
    return Promise.resolve({ ok: true, json: function() { return Promise.resolve({ applications: {} }); } });
  };
  w.onRecordsLoaded(manyRecords(75));
  await wait(30);
  assert.strictEqual(calls.length, 1, 'exactly one bulk call regardless of row count');
  assert.match(calls[0], /\/credit-app\/status-bulk\?email=b%40x\.com/);
});

// ── a row with an application ───────────────────────────────────────────────

test('a row whose customer has an application renders the bar and "N of M"', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'b@x.com';
  w.fetch = function() {
    return Promise.resolve({ ok: true, json: function() {
      return Promise.resolve({ applications: {
        '1': { status: 'references_pending', completed: 2, total: 5, waiting_on: ['Bank reference — Bank Test, John Banker'] }
      } });
    } });
  };
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  const rowsHtml = d.getElementById('results').innerHTML;
  assert.match(rowsHtml, /ca-app-rowprog-wrap/, 'the progress indicator should be present');
  assert.match(rowsHtml, /class="ca-app-rowprog-text">2 of 5</, 'a readable count, not just a bar');
  assert.match(rowsHtml, /width:40%/, '2 of 5 is a 40% fill');
});

test('a completed application shows a done state, no percentage bar', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'b@x.com';
  w.fetch = function() {
    return Promise.resolve({ ok: true, json: function() {
      return Promise.resolve({ applications: {
        '1': { status: 'ready_for_review', completed: 5, total: 5, waiting_on: [] }
      } });
    } });
  };
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  const rowsHtml = d.getElementById('results').innerHTML;
  assert.match(rowsHtml, /ca-app-rowprog-done/);
  assert.match(rowsHtml, /Application complete/);
  assert.doesNotMatch(rowsHtml, /ca-app-rowprog-bar/, 'done should not still show a bar');
  assert.doesNotMatch(rowsHtml, /5 of 5/, 'done reads as done, not as a fraction');
});

// ── a row without one is untouched ──────────────────────────────────────────

test('a row with no application on file renders no indicator at all', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'b@x.com';
  w.fetch = function() {
    return Promise.resolve({ ok: true, json: function() {
      return Promise.resolve({ applications: {
        '1': { status: 'sent', completed: 0, total: 5, waiting_on: [] }
      } });
    } });
  };
  w.onRecordsLoaded([rec({ ID: '1' }), rec({ ID: '2', Customer_Company_Name: 'No App Co' })]);
  await wait(30);
  const rows = [...d.querySelectorAll('.row')];
  const row2 = rows.find(function(el) { return /No App Co/.test(el.innerHTML); });
  assert.ok(row2, 'row 2 should render');
  assert.doesNotMatch(row2.innerHTML, /ca-app-rowprog/, 'a customer with no application gets nothing extra');
});

test('caAppRowProgressHtml itself returns empty for a record with no bulk entry', () => {
  const w = boot();
  assert.strictEqual(w.caAppRowProgressHtml(rec({ ID: '999' })), '');
});

// ── quiet degradation: 404 (flag off) / network failure ─────────────────────

test('a 404 from status-bulk (feature flag off) leaves the list exactly as it is today', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'b@x.com';
  w.fetch = function() { return Promise.resolve({ ok: false, status: 404 }); };
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  const rowsHtml = d.getElementById('results').innerHTML;
  assert.match(rowsHtml, /ACME/, 'the row itself still renders');
  assert.doesNotMatch(rowsHtml, /ca-app-rowprog/, 'no indicator appears');
});

test('a dropped connection to status-bulk leaves the list exactly as it is today', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'b@x.com';
  w.fetch = function() { return Promise.reject(new Error('network down')); };
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  const rowsHtml = d.getElementById('results').innerHTML;
  assert.match(rowsHtml, /ACME/);
  assert.doesNotMatch(rowsHtml, /ca-app-rowprog/);
});

test('a malformed body from status-bulk (no applications object) leaves the list unchanged', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'b@x.com';
  w.fetch = function() {
    return Promise.resolve({ ok: true, json: function() { return Promise.resolve({ nonsense: true }); } });
  };
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  const rowsHtml = d.getElementById('results').innerHTML;
  assert.match(rowsHtml, /ACME/);
  assert.doesNotMatch(rowsHtml, /ca-app-rowprog/);
});

test('no fetch available in this environment does not throw and leaves the list rendered', async () => {
  // billing-gate's own save test proves the pattern this guards: onRecordsLoaded can be
  // called with a truthy brokerEmail and no window.fetch stub at all (jsdom ships none).
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'b@x.com';
  assert.doesNotThrow(function() { w.onRecordsLoaded([rec({ ID: '1' })]); });
  await wait(30);
  assert.match(d.getElementById('results').innerHTML, /ACME/);
});

// ── hover/focus content: the named waiting parties, straight from waiting_on ───

test('the in-progress row names who we are waiting on, straight from waiting_on', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'b@x.com';
  w.fetch = function() {
    return Promise.resolve({ ok: true, json: function() {
      return Promise.resolve({ applications: {
        '1': { status: 'references_pending', completed: 2, total: 5, waiting_on: [
          'Trade reference 2 — ABC 2, John Smith', 'Bank reference — Bank Test, John Banker'
        ] } } });
    } });
  };
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  const rowsHtml = d.getElementById('results').innerHTML;
  assert.match(rowsHtml, /ca-app-rowprog-tip/, 'a hover/focus tip should be present');
  assert.match(rowsHtml, /Trade reference 2 — ABC 2, John Smith/);
  assert.match(rowsHtml, /Bank reference — Bank Test, John Banker/);
  assert.doesNotMatch(rowsHtml, /risk/i);
  assert.doesNotMatch(rowsHtml, /fraud/i);
  assert.doesNotMatch(rowsHtml, /score/i);
  assert.doesNotMatch(rowsHtml, /reason/i);
});

test('the wrap is focusable (tabindex 0) and carries an aria-label with the same information, ' +
     'so keyboard users get the hover content via :focus', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'b@x.com';
  w.fetch = function() {
    return Promise.resolve({ ok: true, json: function() {
      return Promise.resolve({ applications: {
        '1': { status: 'references_pending', completed: 2, total: 5, waiting_on: ['Bank reference — Bank Test, John Banker'] }
      } });
    } });
  };
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  const wrap = d.querySelector('.ca-app-rowprog-wrap');
  assert.ok(wrap, 'wrap element should be present');
  assert.strictEqual(wrap.getAttribute('tabindex'), '0');
  assert.match(wrap.getAttribute('aria-label'), /2 of 5 complete/);
  assert.match(wrap.getAttribute('aria-label'), /Bank reference — Bank Test, John Banker/);
});

// ── the CSS exists and is scoped under ca-app-rowprog ───────────────────────

test('the row-progress styles exist, scoped under ca-app-rowprog', () => {
  assert.match(html, /\.ca-app-rowprog-bar\s*\{/);
  assert.match(html, /\.ca-app-rowprog-tip\s*\{/);
  assert.match(html, /\.ca-app-rowprog-done\s*\{/);
});
