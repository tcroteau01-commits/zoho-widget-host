// CREDITINT1: financials flow through the broker portal. Staff request them from
// the customer profile; the broker sees the state, downloads the files and asks
// for them from its own customer's detail pane. Real customer-approvals.html in
// JSDOM, same harness as customer-approvals-profile-docs.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');
const profileJs = fs.readFileSync(path.resolve('customer-profile.js'), 'utf8');
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function reply(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status: status,
    json: function() { return Promise.resolve(body); },
    text: function() { return Promise.resolve(JSON.stringify(body)); } });
}

const PROFILE = {
  submission_id: '4455', customer_name: 'HOGAN EQUIPMENT', broker: 'Marek LLC',
  status: 'Approved', engine: null, identity: null, summary: null, fv_debtor: null,
  fv_candidates: [], priors: [], priors_unavailable: false, notes: [], activity: [],
  contacts: {}, submitted: { company_name: 'HOGAN EQUIPMENT', documents: [] },
  can_act: true, financials: { state: 'none', application_id: null, requests: [] }
};

const PREVIEW_VERIFIED = {
  submission_id: '4455', company: 'HOGAN EQUIPMENT', owning_account_name: 'Acme Carriers',
  client_email: 'o***@acme.com', customer_email_on_file: 'dana@hogan.com', has_app: true,
  verified_email_present: true, verified_email: 'd***@hogan.com', financials_state: 'none'
};
const PREVIEW_UNVERIFIED = Object.assign({}, PREVIEW_VERIFIED,
  { verified_email_present: false, verified_email: '', has_app: false });

async function bootProfile(routes) {
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  await wait(50);
  w.eval(profileJs);
  const calls = [];
  w.fetch = function(url, opts) {
    calls.push({ url: url, opts: opts || {} });
    for (const [re, fn] of routes) { if (re.test(url)) return fn(url, opts || {}); }
    return reply(200, PROFILE);
  };
  w.renderProfile({ ID: '4455' }, PROFILE);
  return { w, d: w.document, calls };
}

function body(call) { return JSON.parse(call.opts.body || '{}'); }

// ── staff, on the customer profile ──────────────────────────────────────────

test('Request financials loads the staff preview, then shows company, client and email on file', async () => {
  const { d, calls } = await bootProfile([[/staff-preview$/, () => reply(200, PREVIEW_UNVERIFIED)]]);
  d.querySelector('[data-fin-open]').click();
  await wait(20);
  const pv = calls.find((c) => /\/credit-app\/financials\/staff-preview$/.test(c.url));
  assert.ok(pv, 'staff-preview was not called');
  assert.strictEqual(pv.opts.method, 'POST');
  assert.strictEqual(pv.opts.credentials, 'include');
  assert.deepStrictEqual(body(pv), { submission_id: '4455' });
  const form = d.getElementById('cp-fin-form');
  assert.strictEqual(form.hidden, false);
  const text = d.getElementById('cp-fin-preview').textContent;
  assert.ok(text.includes('HOGAN EQUIPMENT'));
  assert.ok(text.includes('Acme Carriers'));
  assert.ok(text.includes('dana@hogan.com'));
  assert.strictEqual(d.getElementById('cp-fin-recipient').value, 'dana@hogan.com');
});

test('preview values are set as text, never parsed as markup', async () => {
  const evil = Object.assign({}, PREVIEW_UNVERIFIED, { company: '<img src=x onerror="window.__x=1">' });
  const { w, d } = await bootProfile([[/staff-preview$/, () => reply(200, evil)]]);
  d.querySelector('[data-fin-open]').click();
  await wait(20);
  assert.strictEqual(d.querySelector('#cp-fin-preview img'), null);
  assert.strictEqual(w.__x, undefined);
});

test('send posts submission_id, note and the recipient, then shows the sent-to address and refreshes', async () => {
  const { w, d, calls } = await bootProfile([
    [/staff-preview$/, () => reply(200, PREVIEW_UNVERIFIED)],
    [/request-financials$/, () => reply(200, { ok: true, delivered: true, sent_to: 'n***@hogan.com',
                                               application_id: 'a1', request_id: 'r1' })]]);
  d.querySelector('[data-fin-open]').click();
  await wait(20);
  d.getElementById('cp-fin-recipient').value = 'new@hogan.com';
  d.getElementById('cp-fin-note').value = 'Two years of statements';
  d.querySelector('[data-fin-send]').click();
  await wait(30);
  const send = calls.find((c) => /\/credit-app\/request-financials$/.test(c.url));
  assert.ok(send, 'request-financials was not called');
  assert.strictEqual(send.opts.credentials, 'include');
  assert.deepStrictEqual(body(send), { submission_id: '4455', note: 'Two years of statements',
                                       recipient_email: 'new@hogan.com' });
  assert.ok(d.getElementById('toast').textContent.includes('n***@hogan.com'));
  assert.ok(calls.some((c) => /\/customer-profile\/4455$/.test(c.url)), 'profile was not refreshed');
  void w;
});

