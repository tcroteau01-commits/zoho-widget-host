// TMSOTP1: the email step, the code step, and the session the page sends with
// the summary and upload calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-carrier-upload.html', import.meta.url), 'utf8');
const TOKEN = '1001.abc';
const SUMMARY = { load_number: 'MAR-1001', status: 'Delivered', broker_company: 'Marek LLC',
  carrier_name: 'ROADWAY', lane: 'Dallas, TX → Atlanta, GA', stops: [],
  upload_doc_types: ['BOL', 'Other', 'POD'] };

function makePage(opts = {}) {
  const calls = [];
  const routes = Object.assign({
    '/tms-public/otp/start': () => [200, { ok: true, message: 'neutral', resend_after: 60 }],
    '/tms-public/otp/check': () => [200, { ok: true, session: 'SESS.sig', expires_in: 86400 }],
    '/tms-public/load': () => [200, SUMMARY],
    '/tms-public/upload': () => [200, { ok: true, document_id: 'doc_1' }],
  }, opts.routes || {});
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://app.operfi.com/tms-carrier-upload.html?token=' + TOKEN,
    beforeParse(window) {
      if (opts.stored) window.localStorage.setItem('tmsotp1:' + TOKEN, JSON.stringify(opts.stored));
      window.fetch = function (url, init) {
        calls.push({ url: String(url), init: init || {} });
        const key = Object.keys(routes).find(k => String(url).indexOf(k) !== -1);
        const [status, body] = key ? routes[key](init || {}) : [404, {}];
        return Promise.resolve({ status, json: () => Promise.resolve(body) });
      };
    },
  });
  return { window: dom.window, doc: dom.window.document, calls };
}

const hidden = (doc, id) => doc.getElementById(id).classList.contains('hidden');
const flush = () => new Promise(r => setTimeout(r, 0));
const header = (call) => (call.init.headers || {})['X-TMS-Upload-Session'];

test('with no session the page asks for an email and shows nothing about the load', async () => {
  const { window, doc, calls } = makePage();
  window.boot();
  await flush();
  assert.equal(hidden(doc, 'verify-card'), false);
  assert.equal(hidden(doc, 'step-email'), false);
  assert.equal(hidden(doc, 'step-code'), true);
  assert.equal(hidden(doc, 'summary'), true);
  assert.equal(hidden(doc, 'upload-card'), true);
  assert.equal(calls.filter(c => c.url.includes('/tms-public/load')).length, 0);
});

test('an invalid email is refused on the page and nothing is posted', async () => {
  const { window, doc, calls } = makePage();
  window.boot();
  await window.sendCode('not-an-email');
  assert.match(doc.getElementById('vstatus').textContent, /valid email/i);
  assert.equal(calls.length, 0);
});

test('send code posts token + email, then shows the code step with a resend countdown', async () => {
  const { window, doc, calls } = makePage();
  window.boot();
  await window.sendCode(' driver@roadway.test ');
  const start = calls.find(c => c.url.includes('/otp/start'));
  assert.deepEqual(JSON.parse(start.init.body), { token: TOKEN, email: 'driver@roadway.test' });
  assert.equal(hidden(doc, 'step-code'), false);
  assert.equal(hidden(doc, 'step-email'), true);
  assert.match(doc.getElementById('otp-lead').textContent, /If driver@roadway\.test is on file/);
  const rb = doc.getElementById('otp-resend');
  assert.equal(rb.disabled, true);
  assert.match(rb.textContent, /60s/);
  assert.equal(doc.getElementById('otp-code').getAttribute('autocomplete'), 'one-time-code');
  assert.equal(doc.getElementById('otp-code').getAttribute('inputmode'), 'numeric');
});

test('a wrong code shows the neutral message and stays on the code step', async () => {
  const { window, doc } = makePage({ routes: {
    '/tms-public/otp/check': () => [400, { error: 'That code is not valid or has expired. Check the email address and code, or request a new code.' }],
  } });
  window.boot();
  await window.sendCode('driver@roadway.test');
  await window.verifyCode('123456');
  assert.match(doc.getElementById('vstatus').textContent, /not valid or has expired/);
  assert.equal(hidden(doc, 'step-code'), false);
  assert.equal(hidden(doc, 'upload-card'), true);
});

test('a short code is refused on the page', async () => {
  const { window, doc, calls } = makePage();
  window.boot();
  await window.sendCode('driver@roadway.test');
  await window.verifyCode('12');
  assert.match(doc.getElementById('vstatus').textContent, /6-digit/);
  assert.equal(calls.filter(c => c.url.includes('/otp/check')).length, 0);
});

