import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// ACCTCHG1 Phase 2: the in-portal "Update company details" flow.
const html = readFileSync(new URL('../company-profile.html', import.meta.url), 'utf8');

const FORM_URL_RE = /forms\.operfi\.com/;
const CURRENT = {
  admin_email: 'jordan@example.com', operations_email: 'ops@example.com', accounting_email: 'jordan@example.com',
  sms_phone: '(555) 310-2703', main_phone: '(555) 310-2700',
  address: { street: '120 Main St', city: 'Phoenix', state: 'AZ', zip: '85004' },
};
const ACCOUNT = { Account_Name: 'Example Freight LLC', Phone: '(555) 310-2700' };
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const reply = (status, data) => Promise.resolve({ status, ok: status < 400, text: () => Promise.resolve(JSON.stringify(data)), json: () => Promise.resolve(data) });

// routes: {'GET /account/details': fn|obj, ...}; records every call.
function boot(routes) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.brokerEmail = 'jordan@example.com';
  w.BROKER_API_BASE = 'http://api';
  const calls = [];
  w.__opened = [];
  w.open = (u) => { w.__opened.push(u); return null; };
  w.fetch = (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const path = url.replace('http://api', '').split('?')[0];
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, path, url, body });
    const key = method + ' ' + path.replace(/\/change\/[^/]+\//, '/change/ID/');
    const h = routes[key];
    if (h === undefined) return reply(404, {});
    return typeof h === 'function' ? h(body) : reply(200, h);
  };
  return { dom, w, calls, doc: w.document };
}
const META = { enabled: true, can_change: true, current: CURRENT };
const $ = (doc, id) => doc.getElementById(id);
const setVal = (doc, id, v) => { $(doc, id).value = v; };
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

async function start(routes) {
  const t = boot(Object.assign({ 'GET /account/details': META, 'GET /broker-account': { account: ACCOUNT } }, routes));
  await t.w.dcTestInit(ACCOUNT);
  return t;
}

test('falls back to the Zoho form when can_change is false', async () => {
  const t = await start({ 'GET /account/details': { enabled: true, can_change: false, current: CURRENT } });
  click(t.w, $(t.doc, 'btn-request-update'));
  assert.strictEqual(t.w.__opened.length, 1);
  assert.match(t.w.__opened[0], FORM_URL_RE);
  assert.ok(!$(t.doc, 'dc-scrim').classList.contains('show'));
  t.w.close();
});

test('falls back to the Zoho form when GET /account/details fails', async () => {
  const t = await start({ 'GET /account/details': () => reply(500, { message: 'x' }) });
  click(t.w, $(t.doc, 'btn-request-update'));
  assert.match(t.w.__opened[0], FORM_URL_RE);
  t.w.close();
});

test('opens the in-portal flow when can_change, without opening the form', async () => {
  const t = await start({});
  click(t.w, $(t.doc, 'btn-request-update'));
  assert.strictEqual(t.w.__opened.length, 0);
  assert.ok($(t.doc, 'dc-scrim').classList.contains('show'));
  assert.ok(/STEP 1 OF 2/.test($(t.doc, 'dc-body').textContent));
  assert.ok(!/login email/i.test($(t.doc, 'dc-body').textContent), 'no login email section (Phase 3)');
  t.w.close();
});

test('new address inputs get their own full-width row, not the narrow NEW column', async () => {
  const t = await start({});
  click(t.w, $(t.doc, 'btn-request-update'));
  const span = t.doc.querySelector('.dc-addr-span');
  assert.ok(span, 'address inputs wrapped in a spanning row');
  for (const k of ['street', 'city', 'state', 'zip']) {
    assert.ok(span.contains($(t.doc, 'dc-addr-' + k)), k + ' input is in the spanning row');
  }
  assert.strictEqual($(t.doc, 'dc-addr-street').getAttribute('placeholder'), 'Street address');
  assert.ok(/fill in all four boxes/.test($(t.doc, 'dc-body').textContent));
  t.w.close();
});