test('with a verified address and the box left blank, no recipient_email is sent', async () => {
  const { d, calls } = await bootProfile([
    [/staff-preview$/, () => reply(200, PREVIEW_VERIFIED)],
    [/request-financials$/, () => reply(200, { ok: true, delivered: true, sent_to: 'd***@hogan.com' })]]);
  d.querySelector('[data-fin-open]').click();
  await wait(20);
  assert.strictEqual(d.getElementById('cp-fin-recipient').value, '');
  assert.ok(d.getElementById('cp-fin-recipient-hint').textContent.includes('d***@hogan.com'));
  d.querySelector('[data-fin-send]').click();
  await wait(30);
  const send = calls.find((c) => /\/credit-app\/request-financials$/.test(c.url));
  assert.ok(!('recipient_email' in body(send)), 'a verified address must not be overridden');
});

test('with no verified address, an empty recipient is refused before any call', async () => {
  const { d, calls } = await bootProfile([[/staff-preview$/, () => reply(200, PREVIEW_UNVERIFIED)]]);
  d.querySelector('[data-fin-open]').click();
  await wait(20);
  d.getElementById('cp-fin-recipient').value = '';
  d.querySelector('[data-fin-send]').click();
  await wait(20);
  assert.ok(!calls.some((c) => /request-financials$/.test(c.url)));
  assert.ok(/email/i.test(d.getElementById('cp-fin-msg').textContent));
});

test('a refusal keeps the form and shows the server reason', async () => {
  const { d } = await bootProfile([
    [/staff-preview$/, () => reply(200, PREVIEW_UNVERIFIED)],
    [/request-financials$/, () => reply(409, { error: 'There is no email on file for this customer.' })]]);
  d.querySelector('[data-fin-open]').click();
  await wait(20);
  d.querySelector('[data-fin-send]').click();
  await wait(30);
  assert.ok(d.getElementById('cp-fin-msg').textContent.includes('There is no email on file'));
  assert.strictEqual(d.getElementById('cp-fin-form').hidden, false);
});

test('a request that was recorded but not mailed says so', async () => {
  const { d } = await bootProfile([
    [/staff-preview$/, () => reply(200, PREVIEW_UNVERIFIED)],
    [/request-financials$/, () => reply(200, { ok: true, delivered: false, sent_to: 'd***@hogan.com' })]]);
  d.querySelector('[data-fin-open]').click();
  await wait(20);
  d.querySelector('[data-fin-send]').click();
  await wait(30);
  assert.ok(/did not send/i.test(d.getElementById('toast').textContent));
});

// ── broker, on its own customer's detail pane ───────────────────────────────

function bootPane() {
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  w.document.body.innerHTML =
    '<div id="panel" data-submission-id="9">' +
      '<div class="panel-section" id="ca-app-section" style="display:none;">' +
        '<div id="ca-app-summary-text"></div><div id="ca-app-rows"></div>' +
        '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
        '<div id="ca-app-supplement"></div>' +
      '</div>' +
      '<div class="panel-section" id="ca-fin-section" style="display:none;"><div id="ca-fin-body"></div></div>' +
    '</div><div id="toast"></div>';
  w.brokerEmail = 'broker@marek.com';
  return w;
}

const STATUS_FIN_ONLY = { status: 'financials_only', legacy: false, parties: [],
  supplement_requests: [], financials_state: 'received', application_id: 'app9',
  financials_files: [{ id: 'f1', name: 'P&L 2025.pdf', size: 2048 }] };

test('the drawer has a Financials section skeleton', () => {
  assert.ok(html.includes('id="ca-fin-section"'));
});

test('a financials-only app shows its state, never as App sent', () => {
  const w = bootPane();
  w.renderCreditAppFinancials({ ID: '9' }, STATUS_FIN_ONLY);
  const sec = w.document.getElementById('ca-fin-section');
  assert.strictEqual(sec.style.display, '');
  assert.ok(sec.textContent.includes('Financials received'));
  assert.ok(!/App sent/i.test(sec.textContent));
  assert.strictEqual(w.CA_APP_SUMMARY_FOR_TEST.financials_only, 'Financials requested');
});

test('broker file links go to the financials-file route with no ?email=, as downloads', () => {
  const w = bootPane();
  w.renderCreditAppFinancials({ ID: '9' }, STATUS_FIN_ONLY);
  const a = w.document.querySelector('#ca-fin-section a');
  assert.ok(a, 'no file link');
  assert.ok(a.href.endsWith('/credit-app/financials-file/app9/f1'), a.href);
  assert.ok(!/email=/.test(a.href), 'downloads are session-only; the email must never ride the URL');
  assert.ok(a.hasAttribute('download'));
  assert.strictEqual(a.getAttribute('target'), '_blank');
  assert.ok(a.textContent.includes('P&L 2025.pdf'));
  assert.ok(!w.document.getElementById('ca-fin-section').textContent.includes('Sign in to the new OperFi portal'));
});

