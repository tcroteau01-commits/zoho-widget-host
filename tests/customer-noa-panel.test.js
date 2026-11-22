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
  last_sent_at: null, can_send: true, attention: false,
  send_to: { email: 'ap@acme.com', name: 'Pat AP' } }, extra || {});

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

test('Send NOA needs can_send exactly true AND a send_to address (Tom 11-22)', async () => {
  const p = await previewWith({ '1': CHIP('Not sent', { send_to: null }),
    '2': CHIP('Not sent', { send_to: { email: '' } }), '3': CHIP('Not sent', { send_to: 'ap@acme.com' }) });
  ['1', '2', '3'].forEach(id => assert.ok(!p.N.rowChipHtml({ ID: id }).includes('data-cnoa-send'), id));
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

// ── Task 3: drawer section (Tom 11-22: no contact list, no Add contact) ───

const TO = { email: 'ap@acme.com', name: 'Pat AP' };

function drawerFetch(chip) {
  return function (url) {
    if (url.includes('/customer-noa/statuses')) {
      return jsonRes(200, { chips: { '5': chip || CHIP('Waiting on ap@acme.com',
        { waiting_on: 'ap@acme.com', last_sent_at: '2026-11-18T15:00:00Z' }) } });
    }
    return jsonRes(200, { items: [] });
  };
}

async function openDrawer(chip, pageOpts) {
  const p = loadPage(Object.assign({ staff: true, target: 'b@x.com', fetchImpl: drawerFetch(chip) }, pageOpts || {}));
  boot(p, [{ ID: '5' }]);
  await wait(20);
  const panel = p.window.document.createElement('div');
  panel.id = 'panel';
  panel.innerHTML = p.N.panelHtml({ ID: '5' });
  p.window.document.body.appendChild(panel);
  p.N.wirePanel({ ID: '5' }, panel);
  await wait(20);
  return { p, panel };
}

test('dark: panelHtml is empty and wirePanel makes no call for a broker', async () => {
  const p = loadPage({ staff: false, target: '' });
  boot(p, [{ ID: '5' }]);
  await wait(20);
  assert.strictEqual(p.N.panelHtml({ ID: '5' }), '');
  const panel = p.window.document.createElement('div');
  p.N.wirePanel({ ID: '5' }, panel);
  await wait(20);
  assert.strictEqual(p.noaCalls().length, 0);
});

test('drawer shows chip, who we wait on, Send NOA and the one AP address', async () => {
  const { panel } = await openDrawer();
  const sec = panel.querySelector('#cnoa-panel');
  assert.ok(sec);
  assert.ok(sec.textContent.includes('Waiting on ap@acme.com'));
  assert.ok(sec.querySelector('[data-cnoa-send="5"]'));
  assert.ok(sec.textContent.includes('NOA goes to ap@acme.com'));
  assert.ok(sec.textContent.includes('Preview: hidden from clients'));
});

test('drawer has no way to add, type or pick an address (Tom 11-22)', async () => {
  const { p, panel } = await openDrawer();
  assert.strictEqual(panel.querySelectorAll('input, select, textarea').length, 0);
  assert.ok(!/add contact/i.test(panel.textContent));
  assert.strictEqual(p.calls.filter(u => u.includes('/customer-noa/contacts')).length, 0);
});

test('no send_to: no Send NOA, and not_sent says no approved AP contact', async () => {
  const { panel } = await openDrawer(CHIP('Not sent', { status: 'not_sent', send_to: null }));
  assert.strictEqual(panel.querySelector('[data-cnoa-send]'), null);
  assert.ok(panel.textContent.includes('No approved AP contact on file for this customer.'));
});

test('no release link or button: clients are not pointed at LOR requests (Tom 11-22)', async () => {
  const { panel } = await openDrawer();
  assert.strictEqual(panel.querySelector('a[href*="lor-request"]'), null);
  assert.ok(!/release/i.test(panel.textContent.replace(/NOA: ?Released|Released/g, '')));
});

test('send_to email is escaped in the drawer', async () => {
  const { panel } = await openDrawer(CHIP('Not sent', { send_to: { email: '<img src=x onerror=1>@a.com' } }));
  assert.strictEqual(panel.querySelector('img'), null);
});

test('renderPanel mounts the drawer section and wiring behind guards', () => {
  const html = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8').replace(/\r\n/g, '\n');
  assert.ok(html.includes("(window.OperFiCustomerNoa ? OperFiCustomerNoa.panelHtml(r) : '') +"));
  assert.ok(html.includes("if (window.OperFiCustomerNoa) OperFiCustomerNoa.wirePanel(r, document.getElementById('panel'));"));
});

// ── Task 4: send window (Tom 11-22: locked recipient, preview, Send) ──────

const FORBIDDEN = ['status', 'confirmed_by', 'kind', 'force', 'verified_domain', 'client', 'debtor', 'note', 'cc', 'bcc'];
function forbiddenKeys(obj, path) {
  const hits = [];
  if (obj && typeof obj === 'object') {
    Object.keys(obj).forEach(k => {
      if (FORBIDDEN.includes(k)) hits.push((path || '') + k);
      hits.push(...forbiddenKeys(obj[k], (path || '') + k + '.'));
    });
  }
  return hits;
}

function sendFetch(over) {
  over = over || {};
  return function (url, init) {
    if (url.includes('/customer-noa/statuses')) return jsonRes(200, { chips: { '5': over.chip || CHIP('Not sent', { status: 'not_sent' }) } });
    if (url.includes('/customer-noa/status?')) return jsonRes(200, { submission_id: '5', chip: CHIP('Waiting on ap@acme.com') });
    if (url.includes('/customer-noa/preview')) return over.preview ? over.preview(init) : jsonRes(200,
      { subject: 'Notice of Assignment', html: '<p>Hello <b>AP</b></p>', attach_name: 'noa.pdf',
        checks: { blocks: [], warnings: ['domain_mismatch'], positives: ['role_address'] } });
    if (url.includes('/customer-noa/send')) return over.send ? over.send(init) : jsonRes(200, { ok: true, noa_id: 'n1', checks: {} });
    return jsonRes(200, { items: [] });
  };
}

async function openForm(over, pageOpts) {
  const p = loadPage(Object.assign({ staff: true, target: 'b@x.com', fetchImpl: sendFetch(over) }, pageOpts || {}));
  boot(p, [{ ID: '5' }]);
  await wait(20);
  p.N.openSendForm('5');
  await wait(20);
  const d = p.window.document;
  return { p, d, m: d.getElementById('cnoa-send-modal') };
}

test('dark: openSendForm is a no-op for a broker', async () => {
  const p = loadPage({ staff: false, target: '' });
  boot(p, [{ ID: '5' }]);
  await wait(20);
  p.N.openSendForm('5');
  await wait(20);
  assert.strictEqual(p.window.document.getElementById('cnoa-send-modal'), null);
  assert.strictEqual(p.noaCalls().length, 0);
});

test('the row Send NOA button opens the window', async () => {
  const p = loadPage({ staff: true, target: 'b@x.com', fetchImpl: sendFetch() });
  boot(p, [{ ID: '5' }]);
  await wait(20);
  p.window.document.getElementById('results').innerHTML = p.N.rowChipHtml({ ID: '5' });
  p.window.document.querySelector('[data-cnoa-send]').click();
  await wait(20);
  assert.ok(p.window.document.getElementById('cnoa-send-modal'));
});

test('no send_to: the window does not open and nothing is called', async () => {
  const { p, m } = await openForm({ chip: CHIP('Not sent', { send_to: null }) });
  assert.strictEqual(m, null);
  assert.strictEqual(p.posts.length, 0);
});

test('the To address is the API send_to, grayed out and not editable', async () => {
  const { m } = await openForm();
  const to = m.querySelector('[name="cnoa-s-to"]');
  assert.strictEqual(to.value, 'ap@acme.com');
  assert.strictEqual(to.disabled, true);
  assert.strictEqual(to.readOnly, true);
  const editable = Array.from(m.querySelectorAll('input, select, textarea')).filter(e => !e.disabled);
  assert.strictEqual(editable.length, 0);
  const css = m.ownerDocument.getElementById('cnoa-styles').textContent;
  assert.ok(css.includes('.cnoa-field input[disabled]{background:#f1f1f1;'));
});

test('the window has exactly Cancel and Send NOA, no Have-OperFi, no other address', async () => {
  const { m } = await openForm();
  const ids = Array.from(m.querySelectorAll('button')).map(b => b.id).sort();
  assert.deepStrictEqual(ids, ['cnoa-cancel', 'cnoa-send-self']);
  assert.ok(!/have operfi send/i.test(m.textContent));
});

test('[hidden] beats the module display rules (rendered-page regression)', async () => {
  const { d } = await openForm();
  const css = d.getElementById('cnoa-styles').textContent;
  assert.ok(css.includes('.cnoa-modal [hidden],.cnoa-panel [hidden],.cnoa-bell-menu [hidden]{display:none !important;}'));
});

test('the email loads on open: one preview with exactly {email, submission_id, contact:{email,name}}', async () => {
  const { p, d } = await openForm();
  const previews = p.posts.filter(x => x.url.includes('/preview'));
  assert.strictEqual(previews.length, 1);
  assert.deepStrictEqual(previews[0].body, { email: 'broker@test.com', submission_id: '5', contact: TO });
  assert.strictEqual(d.getElementById('cnoa-s-subject').textContent, 'Notice of Assignment');
  assert.strictEqual(d.getElementById('cnoa-send-self').disabled, false);
});

test('Send NOA stays disabled until the email has loaded', async () => {
  let resolve;
  const { p, d } = await openForm({ preview: () => new Promise(r => { resolve = r; }) });
  const btn = d.getElementById('cnoa-send-self');
  assert.strictEqual(btn.disabled, true);
  btn.click();
  await wait(10);
  assert.strictEqual(p.posts.filter(x => x.url.includes('/customer-noa/send')).length, 0);
  resolve({ ok: true, status: 200, json: () => Promise.resolve({ subject: 'S', html: '<p>x</p>', checks: { blocks: [] } }) });
  await wait(10);
  assert.strictEqual(btn.disabled, false);
});

test('preview html renders in a sandboxed iframe via srcdoc, never innerHTML', async () => {
  const { d } = await openForm();
  const f = d.getElementById('cnoa-preview-frame');
  assert.strictEqual(f.getAttribute('sandbox'), '');
  assert.ok(f.getAttribute('srcdoc').includes('<b>AP</b>'));
  assert.strictEqual(f.hidden, false);
  assert.strictEqual(d.getElementById('cnoa-send-modal').querySelector('b'), null);
});

test('send body is exactly {email, submission_id, contact: send_to, mode: self}', async () => {
  const { p, d } = await openForm();
  d.getElementById('cnoa-send-self').click();
  await wait(20);
  const post = p.posts.find(x => x.url.includes('/customer-noa/send'));
  assert.deepStrictEqual(post.body, { email: 'broker@test.com', submission_id: '5', contact: TO, mode: 'self' });
});

test('no forbidden key ever leaves the module (note and cc included)', async () => {
  const { p, d } = await openForm();
  d.getElementById('cnoa-send-self').click();
  await wait(20);
  assert.ok(p.posts.length >= 2);
  p.posts.forEach(x => assert.deepStrictEqual(forbiddenKeys(x.body), [], x.url));
});

test('each block code shows its plain-language text; unknown code has a fallback', async () => {
  const TEXT = {
    free_mail: "Free email address (Gmail, Yahoo...). Use the customer's company address.",
    lookalike_domain: "Looks like the customer's domain but is not.",
    client_domain: "That is your own company's address.",
    client_user: "That is your own company's address.",
    credit_contact: 'That is the credit contact, not accounts payable.',
    bad_email: 'Not a valid email address.'
  };
  const { p } = await openForm();
  Object.keys(TEXT).forEach(k => assert.strictEqual(p.N.checkText(k), TEXT[k], k));
  assert.strictEqual(p.N.checkText('zzz'), "This address can't be used for an NOA.");
});

const BLOCKED = "This customer's AP contact can't be used for an NOA. Contact brokersupport@operfi.com.";

test('a blocked address in the preview: reasons, no Send, no override', async () => {
  const { d, m } = await openForm({ preview: () => jsonRes(200, { subject: 'S', html: '<p>x</p>',
    checks: { blocks: ['free_mail'], warnings: [], positives: [] } }) });
  assert.ok(m.textContent.includes('Free email address'));
  assert.ok(m.textContent.includes(BLOCKED));
  assert.strictEqual(d.getElementById('cnoa-send-self').hidden, true);
  assert.strictEqual(d.getElementById('cnoa-preview-frame').hidden, true);
  const shown = Array.from(m.querySelectorAll('button')).filter(b => !b.hidden).map(b => b.id);
  assert.deepStrictEqual(shown, ['cnoa-cancel']);
});

test('recipient_not_on_file and blocked_contact on send: blocked text, Send gone', async () => {
  for (const code of ['recipient_not_on_file', 'blocked_contact']) {
    const { d, m } = await openForm({ send: () => jsonRes(409, { error: code,
      checks: { blocks: [], warnings: [], positives: [] } }) });
    d.getElementById('cnoa-send-self').click();
    await wait(20);
    assert.ok(m.textContent.includes(BLOCKED), code);
    assert.strictEqual(d.getElementById('cnoa-send-self').hidden, true, code);
  }
});

test('double click on Send NOA sends once', async () => {
  let resolve;
  const { p, d } = await openForm({ send: () => new Promise(r => { resolve = r; }) });
  d.getElementById('cnoa-send-self').click();
  d.getElementById('cnoa-send-self').click();
  await wait(10);
  assert.strictEqual(p.posts.filter(x => x.url.includes('/customer-noa/send')).length, 1);
  resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
});

test('each error status shows its mapped text and Send can be retried', async () => {
  const cases = [
    [409, 'no_master', "We don't have a signed NOA on file for your company yet. OperFi will reach out."],
    [409, 'bad_state', 'This customer has already acknowledged or confirmed the NOA.'],
    [503, 'email_off', 'Sending is unavailable right now. Try again in a few minutes.'],
    [403, 'forbidden', "You don't have permission to send NOAs. Ask your account owner."]];
  for (const [st, code, text] of cases) {
    const { d, m } = await openForm({ send: () => jsonRes(st, { error: code }) });
    d.getElementById('cnoa-send-self').click();
    await wait(20);
    assert.ok(m.textContent.includes(text), code);
    assert.strictEqual(d.getElementById('cnoa-send-self').disabled, false, code);
  }
});

test('preview no_master shows its text and Send stays disabled', async () => {
  const { d, m } = await openForm({ preview: () => jsonRes(409, { error: 'no_master' }) });
  assert.ok(m.textContent.includes("We don't have a signed NOA on file for your company yet."));
  assert.strictEqual(d.getElementById('cnoa-send-self').disabled, true);
});

test('a successful send closes the window and refreshes that chip', async () => {
  const { p, d } = await openForm();
  d.getElementById('cnoa-send-self').click();
  await wait(30);
  assert.strictEqual(d.getElementById('cnoa-send-modal'), null);
  assert.ok(p.calls.some(u => u.includes('/customer-noa/status?') && u.includes('submission_id=5')));
  assert.strictEqual(p.N.chipFor('5').label, 'Waiting on ap@acme.com');
  assert.ok(d.getElementById('cnoa-toast').textContent.includes('NOA sent to ap@acme.com'));
});

// ── Task 5: NOA bell ──────────────────────────────────────────────────────

const ITEMS = [
  { submission_id: '5', debtor_name: 'Acme Foods', kind: 'confirmed', at: '2026-11-19T10:00:00Z', chip: CHIP('Confirmed', { status: 'confirmed' }) },
  { submission_id: '6', debtor_name: 'Beta <b>Co</b>', kind: 'action_needed', at: '2026-11-19T11:00:00Z',
    chip: CHIP('Action needed: Wrong address', { status: 'action_needed' }) }];

function bellFetch(over) {
  over = over || {};
  return function (url, init) {
    if (url.includes('/customer-noa/statuses')) return jsonRes(200, { chips: {} });
    if (url.includes('/customer-noa/attention')) return jsonRes(200, { items: over.items || ITEMS });
    if (url.includes('/customer-noa/seen')) return over.seen ? over.seen(init) : jsonRes(200, { ok: true, updated: 2 });
    return jsonRes(200, {});
  };
}

async function withBell(over, pageOpts) {
  const p = loadPage(Object.assign({ staff: true, target: 'b@x.com', fetchImpl: bellFetch(over) }, pageOpts || {}));
  const opened = [];
  boot(p, [{ ID: '5' }, { ID: '6' }]);
  await wait(20);
  const chips = p.window.document.getElementById('chips');
  p.N.mountBell(chips, id => opened.push(id));
  return { p, chips, opened, d: p.window.document };
}

test('dark: no bell and no attention call for a broker', async () => {
  const p = loadPage({ staff: false, target: '' });
  boot(p, [{ ID: '5' }]);
  await wait(20);
  const chips = p.window.document.getElementById('chips');
  p.N.mountBell(chips, () => {});
  assert.strictEqual(chips.querySelector('#cnoa-bell'), null);
  assert.strictEqual(p.noaCalls().length, 0);
});

test('attention is fetched once per load even when buildChips runs 5 times', async () => {
  const { p, chips } = await withBell();
  for (let i = 0; i < 5; i++) { chips.innerHTML = ''; p.N.mountBell(chips, () => {}); }
  assert.strictEqual(p.calls.filter(u => u.includes('/customer-noa/attention')).length, 1);
  assert.ok(chips.querySelector('#cnoa-bell'));
});

test('the bell is first in the chips row with the count', async () => {
  const { chips } = await withBell();
  const bell = chips.firstElementChild;
  assert.strictEqual(bell.id, 'cnoa-bell');
  assert.ok(bell.textContent.includes('NOA updates'));
  assert.ok(bell.textContent.includes('2'));
  assert.ok(bell.textContent.includes('Preview: hidden from clients'));
});

test('no bell when there are no items', async () => {
  const { chips } = await withBell({ items: [] });
  assert.strictEqual(chips.querySelector('#cnoa-bell'), null);
});

test('opening the bell lists items and sends exactly {email, submission_ids}', async () => {
  const { p, chips, d } = await withBell();
  chips.querySelector('#cnoa-bell').click();
  await wait(20);
  const menu = d.getElementById('cnoa-bell-menu');
  assert.ok(menu.textContent.includes('NOA confirmed'));
  assert.ok(menu.textContent.includes('Action needed: Wrong address'));
  const post = p.posts.find(x => x.url.includes('/customer-noa/seen'));
  assert.deepStrictEqual(post.body, { email: 'broker@test.com', submission_ids: ['5', '6'] });
});

test('count clears only after seen answers 200', async () => {
  const bad = await withBell({ seen: () => jsonRes(500, {}) });
  bad.chips.querySelector('#cnoa-bell').click();
  await wait(20);
  assert.ok(bad.chips.querySelector('#cnoa-bell .count').textContent.includes('2'));
  const ok = await withBell();
  ok.chips.querySelector('#cnoa-bell').click();
  await wait(20);
  assert.strictEqual(ok.chips.querySelector('#cnoa-bell .count'), null);
});

test('debtor_name is escaped and an item click opens that customer', async () => {
  const { chips, d, opened } = await withBell();
  chips.querySelector('#cnoa-bell').click();
  await wait(20);
  const menu = d.getElementById('cnoa-bell-menu');
  assert.strictEqual(menu.querySelector('b'), null);
  menu.querySelector('[data-cnoa-open="6"]').click();
  assert.deepStrictEqual(opened, ['6']);
});

test('buildChips mounts the bell behind a guard', () => {
  const html = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8').replace(/\r\n/g, '\n');
  assert.ok(html.includes('if (window.OperFiCustomerNoa) OperFiCustomerNoa.mountBell(chips, openPanelForId);'));
  assert.ok(/function openPanelForId\(id\)/.test(html));
});
