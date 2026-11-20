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

// ── Task 3: drawer section and AP contacts ────────────────────────────────

function drawerFetch(over) {
  over = over || {};
  return function (url, init) {
    if (url.includes('/customer-noa/statuses')) {
      return jsonRes(200, { chips: { '5': CHIP('Waiting on ap@acme.com',
        { waiting_on: 'ap@acme.com', last_sent_at: '2026-11-18T15:00:00Z' }) } });
    }
    if (url.includes('/customer-noa/contacts') && !(init && init.method === 'POST')) {
      return over.getContacts ? over.getContacts(url) : jsonRes(200, { contacts: [
        { email: 'ap@acme.com', name: 'Pat AP', phone: '', role: 'AP', source: 'portal', primary: true },
        { email: 'billing@acme.com', name: 'Bill', phone: '', role: '', source: 'submission', primary: false }] });
    }
    if (url.includes('/customer-noa/contacts')) {
      return over.postContacts ? over.postContacts(url, init) : jsonRes(200, { ok: true, contacts: [] });
    }
    return jsonRes(200, { items: [] });
  };
}

async function openDrawer(over, pageOpts) {
  const p = loadPage(Object.assign({ staff: true, target: 'b@x.com', fetchImpl: drawerFetch(over) }, pageOpts || {}));
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

test('drawer shows chip, who we wait on, and Send NOA', async () => {
  const { panel } = await openDrawer();
  const sec = panel.querySelector('#cnoa-panel');
  assert.ok(sec);
  assert.ok(sec.textContent.includes('Waiting on ap@acme.com'));
  assert.ok(sec.querySelector('[data-cnoa-send="5"]'));
  assert.ok(sec.textContent.includes('Preview: hidden from clients'));
});

test('contacts load once per drawer open and list both sources', async () => {
  const { p, panel } = await openDrawer();
  assert.strictEqual(p.calls.filter(u => u.includes('/customer-noa/contacts')).length, 1);
  const list = panel.querySelector('#cnoa-contacts').textContent;
  assert.ok(list.includes('ap@acme.com'));
  assert.ok(list.includes('Primary'));
  assert.ok(list.includes('Suggested from the credit submission'));
});

test('add contact body is exactly {email, submission_id, contact:{email,name,phone,role}}', async () => {
  const { p, panel } = await openDrawer();
  const f = name => panel.querySelector('[name="cnoa-c-' + name + '"]');
  f('email').value = 'new@acme.com'; f('name').value = 'New'; f('phone').value = '555'; f('role').value = 'AP';
  panel.querySelector('#cnoa-add-contact').click();
  await wait(20);
  const post = p.posts.find(x => x.url.includes('/customer-noa/contacts'));
  assert.deepStrictEqual(post.body, { email: 'broker@test.com', submission_id: '5',
    contact: { email: 'new@acme.com', name: 'New', phone: '555', role: 'AP' } });
});

test('nothing in the drawer can set primary', async () => {
  const { panel } = await openDrawer();
  assert.ok(!panel.querySelector('[name*="primary"]'));
});

test('bad_email and too_many_contacts show the mapped text', async () => {
  for (const [code, text] of [['bad_email', 'Not a valid email address.'],
                              ['too_many_contacts', 'A customer can have up to 10 AP contacts.']]) {
    const { panel } = await openDrawer({ postContacts: () => jsonRes(400, { error: code }) });
    panel.querySelector('[name="cnoa-c-email"]').value = 'x@acme.com';
    panel.querySelector('#cnoa-add-contact').click();
    await wait(20);
    assert.ok(panel.querySelector('#cnoa-contact-msg').textContent.includes(text), code);
  }
});

test('403 on add hides the add form', async () => {
  const { panel } = await openDrawer({ postContacts: () => jsonRes(403, { error: 'forbidden' }) });
  panel.querySelector('[name="cnoa-c-email"]').value = 'x@acme.com';
  panel.querySelector('#cnoa-add-contact').click();
  await wait(20);
  assert.ok(panel.querySelector('#cnoa-add-form').hidden);
});

test('release is a link to lor-request, never a button', async () => {
  const { panel } = await openDrawer();
  const a = panel.querySelector('a[href="https://lor-request.operfi.com"]');
  assert.ok(a);
  const btns = Array.from(panel.querySelectorAll('button')).filter(b => /release/i.test(b.textContent));
  assert.strictEqual(btns.length, 0);
});

test('contact names are escaped', async () => {
  const { panel } = await openDrawer({ getContacts: () => jsonRes(200, { contacts: [
    { email: 'a@b.com', name: '<img src=x onerror=1>', source: 'portal', primary: false }] }) });
  assert.ok(!panel.querySelector('#cnoa-contacts img'));
});

test('renderPanel mounts the drawer section and wiring behind guards', () => {
  const html = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8').replace(/\r\n/g, '\n');
  assert.ok(html.includes("(window.OperFiCustomerNoa ? OperFiCustomerNoa.panelHtml(r) : '') +"));
  assert.ok(html.includes("if (window.OperFiCustomerNoa) OperFiCustomerNoa.wirePanel(r, document.getElementById('panel'));"));
});

// ── Task 4: send form ─────────────────────────────────────────────────────

const FORBIDDEN = ['status', 'confirmed_by', 'kind', 'force', 'verified_domain', 'client', 'debtor'];
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
    if (url.includes('/customer-noa/statuses')) return jsonRes(200, { chips: { '5': CHIP('Not sent', { status: 'not_sent' }) } });
    if (url.includes('/customer-noa/status?')) return jsonRes(200, { submission_id: '5', chip: CHIP('Waiting on ap@acme.com') });
    if (url.includes('/customer-noa/contacts')) return jsonRes(200, { contacts: [
      { email: 'ap@acme.com', name: 'Pat AP', phone: '555-1', role: 'AP', source: 'portal', primary: true }] });
    if (url.includes('/customer-noa/preview')) return over.preview ? over.preview(init) : jsonRes(200,
      { subject: 'NOA', html: '<p>Hello <b>AP</b></p>', attach_name: 'noa.pdf',
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

function useNewContact(d, email) {
  const sel = d.querySelector('[name="cnoa-s-contact"]');
  sel.value = '__new';
  sel.dispatchEvent(new d.defaultView.Event('change'));
  d.querySelector('[name="cnoa-s-email"]').value = email;
  d.querySelector('[name="cnoa-s-name"]').value = 'New AP';
  d.querySelector('[name="cnoa-s-phone"]').value = '555-9';
  d.querySelector('[name="cnoa-s-role"]').value = 'AP';
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

test('the row Send NOA button opens the form', async () => {
  const p = loadPage({ staff: true, target: 'b@x.com', fetchImpl: sendFetch() });
  boot(p, [{ ID: '5' }]);
  await wait(20);
  p.window.document.getElementById('results').innerHTML = p.N.rowChipHtml({ ID: '5' });
  p.window.document.querySelector('[data-cnoa-send]').click();
  await wait(20);
  assert.ok(p.window.document.getElementById('cnoa-send-modal'));
});

test('the form has Send now and Have OperFi send it as two buttons, no checkbox', async () => {
  const { m } = await openForm();
  assert.ok(m.querySelector('#cnoa-send-self').textContent.includes('Send now'));
  assert.ok(m.querySelector('#cnoa-send-operfi').textContent.includes('Have OperFi send it for me'));
  assert.ok(m.textContent.includes('Nothing is emailed until we do.'));
  assert.strictEqual(m.querySelectorAll('input[type="checkbox"]').length, 0);
});

test('preview body is exactly {email, submission_id, contact:{email,name}, note}', async () => {
  const { p, d } = await openForm();
  d.querySelector('[name="cnoa-s-note"]').value = 'Hi';
  d.getElementById('cnoa-preview').click();
  await wait(20);
  const post = p.posts.find(x => x.url.includes('/preview'));
  assert.deepStrictEqual(post.body, { email: 'broker@test.com', submission_id: '5',
    contact: { email: 'ap@acme.com', name: 'Pat AP' }, note: 'Hi' });
});

test('preview html renders in a sandboxed iframe via srcdoc, never innerHTML', async () => {
  const { d } = await openForm();
  d.getElementById('cnoa-preview').click();
  await wait(20);
  const f = d.getElementById('cnoa-preview-frame');
  assert.strictEqual(f.getAttribute('sandbox'), '');
  assert.ok(f.getAttribute('srcdoc').includes('<b>AP</b>'));
  // The email's markup must not exist as DOM in the page (srcdoc text is fine:
  // HTML serialisation leaves '<' unescaped inside attribute values).
  assert.strictEqual(d.getElementById('cnoa-send-modal').querySelector('b'), null);
});

test('send body is exactly the allow list, for both modes', async () => {
  for (const [btn, mode] of [['cnoa-send-self', 'self'], ['cnoa-send-operfi', 'operfi']]) {
    const { p, d } = await openForm();
    useNewContact(d, 'new@acme.com');
    d.querySelector('[name="cnoa-s-note"]').value = 'Note';
    d.getElementById(btn).click();
    await wait(20);
    const post = p.posts.find(x => x.url.includes('/customer-noa/send'));
    assert.deepStrictEqual(post.body, { email: 'broker@test.com', submission_id: '5',
      contact: { email: 'new@acme.com', name: 'New AP', phone: '555-9', role: 'AP' }, note: 'Note', mode });
  }
});

test('no forbidden key ever leaves the module', async () => {
  const all = [];
  for (const btn of ['cnoa-preview', 'cnoa-send-self', 'cnoa-send-operfi']) {
    const { p, d } = await openForm();
    d.getElementById(btn).click();
    await wait(20);
    all.push(...p.posts);
  }
  const { p, panel } = await openDrawer();
  panel.querySelector('[name="cnoa-c-email"]').value = 'x@acme.com';
  panel.querySelector('#cnoa-add-contact').click();
  await wait(20);
  all.push(...p.posts);
  assert.ok(all.length >= 4);
  all.forEach(x => assert.deepStrictEqual(forbiddenKeys(x.body), [], x.url));
});

test('each check code shows its plain-language text; unknown code has a fallback', async () => {
  const TEXT = {
    free_mail: "Free email address (Gmail, Yahoo...). Use the customer's company address.",
    lookalike_domain: "Looks like the customer's domain but is not.",
    client_domain: "That is your own company's address.",
    client_user: "That is your own company's address.",
    credit_contact: 'That is the credit contact, not accounts payable.',
    bad_email: 'Not a valid email address.',
    domain_mismatch: "Does not match the customer's verified domain. Allowed, but OperFi will verify by phone.",
    role_address: 'AP role address. Good.'
  };
  const { p } = await openForm();
  Object.keys(TEXT).forEach(k => assert.strictEqual(p.N.checkText(k), TEXT[k], k));
  assert.strictEqual(p.N.checkText('zzz'), "This address can't be used for an NOA.");
});

test('blocked_contact shows reasons and offers no override', async () => {
  const { d, m } = await openForm({ send: () => jsonRes(409, { error: 'blocked_contact',
    checks: { blocks: ['free_mail'], warnings: [], positives: [] } }) });
  d.getElementById('cnoa-send-self').click();
  await wait(20);
  assert.ok(m.textContent.includes('Free email address'));
  assert.ok(m.textContent.includes('Use a different address.'));
  const visibleBtns = Array.from(m.querySelectorAll('button')).filter(b => !b.hidden).map(b => b.id);
  assert.deepStrictEqual(visibleBtns.sort(), ['cnoa-cancel', 'cnoa-change-address'].sort());
});

test('double click on Send now sends once', async () => {
  let resolve;
  const { p, d } = await openForm({ send: () => new Promise(r => { resolve = r; }) });
  d.getElementById('cnoa-send-self').click();
  d.getElementById('cnoa-send-self').click();
  d.getElementById('cnoa-send-operfi').click();
  await wait(10);
  assert.strictEqual(p.posts.filter(x => x.url.includes('/customer-noa/send')).length, 1);
  resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
});

test('each error status shows its mapped text', async () => {
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
  }
});

test('preview no_master shows the same text', async () => {
  const { d, m } = await openForm({ preview: () => jsonRes(409, { error: 'no_master' }) });
  d.getElementById('cnoa-preview').click();
  await wait(20);
  assert.ok(m.textContent.includes("We don't have a signed NOA on file for your company yet."));
});

test('a successful send closes the form and refreshes that chip', async () => {
  const { p, d } = await openForm();
  d.getElementById('cnoa-send-self').click();
  await wait(30);
  assert.strictEqual(d.getElementById('cnoa-send-modal'), null);
  assert.ok(p.calls.some(u => u.includes('/customer-noa/status?') && u.includes('submission_id=5')));
  assert.strictEqual(p.N.chipFor('5').label, 'Waiting on ap@acme.com');
  assert.ok(d.getElementById('cnoa-toast').textContent.includes('NOA sent to ap@acme.com'));
});