test('received with the file list withheld (no portal session) says to sign in, with no links', () => {
  const w = bootPane();
  w.renderCreditAppFinancials({ ID: '9' }, Object.assign({}, STATUS_FIN_ONLY, { financials_files: [] }));
  const sec = w.document.getElementById('ca-fin-section');
  assert.ok(sec.textContent.includes('Financials received'));
  assert.ok(sec.textContent.includes('Sign in to the new OperFi portal to view and download these files.'));
  assert.strictEqual(sec.querySelector('a'), null);
});

test('waiting with no files does not tell the broker to sign in', () => {
  const w = bootPane();
  w.renderCreditAppFinancials({ ID: '9' }, Object.assign({}, STATUS_FIN_ONLY,
    { financials_state: 'waiting', financials_files: [] }));
  assert.ok(!w.document.getElementById('ca-fin-section').textContent.includes('Sign in'));
});

test('without application_id in the status payload, files are named but not linked', () => {
  const w = bootPane();
  const p = Object.assign({}, STATUS_FIN_ONLY);
  delete p.application_id;
  w.renderCreditAppFinancials({ ID: '9' }, p);
  const sec = w.document.getElementById('ca-fin-section');
  assert.strictEqual(sec.querySelector('a'), null);
  assert.ok(sec.textContent.includes('P&L 2025.pdf'));
});

test('a payload with no financials_state leaves the section hidden', () => {
  const w = bootPane();
  w.renderCreditAppFinancials({ ID: '9' }, { status: 'sent', parties: [] });
  assert.strictEqual(w.document.getElementById('ca-fin-section').style.display, 'none');
});

test('broker Request financials posts email, submission_id and note', async () => {
  const w = bootPane();
  const calls = [];
  w.fetch = function(url, opts) {
    calls.push({ url, opts: opts || {} });
    if (/request-financials$/.test(url)) return reply(200, { ok: true, delivered: true, sent_to: 'd***@hogan.com' });
    return reply(200, Object.assign({}, STATUS_FIN_ONLY, { financials_state: 'waiting' }));
  };
  w.renderCreditAppFinancials({ ID: '9' }, Object.assign({}, STATUS_FIN_ONLY, { financials_state: 'none',
                                                                               financials_files: [] }));
  const d = w.document;
  d.getElementById('ca-fin-ask').click();
  d.getElementById('ca-fin-note').value = 'For the limit increase';
  d.getElementById('ca-fin-send').click();
  await wait(30);
  const send = calls.find((c) => /\/credit-app\/request-financials$/.test(c.url));
  assert.ok(send);
  assert.deepStrictEqual(JSON.parse(send.opts.body),
    { email: 'broker@marek.com', submission_id: '9', note: 'For the limit increase' });
  assert.ok(d.getElementById('toast').textContent.includes('d***@hogan.com'));
});

test('staff never get the broker Request financials button in the drawer', () => {
  const w = bootPane();
  w.allClients = true;
  w.renderCreditAppFinancials({ ID: '9' }, STATUS_FIN_ONLY);
  assert.strictEqual(w.document.getElementById('ca-fin-ask'), null);
});

test('an imported (legacy) app gets no Request financials button', () => {
  const w = bootPane();
  w.renderCreditAppFinancials({ ID: '9' }, Object.assign({}, STATUS_FIN_ONLY, { legacy: true }));
  assert.strictEqual(w.document.getElementById('ca-fin-ask'), null);
});

test('drawer values are escaped', () => {
  const w = bootPane();
  w.renderCreditAppFinancials({ ID: '9' }, Object.assign({}, STATUS_FIN_ONLY,
    { financials_files: [{ id: 'f1', name: '<img src=x onerror="window.__y=1">', size: 1 }] }));
  assert.strictEqual(w.document.querySelector('#ca-fin-section img'), null);
});

test('the list row says Financials requested from the bulk status', async () => {
  const w = bootPane();
  w.fetch = () => reply(200, { applications: { '9': { status: 'financials_only', completed: 0, total: 0,
                                                      waiting_on: [], financials_state: 'waiting' } } });
  w.fetchCreditAppStatusBulk();
  await wait(20);
  const h = w.caAppRowProgressHtml({ ID: '9' });
  assert.ok(h.includes('Financials requested'));
  assert.ok(!/App sent/i.test(h));
});

test('the list row says Financials received once they are in', async () => {
  const w = bootPane();
  w.fetch = () => reply(200, { applications: { '9': { status: 'ready_for_review', completed: 5, total: 5,
                                                      waiting_on: [], financials_state: 'received' } } });
  w.fetchCreditAppStatusBulk();
  await wait(20);
  const h = w.caAppRowProgressHtml({ ID: '9' });
  assert.ok(h.includes('Financials received'));
  assert.ok(h.includes('Application complete'));
});