const TARGETS = [
  { key: 'sms_current', channel: 'sms', masked: '(***) ***-2703', sent: true },
  { key: 'accounting_new', channel: 'email', masked: 'a***@example.com', sent: true },
];

test('only changed fields are posted (normalised); same value is ignored', async () => {
  const t = await start({ 'POST /account/details/change': { request_id: 'r1', targets: TARGETS } });
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-admin_email', '  JORDAN@example.com ');       // same, ignored
  setVal(t.doc, 'dc-main_phone', '1-555-310-2700');               // same digits, ignored
  setVal(t.doc, 'dc-accounting_email', ' AP@Example.com ');       // changed
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  const post = t.calls.find(c => c.method === 'POST' && c.path === '/account/details/change');
  assert.ok(post, 'posted');
  assert.deepStrictEqual(post.body, { email: 'jordan@example.com', changes: { accounting_email: 'AP@Example.com' } });
  assert.ok(/STEP 2 OF 2/.test($(t.doc, 'dc-body').textContent));
  t.w.close();
});

test('nothing changed: no request, inline message', async () => {
  const t = await start({});
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-admin_email', 'jordan@example.com');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  assert.ok(!t.calls.some(c => c.method === 'POST'));
  assert.match($(t.doc, 'dc-msg').textContent, /Nothing to change/);
  t.w.close();
});

test('address: any part changed sends all four parts', async () => {
  const t = await start({ 'POST /account/details/change': { request_id: 'r1', targets: TARGETS } });
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-addr-city', 'Tempe');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  const post = t.calls.find(c => c.method === 'POST');
  assert.deepStrictEqual(post.body.changes, { address: { street: '120 Main St', city: 'Tempe', state: 'AZ', zip: '85004' } });
  t.w.close();
});

async function toStep2(extra) {
  const t = await start(Object.assign({ 'POST /account/details/change': { request_id: 'r1', targets: TARGETS } }, extra));
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-accounting_email', 'ap@example.com');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  return t;
}

test('step 2: labels, masked destinations; Confirm disabled until every target verified', async () => {
  const t = await toStep2({
    'POST /account/details/change/ID/verify': (b) => reply(200, { ok: true, verified: b.code === '111111', attempts_left: 4, all_verified: false }),
  });
  const body = $(t.doc, 'dc-body').textContent;
  assert.ok(body.includes("Owner's phone (the SMS admin phone on file)"));
  assert.ok(body.includes('(***) ***-2703'));
  assert.ok(body.includes('New Accounting email'));
  assert.ok(body.includes('a***@example.com'));
  const confirm = $(t.doc, 'dc-confirm');
  assert.strictEqual(confirm.disabled, true);

  const input = (k) => t.doc.querySelector('[data-code-for="' + k + '"]');
  const vbtn = (k) => t.doc.querySelector('[data-verify-for="' + k + '"]');
  input('sms_current').value = '111111';
  click(t.w, vbtn('sms_current'));
  await tick();
  assert.strictEqual($(t.doc, 'dc-confirm').disabled, true, 'one of two verified');
  const vpost = t.calls.find(c => c.path.endsWith('/verify'));
  assert.deepStrictEqual(vpost.body, { email: 'jordan@example.com', key: 'sms_current', code: '111111' });
  assert.ok(vpost.path.includes('/r1/'));

  input('accounting_new').value = '000000';
  click(t.w, vbtn('accounting_new'));
  await tick();
  assert.strictEqual($(t.doc, 'dc-confirm').disabled, true, 'wrong code leaves it disabled');
  assert.match(t.doc.querySelector('[data-err-for="accounting_new"]').textContent, /4 attempts left/);

  input('accounting_new').value = '111111';
  click(t.w, vbtn('accounting_new'));
  await tick();
  assert.strictEqual($(t.doc, 'dc-confirm').disabled, false, 'all verified');
  t.w.close();
});

test('resend shows a 60 second countdown and re-arms after resend', async () => {
  const t = await toStep2({ 'POST /account/details/change/ID/resend': { sent: true, retry_after: 60 } });
  const rb = () => t.doc.querySelector('[data-resend-for="accounting_new"]');
  assert.strictEqual(rb().disabled, true);
  assert.match(rb().textContent, /Resend code in 60s/);
  t.w.close();
});

