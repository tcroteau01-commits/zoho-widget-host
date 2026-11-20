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

// ── Task 2: row chip and row Send NOA ─────────────────────────────────────

function chipFetch(chips, status) {
  return function (url) {
    if (url.includes('/customer-noa/statuses')) {
      return status ? jsonRes(status, {}) : jsonRes(200, { chips });
    }
    return jsonRes(200, { items: [] });
  };
}
const CHIP = (label, extra) => Object.assign({ status: 'sent', label, waiting_on: '',
  last_sent_at: null, can_send: true, attention: false }, extra || {});

async function previewWith(chips, status) {
  const p = loadPage({ staff: true, target: 'b@x.com', fetchImpl: chipFetch(chips, status) });
  boot(p, Object.keys(chips).length ? Object.keys(chips).map(id => ({ ID: id })) : [{ ID: '1' }]);
  await wait(20);
  return p;
}

test('dark: rowChipHtml returns empty for a broker', async () => {
  const p = loadPage({ staff: false, target: '' });
  boot(p, [{ ID: '1' }]);
  await wait(20);
  assert.strictEqual(p.N.rowChipHtml({ ID: '1' }), '');
});

test('chip label is shown verbatim for every label the API sends', async () => {
  const labels = ['Not sent', 'Sent from FactorView', 'Waiting on ap@acme.com',
    'Waiting on OperFi verification', 'Confirmed', 'Action needed: Claim review', 'Released'];
  const chips = {};
  labels.forEach((l, i) => { chips[String(i + 1)] = CHIP(l); });
  const p = await previewWith(chips);
  labels.forEach((l, i) => {
    const html = p.N.rowChipHtml({ ID: String(i + 1) });
    assert.ok(html.includes('>' + l + '<'), 'missing label ' + l);
  });
});

test('Waiting on OperFi verification is never styled as done', async () => {
  const p = await previewWith({});
  assert.strictEqual(p.N.chipToneClass({ status: 'acknowledged', label: 'Waiting on OperFi verification' }), 'cnoa-tone-wait');
  assert.strictEqual(p.N.chipToneClass({ status: 'confirmed', label: 'Confirmed' }), 'cnoa-tone-done');
  assert.strictEqual(p.N.chipToneClass({ status: 'action_needed', label: 'Action needed: x' }), 'cnoa-tone-action');
  assert.strictEqual(p.N.chipToneClass({ status: 'not_sent', label: 'Not sent' }), 'cnoa-tone-muted');
  assert.strictEqual(p.N.chipToneClass({ status: 'released', label: 'Released' }), 'cnoa-tone-muted');
});

test('Send NOA only when can_send is exactly true', async () => {
  const p = await previewWith({ '1': CHIP('Not sent', { can_send: true }),
    '2': CHIP('Confirmed', { can_send: false }), '3': CHIP('Released', { can_send: undefined }),
    '4': CHIP('Sent', { can_send: 'true' }) });
  assert.ok(p.N.rowChipHtml({ ID: '1' }).includes('data-cnoa-send="1"'));
  ['2', '3', '4'].forEach(id => assert.ok(!p.N.rowChipHtml({ ID: id }).includes('data-cnoa-send'), id));
});

test('the row button cannot open the drawer or hit the page action binder', async () => {
  const p = await previewWith({ '1': CHIP('Not sent') });
  const html = p.N.rowChipHtml({ ID: '1' });
  assert.ok(/<button[^>]*class="row-action[^"]*"[^>]*data-cnoa-send="1"/.test(html));
  assert.ok(!/data-action=/.test(html));
});

test('preview tag shows in staff preview, not when enabled for real', async () => {
  const p = await previewWith({ '1': CHIP('Not sent') });
  const html = p.N.rowChipHtml({ ID: '1' });
  assert.strictEqual(html.split('Preview: hidden from clients').length - 1, 1);
  const q = loadPage({ staff: false, enabledOverride: true, fetchImpl: chipFetch({ '1': CHIP('Not sent') }) });
  boot(q, [{ ID: '1' }]);
  await wait(20);
  assert.ok(q.N.rowChipHtml({ ID: '1' }).includes('Not sent'));
  assert.ok(!q.N.rowChipHtml({ ID: '1' }).includes('Preview: hidden from clients'));
});

test('no chip for an omitted id or after a failed statuses call', async () => {
  const p = await previewWith({ '1': CHIP('Not sent') });
  assert.strictEqual(p.N.rowChipHtml({ ID: '999' }), '');
  const q = await previewWith({ '1': CHIP('Not sent') }, 500);
  assert.strictEqual(q.N.rowChipHtml({ ID: '1' }), '');
});

test('chip label is escaped', async () => {
  const p = await previewWith({ '1': CHIP('<img src=x onerror=alert(1)>') });
  const html = p.N.rowChipHtml({ ID: '1' });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('clicking the row Send NOA calls the registered send handler with the id', async () => {
  const p = await previewWith({ '7': CHIP('Not sent') });
  const got = [];
  p.N.onSendClick(id => got.push(id));
  p.window.document.getElementById('results').innerHTML = p.N.rowChipHtml({ ID: '7' });
  p.window.document.querySelector('[data-cnoa-send]').click();
  assert.deepStrictEqual(got, ['7']);
});

test('rowHtml mounts the chip behind a guard', () => {
  const html = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8').replace(/\r\n/g, '\n');
  assert.ok(html.includes("(window.OperFiCustomerNoa ? OperFiCustomerNoa.rowChipHtml(r) : '') +"));
});
