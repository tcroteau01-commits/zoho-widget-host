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

// ACCTCHG1 Phase 4: held confirm and anchor_cooldown.
test('confirm held: "Pending OperFi review" with the API message, no "Changes saved", panel not refreshed', async () => {
  const MSG = 'For your security, our team reviews this change before it takes effect. Your current details stay in place until then.';
  const t = await toStep2(Object.assign({ 'POST /account/details/change/ID/confirm': { status: 'held', message: MSG } }, VERIFY_OK));
  await verifyAll(t);
  const before = t.calls.filter(c => c.path === '/broker-account' || c.path === '/account/details').length;
  click(t.w, $(t.doc, 'dc-confirm'));
  await tick(5);
  const body = $(t.doc, 'dc-body').textContent;
  assert.match(body, /Pending OperFi review/);
  assert.ok(body.includes(MSG));
  assert.ok(!/Changes saved/.test(body));
  assert.ok(!/expired/i.test(body + $(t.doc, 'dc-msg').textContent));
  assert.strictEqual(t.calls.filter(c => c.path === '/broker-account' || c.path === '/account/details').length, before, 'panel not refreshed');
  const foot = $(t.doc, 'dc-foot') ? $(t.doc, 'dc-foot').textContent : t.doc.body.textContent;
  assert.match(foot, /Close/);
  t.w.close();
});

test('create 409 anchor_cooldown: shows the API message on step 1, not "expired"', async () => {
  const MSG = "For your security, this change can't be made yet. Call OperFi at 888-673-7349.";
  const t = await start({ 'POST /account/details/change': () => reply(409, { ok: false, code: 'anchor_cooldown', message: MSG }) });
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-main_phone', '5551112222');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  assert.strictEqual($(t.doc, 'dc-msg').textContent, MSG);
  assert.ok(!/expired/i.test($(t.doc, 'dc-msg').textContent + $(t.doc, 'dc-body').textContent));
  assert.ok(/STEP 1 OF 2/.test($(t.doc, 'dc-body').textContent));
  t.w.close();
});

// ── ACCTCHG1 Phase 3: owner sign-in email, non-owner requests with owner approval ──

const OWNER_META = { enabled: true, can_change: true, can_request: false, is_owner: true, login_email: 'jordan@example.com', current: CURRENT };
const REQ_META = { enabled: true, can_change: false, can_request: true, is_owner: false, login_email: null, current: CURRENT };

test('owner step 1: sign-in email row with the current login and the Admin checkbox', async () => {
  const t = await start({ 'GET /account/details': OWNER_META });
  click(t.w, $(t.doc, 'btn-request-update'));
  const body = $(t.doc, 'dc-body').textContent;
  assert.ok(body.includes('Your sign-in email'));
  assert.ok(body.includes('(account owner only)'));
  assert.ok($(t.doc, 'dc-login_email'), 'login input');
  assert.ok(body.includes("Also make my new sign-in email the account's Admin email"));
  assert.strictEqual($(t.doc, 'dc-login-admin').type, 'checkbox');
  assert.strictEqual($(t.doc, 'dc-login-admin').checked, false);
  t.w.close();
});

test('owner: login_email posted alone; with the checkbox, admin_email carries the same value', async () => {
  const LOGIN_T = [{ key: 'sms_current', channel: 'sms', masked: 'x', sent: true }, { key: 'login_new', channel: 'email', masked: 'n***@example.com', sent: false }];
  const t = await start({ 'GET /account/details': OWNER_META, 'POST /account/details/change': { request_id: 'r1', targets: LOGIN_T } });
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-login_email', ' New@Example.com ');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  let post = t.calls.filter(c => c.method === 'POST')[0];
  assert.deepStrictEqual(post.body.changes, { login_email: 'New@Example.com' });
  assert.ok($(t.doc, 'dc-body').textContent.includes('New sign-in email'));
  t.w.close();

  const t2 = await start({ 'GET /account/details': OWNER_META, 'POST /account/details/change': { request_id: 'r1', targets: LOGIN_T } });
  click(t2.w, $(t2.doc, 'btn-request-update'));
  setVal(t2.doc, 'dc-login_email', 'new@example.com');
  $(t2.doc, 'dc-login-admin').checked = true;
  click(t2.w, $(t2.doc, 'dc-continue'));
  await tick();
  post = t2.calls.filter(c => c.method === 'POST')[0];
  assert.deepStrictEqual(post.body.changes, { admin_email: 'new@example.com', login_email: 'new@example.com' });
  t2.w.close();
});