test('resend after cooldown posts to /resend and restarts the countdown', async () => {
  const t = await toStep2({ 'POST /account/details/change/ID/resend': { sent: true, retry_after: 60 } });
  // sent:false target starts enabled
  const t2 = await start({ 'POST /account/details/change': { request_id: 'r2', targets: [{ key: 'sms_current', masked: 'x', sent: false }] },
    'POST /account/details/change/ID/resend': { sent: true, retry_after: 60 } });
  click(t2.w, $(t2.doc, 'btn-request-update'));
  setVal(t2.doc, 'dc-main_phone', '5551112222');
  click(t2.w, $(t2.doc, 'dc-continue'));
  await tick();
  const rb = t2.doc.querySelector('[data-resend-for="sms_current"]');
  assert.strictEqual(rb.disabled, false);
  click(t2.w, rb);
  await tick();
  const rpost = t2.calls.find(c => c.path.endsWith('/resend'));
  assert.deepStrictEqual(rpost.body, { email: 'jordan@example.com', key: 'sms_current' });
  assert.match(t2.doc.querySelector('[data-resend-for="sms_current"]').textContent, /Resend code in 60s/);
  t.w.close(); t2.w.close();
});

async function verifyAll(t) {
  for (const tg of TARGETS) {
    t.doc.querySelector('[data-code-for="' + tg.key + '"]').value = '111111';
    click(t.w, t.doc.querySelector('[data-verify-for="' + tg.key + '"]'));
    await tick();
  }
}
const VERIFY_OK = { 'POST /account/details/change/ID/verify': { ok: true, verified: true, attempts_left: 5, all_verified: false } };

test('success: shows "Changes saved" and refreshes the panel', async () => {
  const t = await toStep2(Object.assign({ 'POST /account/details/change/ID/confirm': { status: 'applied', message: 'ok' } }, VERIFY_OK));
  await verifyAll(t);
  const before = t.calls.filter(c => c.path === '/broker-account').length;
  click(t.w, $(t.doc, 'dc-confirm'));
  await tick(5);
  const cpost = t.calls.find(c => c.path.endsWith('/confirm'));
  assert.deepStrictEqual(cpost.body, { email: 'jordan@example.com' });
  assert.match($(t.doc, 'dc-body').textContent, /Changes saved/);
  assert.match($(t.doc, 'dc-body').textContent, /Accounting email/);
  assert.ok(t.calls.filter(c => c.path === '/broker-account').length > before, 'panel refreshed');
  t.w.close();
});

test('applied_partial still shows success', async () => {
  const t = await toStep2(Object.assign({ 'POST /account/details/change/ID/confirm': { status: 'applied_partial', message: 'ok' } }, VERIFY_OK));
  await verifyAll(t);
  click(t.w, $(t.doc, 'dc-confirm'));
  await tick(5);
  assert.match($(t.doc, 'dc-body').textContent, /Changes saved/);
  t.w.close();
});

test('502 failed: shows the API message, not a network error', async () => {
  const MSG = "We couldn't save your changes. Nothing was changed. Please try again or call 888-673-7349.";
  const t = await toStep2(Object.assign({ 'POST /account/details/change/ID/confirm': () => reply(502, { status: 'failed', message: MSG }) }, VERIFY_OK));
  await verifyAll(t);
  click(t.w, $(t.doc, 'dc-confirm'));
  await tick(5);
  assert.ok($(t.doc, 'dc-body').textContent.includes(MSG));
  assert.ok(!/network/i.test($(t.doc, 'dc-body').textContent + $(t.doc, 'dc-msg').textContent));
  t.w.close();
});

test('start 409 shows the API message on step 1', async () => {
  const MSG = 'Call OperFi at 888-673-7349 to update these details.';
  const t = await start({ 'POST /account/details/change': () => reply(409, { message: MSG }) });
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-main_phone', '5551112222');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  assert.strictEqual($(t.doc, 'dc-msg').textContent, MSG);
  assert.ok(/STEP 1 OF 2/.test($(t.doc, 'dc-body').textContent));
  t.w.close();
});

