// tests/customer-noa-panel.test.js
// CNOAPORTAL1: the broker customer NOA chip, send form, contacts and bell.
//
// 🚨 The DARK tests come first and matter most. The module ships with
// CNOA_PORTAL_ENABLED = false, and while it is false a broker must see nothing
// and the page must make ZERO /customer-noa/* calls. The API behind it is live
// and a send really emails the customer's AP, so "hidden" has to mean "inert",
// not "display:none".
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const SRC_PATH = __dirname + '/../customer-noa-panel.js';
const SRC = fs.readFileSync(SRC_PATH, 'utf8').replace(/\r\n/g, '\n');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function jsonRes(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status,
                           json: () => Promise.resolve(body) });
}

// Default fake API: every statuses id comes back Not sent.
function defaultFetch(url) {
  if (url.includes('/customer-noa/statuses')) {
    const ids = new URL(url).searchParams.get('submission_ids').split(',');
    const chips = {};
    ids.forEach(id => { chips[id] = { status: 'not_sent', label: 'Not sent', waiting_on: '',
                                      last_sent_at: null, can_send: true, attention: false }; });
    return jsonRes(200, { chips });
  }
  if (url.includes('/customer-noa/attention')) return jsonRes(200, { items: [] });
  return jsonRes(404, {});
}

// staff/target describe OPERFI_IMP; staff may be a function (late whoami).
function loadPage(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><head></head><body>' +
    '<div id="chips"></div><div id="results"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://app.operfi.com/customer-approvals.html' });
  const w = dom.window;
  const calls = [];
  const posts = [];
  const impl = opts.fetchImpl || defaultFetch;
  w.fetch = function (url, init) {
    calls.push(url);
    if (init && init.body) posts.push({ url, body: JSON.parse(init.body) });
    return impl(url, init);
  };
  const staff = opts.staff;
  w.OPERFI_IMP = {
    isStaff: () => (typeof staff === 'function' ? staff() : !!staff),
    target: () => opts.target || ''
  };
  let src = SRC;
  if (opts.enabledOverride) {
    src = src.replace('const CNOA_PORTAL_ENABLED = false;', 'const CNOA_PORTAL_ENABLED = true;');
    assert.ok(src.includes('const CNOA_PORTAL_ENABLED = true;'), 'override did not apply');
  }
  w.eval(src);
  const N = w.OperFiCustomerNoa;
  N._config.recheckMs = 1;
  return { window: w, N, calls, posts,
           noaCalls: () => calls.filter(u => u.includes('/customer-noa/')) };
}

function records(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ ID: String(1000 + i), Customer_Company_Name: 'Cust ' + i });
  return out;
}

function boot(page, recs, rerender) {
  page.N.onRecords(recs, { email: 'broker@test.com', apiBase: 'https://operfi-broker-api.onrender.com',
                           rerender: rerender || function () {} });
}

// ── Task 1: dark gate ──────────────────────────────────────────────────────

test('the shipped file has the flag off', () => {
  assert.ok(/^(\s*\/\/[^\n]*\n)*\s*const CNOA_PORTAL_ENABLED = false;/.test(SRC),
            'CNOA_PORTAL_ENABLED = false must be the first statement in the file');
});

test('dark: a broker session makes zero /customer-noa calls and renders nothing', async () => {
  const p = loadPage({ staff: false, target: '' });
  boot(p, records(300));
  await wait(80);
  assert.strictEqual(p.noaCalls().length, 0);
  assert.strictEqual(p.N.visible(), false);
  assert.strictEqual(p.N.isPreview(), false);
});

test('dark: a broker with a hand-set impersonate target still sees nothing', async () => {
  const p = loadPage({ staff: false, target: 'someone@else.com' });
  boot(p, records(5));
  await wait(120);   // past 40 rechecks at 1ms
  assert.strictEqual(p.noaCalls().length, 0);
  assert.strictEqual(p.N.visible(), false);
});

test('dark: staff NOT impersonating sees nothing', async () => {
  const p = loadPage({ staff: true, target: '' });
  boot(p, records(5));
  await wait(80);
  assert.strictEqual(p.noaCalls().length, 0);
  assert.strictEqual(p.N.visible(), false);
});

test('staff impersonating: preview on, statuses batched at 200', async () => {
  const p = loadPage({ staff: true, target: 'broker@test.com' });
  let rerenders = 0;
  boot(p, records(450), () => { rerenders++; });
  await wait(40);
  const st = p.noaCalls().filter(u => u.includes('/customer-noa/statuses'));
  assert.strictEqual(st.length, 3);
  st.forEach(u => {
    const q = new URL(u).searchParams;
    assert.strictEqual(q.get('email'), 'broker@test.com');
    assert.ok(q.get('submission_ids').split(',').length <= 200);
  });
  assert.strictEqual(p.N.isPreview(), true);
  assert.strictEqual(rerenders, 1, 'one rerender after all chunks land');
  assert.strictEqual(p.N.chipFor('1450').label, 'Not sent');
});

test('whoami late: preview turns on when isStaff flips', async () => {
  let staffNow = false;
  const p = loadPage({ staff: () => staffNow, target: 'broker@test.com' });
  boot(p, records(3));
  await wait(10);
  assert.strictEqual(p.noaCalls().length, 0);
  staffNow = true;
  await wait(40);
  assert.strictEqual(p.noaCalls().filter(u => u.includes('/statuses')).length, 1);
  assert.strictEqual(p.N.isPreview(), true);
});

test('stale statuses response is dropped', async () => {
  const resolvers = [];
  const p = loadPage({ staff: true, target: 'b@x.com', fetchImpl: (url) => {
    if (!url.includes('/statuses')) return jsonRes(200, { items: [] });
    return new Promise(res => resolvers.push(res));
  } });
  boot(p, [{ ID: '1' }]);
  boot(p, [{ ID: '1' }]);
  await wait(5);
  const mk = label => ({ ok: true, status: 200, json: () => Promise.resolve(
    { chips: { '1': { status: 'x', label, can_send: true } } }) });
  resolvers[1](mk('Confirmed'));      // the newer load answers first
  await wait(5);
  resolvers[0](mk('Not sent'));       // the older one lands late
  await wait(5);
  assert.strictEqual(p.N.chipFor('1').label, 'Confirmed');
});

test('flag on: a broker gets statuses, and it is not a preview', async () => {
  const p = loadPage({ staff: false, target: '', enabledOverride: true });
  boot(p, records(3));
  await wait(20);
  assert.strictEqual(p.noaCalls().filter(u => u.includes('/statuses')).length, 1);
  assert.strictEqual(p.N.visible(), true);
  assert.strictEqual(p.N.isPreview(), false);
});

test('customer-approvals loads the module and hands it the records', () => {
  const html = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/<script src="customer-noa-panel\.js"><\/script>/.test(html));
  assert.ok(/if \(window\.OperFiCustomerNoa\) OperFiCustomerNoa\.onRecords\(allRecords,/.test(html));
});