test('owner: same sign-in email is ignored; checkbox with a different Admin email is refused', async () => {
  const t = await start({ 'GET /account/details': OWNER_META });
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-login_email', 'JORDAN@example.com');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  assert.match($(t.doc, 'dc-msg').textContent, /Nothing to change/);
  setVal(t.doc, 'dc-login_email', 'new@example.com');
  setVal(t.doc, 'dc-admin_email', 'other@example.com');
  $(t.doc, 'dc-login-admin').checked = true;
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  assert.ok(!t.calls.some(c => c.method === 'POST'));
  assert.match($(t.doc, 'dc-msg').textContent, /must match/);
  t.w.close();
});

test('owner: 409 email_in_use shows the API message on step 1', async () => {
  const MSG = 'That email is already used by another OperFi login. Call OperFi at 888-673-7349.';
  const t = await start({ 'GET /account/details': OWNER_META, 'POST /account/details/change': () => reply(409, { ok: false, code: 'email_in_use', message: MSG }) });
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-login_email', 'taken@example.com');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  assert.strictEqual($(t.doc, 'dc-msg').textContent, MSG);
  assert.ok(/STEP 1 OF 2/.test($(t.doc, 'dc-body').textContent));
  t.w.close();
});

test('owner confirm with relogin: sign-in again message and only a button to /portal/login', async () => {
  const t = await toStep2(Object.assign({
    'GET /account/details': OWNER_META,
    'POST /account/details/change/ID/confirm': { ok: true, status: 'applied', relogin: true, login_email: 'new@example.com',
      message: 'Your sign-in email is now new@example.com. Sign in again with your new email.' },
  }, VERIFY_OK));
  await verifyAll(t);
  const nav = [];
  t.w.dcNavigate = (u) => nav.push(u);
  const before = t.calls.length;
  click(t.w, $(t.doc, 'dc-confirm'));
  await tick(5);
  assert.ok($(t.doc, 'dc-body').textContent.includes('Your sign-in email is now new@example.com. Sign in again with your new email.'));
  const btns = $(t.doc, 'dc-foot').querySelectorAll('button');
  assert.strictEqual(btns.length, 1);
  assert.match(btns[0].textContent, /Sign in/);
  assert.strictEqual(t.calls.length, before + 1, 'no panel refresh calls after relogin');
  click(t.w, btns[0]);
  assert.deepStrictEqual(nav, ['http://api/portal/login']);
  t.w.close();
});

test('relogin text is escaped', async () => {
  const t = await toStep2(Object.assign({
    'POST /account/details/change/ID/confirm': { ok: true, status: 'applied', relogin: true, login_email: '<img src=x onerror=alert(1)>' },
  }, VERIFY_OK));
  await verifyAll(t);
  t.w.dcNavigate = () => {};
  click(t.w, $(t.doc, 'dc-confirm'));
  await tick(5);
  assert.strictEqual($(t.doc, 'dc-body').querySelector('img'), null);
  assert.ok($(t.doc, 'dc-body').textContent.includes('<img src=x'));
  t.w.close();
});

// Non-owner requester.
const REQ_TARGETS = [
  { key: 'sms_current', channel: 'sms', masked: '(***) ***-2703', sent: false, owner_only: true },
  { key: 'admin_current', channel: 'email', masked: 'j***@example.com', sent: false, owner_only: true },
  { key: 'accounting_new', channel: 'email', masked: 'a***@example.com', sent: false, owner_only: false },
];
const REQ_CREATE = { ok: true, request_id: 'r1', needs_owner: true, status: 'awaiting_owner', owner_name: 'Jordan Lee',
  message: 'Waiting for the account owner. We sent Jordan Lee a link by text and email to review and approve this change. Nothing changes until they do. The request expires in 24 hours.',
  targets: REQ_TARGETS };
const statusReply = (status, verifiedAnchors, newSent) => ({ ok: true, request_id: 'r1', status, needs_owner: true,
  targets: REQ_TARGETS.map(x => ({ key: x.key, channel: x.channel, masked: x.masked, owner_only: x.owner_only,
    verified: x.owner_only ? verifiedAnchors : false, sent: x.owner_only ? verifiedAnchors : newSent })) });

async function toRequest(routes) {
  const t = await start(Object.assign({ 'GET /account/details': REQ_META, 'POST /account/details/change': REQ_CREATE }, routes));
  t.w.DC_POLL_MS = 20;
  click(t.w, $(t.doc, 'btn-request-update'));
  setVal(t.doc, 'dc-accounting_email', 'ap@example.com');
  click(t.w, $(t.doc, 'dc-continue'));
  await tick();
  return t;
}
const polls = (t) => t.calls.filter(c => c.method === 'GET' && c.path === '/account/details/change/r1').length;