test('verify 409 (expired): message and a button back to step 1', async () => {
  const t = await toStep2({ 'POST /account/details/change/ID/verify': () => reply(409, { message: 'expired' }) });
  t.doc.querySelector('[data-code-for="sms_current"]').value = '123456';
  click(t.w, t.doc.querySelector('[data-verify-for="sms_current"]'));
  await tick();
  assert.strictEqual($(t.doc, 'dc-msg').textContent, 'This request expired. Start again.');
  const btn = Array.from($(t.doc, 'dc-foot').querySelectorAll('button')).find(b => /Start again/.test(b.textContent));
  assert.ok(btn);
  click(t.w, btn);
  assert.ok(/STEP 1 OF 2/.test($(t.doc, 'dc-body').textContent));
  t.w.close();
});

test('escapes server text (no HTML injection)', async () => {
  const t = await start({ 'POST /account/details/change': { request_id: 'r1', targets: [{ key: 'sms_current', masked: '<img src=x onerror=alert(1)>', sent: true }] } });
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-main_phone', '5551112222');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  assert.strictEqual($(t.doc, 'dc-body').querySelector('img'), null);
  assert.ok($(t.doc, 'dc-body').textContent.includes('<img src=x'));
  t.w.close();
});

// ── final review fixes ──────────────────────────────────────────────────────

test('helper text: code confirmation copy when can_change, form copy otherwise', async () => {
  const t = await start({});
  const txt = () => $(t.doc, 'company-body').textContent;
  assert.ok(txt().includes("Changes are confirmed with codes sent to the owner's phone and email on file."));
  assert.ok(!/secure update form/.test(txt()));
  t.w.close();
  const f = await start({ 'GET /account/details': { enabled: true, can_change: false, current: null } });
  assert.ok(f.doc.getElementById('company-body').textContent.includes('Opens a secure update form in a new tab.'));
  assert.ok(!/Changes are confirmed with codes/.test(f.doc.getElementById('company-body').textContent));
  f.w.close();
});

const DEFERRED = [
  { key: 'sms_current', channel: 'sms', masked: '(***) ***-2703', sent: true },
  { key: 'accounting_new', channel: 'email', masked: 'a***@example.com', sent: false },
];
async function toDeferred(verifyReply) {
  const t = await start({
    'POST /account/details/change': { request_id: 'r1', targets: DEFERRED },
    'POST /account/details/change/ID/verify': verifyReply,
  });
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-accounting_email', 'ap@example.com');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  return t;
}
const card = (t, k) => t.doc.querySelector('.dc-card[data-key="' + k + '"]');

test('new-destination card waits for the owner phone, then opens when sent_now lists it', async () => {
  const t = await toDeferred({ ok: true, verified: true, attempts_left: 5, all_verified: false, sent_now: [{ key: 'accounting_new', sent: true }] });
  assert.ok(card(t, 'accounting_new').textContent.includes("We'll send this code after you confirm the owner's phone."));
  assert.strictEqual(t.doc.querySelector('[data-code-for="accounting_new"]').disabled, true);
  assert.strictEqual(t.doc.querySelector('[data-verify-for="accounting_new"]').disabled, true);
  assert.ok(!/could not send/.test(card(t, 'accounting_new').textContent));
  t.doc.querySelector('[data-code-for="sms_current"]').value = '111111';
  click(t.w, t.doc.querySelector('[data-verify-for="sms_current"]'));
  await tick();
  assert.ok(!card(t, 'accounting_new').textContent.includes("We'll send this code after"));
  assert.strictEqual(t.doc.querySelector('[data-code-for="accounting_new"]').disabled, false);
  assert.strictEqual(t.doc.querySelector('[data-verify-for="accounting_new"]').disabled, false);
  assert.match(t.doc.querySelector('[data-resend-for="accounting_new"]').textContent, /Resend code in 60s/);
  t.w.close();
});