test('a verified code stores the session and loads the summary with the header', async () => {
  const { window, doc, calls } = makePage();
  window.boot();
  await window.sendCode('driver@roadway.test');
  await window.verifyCode('482913');
  await flush();
  const check = calls.find(c => c.url.includes('/otp/check'));
  assert.deepEqual(JSON.parse(check.init.body), { token: TOKEN, email: 'driver@roadway.test', code: '482913' });
  const stored = JSON.parse(window.localStorage.getItem('tmsotp1:' + TOKEN));
  assert.equal(stored.session, 'SESS.sig');
  assert.ok(stored.exp > Date.now() + 86000 * 1000);
  const load = calls.find(c => c.url.includes('/tms-public/load'));
  assert.equal(header(load), 'SESS.sig');
  assert.equal(hidden(doc, 'verify-card'), true);
  assert.equal(hidden(doc, 'upload-card'), false);
  assert.match(doc.getElementById('summary').textContent, /MAR-1001/);
});

test('a stored session skips straight to the upload page', async () => {
  const { window, doc, calls } = makePage({ stored: { session: 'OLD.sig', exp: Date.now() + 3600e3 } });
  window.boot();
  await flush(); await flush();
  assert.equal(calls[0].url.includes('/tms-public/load'), true);
  assert.equal(header(calls[0]), 'OLD.sig');
  assert.equal(hidden(doc, 'verify-card'), true);
  assert.equal(hidden(doc, 'upload-card'), false);
});

test('an expired stored session is dropped and the email step shows', async () => {
  const { window, doc, calls } = makePage({ stored: { session: 'OLD.sig', exp: Date.now() - 1000 } });
  window.boot();
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(hidden(doc, 'step-email'), false);
  assert.equal(window.localStorage.getItem('tmsotp1:' + TOKEN), null);
});

test('a session the server rejects is cleared and the email step shows', async () => {
  const { window, doc } = makePage({ stored: { session: 'BAD.sig', exp: Date.now() + 3600e3 },
    routes: { '/tms-public/load': () => [401, { state: 'unverified' }] } });
  window.boot();
  await flush(); await flush();
  assert.equal(hidden(doc, 'step-email'), false);
  assert.equal(hidden(doc, 'summary'), true);
  assert.equal(window.localStorage.getItem('tmsotp1:' + TOKEN), null);
});

test('upload sends the session header', async () => {
  const { window, calls } = makePage({ stored: { session: 'OK.sig', exp: Date.now() + 3600e3 } });
  const file = new window.File([new Uint8Array([1])], 'pod.pdf', { type: 'application/pdf' });
  await window.uploadFile('POD', file);
  const up = calls.find(c => c.url.includes('/tms-public/upload'));
  assert.equal(header(up), 'OK.sig');
  assert.ok(up.init.body instanceof window.FormData);
});

test('an upload refused for no session sends the carrier back to verify', async () => {
  const { window, doc } = makePage({ stored: { session: 'OK.sig', exp: Date.now() + 3600e3 },
    routes: { '/tms-public/upload': () => [401, { state: 'unverified' }] } });
  const file = new window.File([new Uint8Array([1])], 'pod.pdf', { type: 'application/pdf' });
  await window.uploadFile('POD', file);
  assert.equal(hidden(doc, 'step-email'), false);
  assert.match(doc.getElementById('vstatus').textContent, /expired/i);
  assert.equal(window.localStorage.getItem('tmsotp1:' + TOKEN), null);
});

test('second time through: resend posts again, a different email goes back to step 1', async () => {
  const { window, doc, calls } = makePage();
  await new Promise(r => window.addEventListener('load', r));   // buttons are wired on load
  await window.sendCode('driver@roadway.test');
  await window.sendCode('driver@roadway.test');     // what the Resend button calls
  assert.equal(calls.filter(c => c.url.includes('/otp/start')).length, 2);
  doc.getElementById('otp-change').click();
  assert.equal(hidden(doc, 'step-email'), false);
  assert.equal(doc.getElementById('otp-resend').disabled, false);
  await window.sendCode('dispatch@roadway.test');
  const last = calls.filter(c => c.url.includes('/otp/start')).pop();
  assert.equal(JSON.parse(last.init.body).email, 'dispatch@roadway.test');
  await window.verifyCode('111111');
  const check = calls.find(c => c.url.includes('/otp/check'));
  assert.equal(JSON.parse(check.init.body).email, 'dispatch@roadway.test');
});

test('a dead link answers with the link message, not a code prompt', async () => {
  const { window, doc } = makePage({ routes: { '/tms-public/otp/start': () => [403, { error: 'Invalid or expired link' }] } });
  window.boot();
  await window.sendCode('driver@roadway.test');
  assert.match(doc.getElementById('vstatus').textContent, /invalid or has expired/i);
  assert.equal(hidden(doc, 'step-code'), true);
});