test('non-owner: Request Update opens the flow without the sign-in row; helper says the owner approves', async () => {
  const t = await start({ 'GET /account/details': REQ_META });
  assert.match($(t.doc, 'company-body').textContent, /account owner/);
  click(t.w, $(t.doc, 'btn-request-update'));
  assert.strictEqual(t.w.__opened.length, 0);
  assert.ok($(t.doc, 'dc-scrim').classList.contains('show'));
  assert.strictEqual($(t.doc, 'dc-login_email'), null);
  assert.ok(!/sign-in email/i.test($(t.doc, 'dc-body').textContent));
  t.w.close();
});

test('owner without login_email in meta shows no sign-in row', async () => {
  const t = await start({});
  click(t.w, $(t.doc, 'btn-request-update'));
  assert.strictEqual($(t.doc, 'dc-login_email'), null);
  t.w.close();
});

test('non-owner after create: waiting for the owner, owner-only rows, parked new code, Cancel request', async () => {
  const t = await toRequest({ 'GET /account/details/change/r1': statusReply('awaiting_owner', false, false) });
  const body = $(t.doc, 'dc-body').textContent;
  assert.ok(body.includes('Waiting for the account owner'));
  assert.ok(body.includes('We sent Jordan Lee a link by text and email to review and approve this change. Nothing changes until they do. The request expires in 24 hours.'));
  for (const k of ['sms_current', 'admin_current']) {
    assert.ok(card(t, k).textContent.includes('The account owner enters this code.'));
    assert.strictEqual(t.doc.querySelector('[data-code-for="' + k + '"]'), null, k + ' has no code input');
    assert.strictEqual(t.doc.querySelector('[data-resend-for="' + k + '"]'), null, k + ' has no resend');
  }
  assert.strictEqual(t.doc.querySelector('[data-code-for="accounting_new"]').disabled, true);
  assert.ok(card(t, 'accounting_new').textContent.includes('after the account owner approves'));
  assert.strictEqual($(t.doc, 'dc-confirm').disabled, true);
  const foot = Array.from($(t.doc, 'dc-foot').querySelectorAll('button')).map(b => b.textContent);
  assert.ok(foot.includes('Cancel request'));
  assert.ok(!foot.includes('Back'));
  t.w.close();
});

test('non-owner: owner name is escaped', async () => {
  const t = await toRequest({ 'POST /account/details/change': Object.assign({}, REQ_CREATE, { owner_name: '<img src=x onerror=alert(1)>' }),
    'GET /account/details/change/r1': statusReply('awaiting_owner', false, false) });
  assert.strictEqual($(t.doc, 'dc-body').querySelector('img'), null);
  assert.ok($(t.doc, 'dc-body').textContent.includes('We sent <img src=x'));
  t.w.close();
});

test('polling: 15 s by default; owner approval verifies anchors and opens the new code; Confirm after all verified', async () => {
  const t0 = boot({});
  assert.strictEqual(t0.w.DC_POLL_MS, 15000);
  t0.w.close();
  let approved = false;
  const t = await toRequest({
    'GET /account/details/change/r1': () => reply(200, approved ? statusReply('pending', true, true) : statusReply('awaiting_owner', false, false)),
    'POST /account/details/change/ID/verify': { ok: true, verified: true, attempts_left: 5, all_verified: true },
    'POST /account/details/change/ID/confirm': { ok: true, status: 'applied', message: 'ok' },
  });
  await tick(50);
  assert.ok(polls(t) >= 1, 'polled');
  assert.strictEqual(t.doc.querySelector('[data-code-for="accounting_new"]').disabled, true);
  approved = true;
  await tick(50);
  for (const k of ['sms_current', 'admin_current']) {
    assert.ok(card(t, k).classList.contains('done'), k + ' verified');
    assert.ok(card(t, k).textContent.includes('✓'), k + ' shows a check');
  }
  assert.ok(!$(t.doc, 'dc-body').textContent.includes('Waiting for the account owner'));
  const input = t.doc.querySelector('[data-code-for="accounting_new"]');
  assert.strictEqual(input.disabled, false);
  input.value = '123';
  await tick(50);
  assert.strictEqual(t.doc.querySelector('[data-code-for="accounting_new"]').value, '123', 'polling does not wipe a typed code');
  t.doc.querySelector('[data-code-for="accounting_new"]').value = '111111';
  click(t.w, t.doc.querySelector('[data-verify-for="accounting_new"]'));
  await tick(5);
  assert.strictEqual($(t.doc, 'dc-confirm').disabled, false);
  click(t.w, $(t.doc, 'dc-confirm'));
  await tick(10);
  assert.match($(t.doc, 'dc-body').textContent, /Changes saved/);
  const n = polls(t);
  await tick(60);
  assert.strictEqual(polls(t), n, 'polling stopped after the outcome');
  t.w.close();
});