test('sent_now with sent:false opens the card with a resend prompt', async () => {
  const t = await toDeferred({ ok: true, verified: true, attempts_left: 5, all_verified: false, sent_now: [{ key: 'accounting_new', sent: false }] });
  t.doc.querySelector('[data-code-for="sms_current"]').value = '111111';
  click(t.w, t.doc.querySelector('[data-verify-for="sms_current"]'));
  await tick();
  assert.strictEqual(t.doc.querySelector('[data-code-for="accounting_new"]').disabled, false);
  assert.match(t.doc.querySelector('[data-err-for="accounting_new"]').textContent, /Use Resend code/);
  assert.strictEqual(t.doc.querySelector('[data-resend-for="accounting_new"]').disabled, false);
  t.w.close();
});

test('merged target shows one card labelled with the others it covers', async () => {
  const t = await start({ 'POST /account/details/change': { request_id: 'r1', targets: [
    { key: 'sms_current', channel: 'sms', masked: 'x', sent: true },
    { key: 'operations_new', channel: 'email', masked: 'n***@example.com', sent: true, covers: ['operations_new', 'accounting_new'] }] } });
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-accounting_email', 'n@example.com');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  assert.strictEqual(t.doc.querySelectorAll('.dc-card').length, 2);
  assert.ok(card(t, 'operations_new').textContent.includes('New Operations email (also used for New Accounting email)'));
  t.w.close();
});

async function toConfirm(confirmReply, detailsAfter) {
  let gets = 0;
  const t = await toStep2(Object.assign({
    'GET /account/details': () => reply(200, ++gets === 1 ? META : detailsAfter(gets)),
    'POST /account/details/change/ID/confirm': confirmReply,
  }, VERIFY_OK));
  await verifyAll(t);
  click(t.w, $(t.doc, 'dc-confirm'));
  await tick(10);
  return t;
}
const APPLIED = () => ({ enabled: true, can_change: true, current: Object.assign({}, CURRENT, { accounting_email: 'AP@example.com' }) });
const NOT_APPLIED = () => META;

test('confirm network error but the change is already applied: success outcome', async () => {
  const t = await toConfirm(() => Promise.reject(new Error('net')), APPLIED);
  assert.match($(t.doc, 'dc-body').textContent, /Changes saved/);
  t.w.close();
});

test('confirm 409 but the change is already applied: success outcome', async () => {
  const t = await toConfirm(() => reply(409, { message: 'x' }), APPLIED);
  assert.match($(t.doc, 'dc-body').textContent, /Changes saved/);
  t.w.close();
});

test('confirm 409 and not applied: expired; network error and not applied: retry message', async () => {
  const a = await toConfirm(() => reply(409, { message: 'x' }), NOT_APPLIED);
  assert.strictEqual($(a.doc, 'dc-msg').textContent, 'This request expired. Start again.');
  a.w.close();
  const b = await toConfirm(() => Promise.reject(new Error('net')), NOT_APPLIED);
  assert.match($(b.doc, 'dc-msg').textContent, /Network error/);
  assert.ok(!/Changes saved/.test($(b.doc, 'dc-body').textContent));
  b.w.close();
});

test('step 1 shows the API message for 429 and 400', async () => {
  for (const [status, msg] of [[429, 'Too many update attempts. Try again in an hour or call 888-673-7349.'], [400, 'Enter a US phone number.']]) {
    const t = await start({ 'POST /account/details/change': () => reply(status, { ok: false, message: msg }) });
    click(t.w, $(t.doc, 'btn-request-update'));
    setVal(t.doc, 'dc-main_phone', '5551112222');
    click(t.w, $(t.doc, 'dc-continue'));
    await tick();
    assert.strictEqual($(t.doc, 'dc-msg').textContent, msg);
    assert.strictEqual($(t.doc, 'dc-continue').disabled, false);
    t.w.close();
  }
  const t = await start({ 'POST /account/details/change': () => reply(429, {}) });
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-main_phone', '5551112222');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  assert.match($(t.doc, 'dc-msg').textContent, /Too many update attempts/);
  t.w.close();
});