test('polling stops when the panel closes and never stacks timers', async () => {
  const t = await toRequest({ 'GET /account/details/change/r1': statusReply('awaiting_owner', false, false) });
  t.w.dcStartPoll(); t.w.dcStartPoll();
  await tick(105);
  const n = polls(t);
  assert.ok(n >= 2 && n <= 6, 'one timer at 20 ms over ~100 ms, got ' + n);
  click(t.w, $(t.doc, 'dc-close'));
  const m = polls(t);
  await tick(80);
  assert.strictEqual(polls(t), m, 'no polling after close');
  t.w.close();
});

test('polling pauses while the tab is hidden and resumes when visible', async () => {
  const t = await toRequest({ 'GET /account/details/change/r1': statusReply('awaiting_owner', false, false) });
  let hidden = true;
  Object.defineProperty(t.doc, 'hidden', { configurable: true, get: () => hidden });
  t.doc.dispatchEvent(new t.w.Event('visibilitychange'));
  const m = polls(t);
  await tick(80);
  assert.strictEqual(polls(t), m, 'no polling while hidden');
  hidden = false;
  t.doc.dispatchEvent(new t.w.Event('visibilitychange'));
  await tick(80);
  assert.ok(polls(t) > m, 'resumed');
  t.w.close();
});

for (const [status, msg] of [
  ['declined', 'The account owner declined this request.'],
  ['expired', 'This request expired. Nothing was changed.'],
  ['cancelled', 'This request was cancelled. Nothing was changed.'],
]) {
  test('poll terminal status ' + status + ': plain message, flow ends, polling stops', async () => {
    const t = await toRequest({ 'GET /account/details/change/r1': statusReply(status, false, false) });
    await tick(50);
    assert.ok($(t.doc, 'dc-body').textContent.includes(msg));
    assert.strictEqual(t.doc.querySelector('[data-code-for]'), null);
    const foot = Array.from($(t.doc, 'dc-foot').querySelectorAll('button')).map(b => b.textContent);
    assert.deepStrictEqual(foot, ['Close']);
    const n = polls(t);
    await tick(60);
    assert.strictEqual(polls(t), n);
    t.w.close();
  });
}

test('Cancel request posts /cancel, shows a plain message and stops polling', async () => {
  const t = await toRequest({ 'GET /account/details/change/r1': statusReply('awaiting_owner', false, false),
    'POST /account/details/change/ID/cancel': { ok: true, status: 'cancelled' } });
  const btn = Array.from($(t.doc, 'dc-foot').querySelectorAll('button')).find(b => b.textContent === 'Cancel request');
  click(t.w, btn);
  await tick(5);
  const c = t.calls.find(x => x.path.endsWith('/cancel'));
  assert.ok(c && c.path.includes('/r1/'));
  assert.deepStrictEqual(c.body, { email: 'jordan@example.com' });
  assert.ok($(t.doc, 'dc-body').textContent.includes('This request was cancelled. Nothing was changed.'));
  const n = polls(t);
  await tick(60);
  assert.strictEqual(polls(t), n);
  t.w.close();
});

test('Cancel request 409 (already finished): shows the API message', async () => {
  const t = await toRequest({ 'GET /account/details/change/r1': statusReply('awaiting_owner', false, false),
    'POST /account/details/change/ID/cancel': () => reply(409, { ok: false, message: 'This request has already finished.' }) });
  const btn = Array.from($(t.doc, 'dc-foot').querySelectorAll('button')).find(b => b.textContent === 'Cancel request');
  click(t.w, btn);
  await tick(5);
  assert.strictEqual($(t.doc, 'dc-msg').textContent, 'This request has already finished.');
  t.w.close();
});

test('owner requests do not poll', async () => {
  const t = await toStep2({});
  t.w.DC_POLL_MS = 20;
  await tick(60);
  assert.ok(!t.calls.some(c => c.method === 'GET' && /\/account\/details\/change\//.test(c.path)));
  t.w.close();
});
