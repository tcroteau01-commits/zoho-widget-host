// CREDITINT1: staff send a credit app for a carrier or general client from
// Customer Approvals, and can find internal and UW prospect checks in the list.
// Rows are tagged from GET /internal-credit/sources (a bare array of
// {submission_id, source, client_name}); nothing is inferred from a client name.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function reply(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status: status,
    json: function() { return Promise.resolve(body); },
    text: function() { return Promise.resolve(JSON.stringify(body)); } });
}

const SOURCES = [
  { submission_id: '101', source: 'internal_send', client_name: 'Swift <Haul>' },
  { submission_id: '102', source: 'uw_prospect', client_name: 'Prospect Brokerage' },
  { submission_id: '', source: 'uw_prospect', client_name: 'Stuck intake' }
];

const RECORDS = [
  { ID: '101', Customer_Company_Name: 'ALPHA FOODS', Credit_Decision: 'Awaiting Credit Decision' },
  { ID: '102', Customer_Company_Name: 'BETA STEEL', Credit_Decision: 'Awaiting Credit Decision' },
  { ID: '103', Customer_Company_Name: 'GAMMA PAPER', Credit_Decision: 'Awaiting Credit Decision' }
];

async function boot(routes) {
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  await wait(30);
  const calls = [];
  w.fetch = function(url, opts) {
    calls.push({ url: url, opts: opts || {} });
    for (const [re, fn] of routes || []) { if (re.test(url)) return fn(url, opts || {}); }
    if (/\/internal-credit\/sources$/.test(url)) return reply(200, SOURCES);
    return reply(404, {});
  };
  w.brokerEmail = 'staff@operfi.com';
  return { w, d: w.document, calls };
}

// ── loading the internal list ───────────────────────────────────────────────

test('a broker viewer never calls the internal list and never sees the button', async () => {
  const { w, d, calls } = await boot();
  w.allClients = false;
  w.fetchInternalCreditSources();
  await wait(20);
  assert.ok(!calls.some((c) => /internal-credit/.test(c.url)));
  assert.strictEqual(d.getElementById('btn-internal-new').style.display, 'none');
});

test('staff load the lean sources read with the session, and the button shows', async () => {
  const { w, d, calls } = await boot();
  w.allClients = true;
  w.fetchInternalCreditSources();
  await wait(20);
  const c = calls.find((x) => /\/internal-credit\/sources$/.test(x.url));
  assert.ok(c);
  assert.strictEqual(c.opts.credentials, 'include');
  assert.ok(!calls.some((x) => /\/internal-credit\/list/.test(x.url)),
    'the heavy list must not be read on page load');
  assert.strictEqual(d.getElementById('btn-internal-new').style.display, '');
  assert.strictEqual(d.getElementById('source-select').style.display, '');
  assert.strictEqual(w.internalCreditSourceOf({ ID: '101' }), 'internal_send');
  assert.strictEqual(w.internalCreditSourceOf({ ID: '102' }), 'uw_prospect');
  assert.strictEqual(w.internalCreditSourceOf({ ID: '103' }), '');
});

test('a non-array reply is ignored', async () => {
  const { w, d } = await boot([[/\/internal-credit\/sources$/, () => reply(200, { requests: [] })]]);
  w.allClients = true;
  w.fetchInternalCreditSources();
  await wait(20);
  assert.strictEqual(d.getElementById('btn-internal-new').style.display, 'none');
});

test('the feature dark (404) leaves the page as it was', async () => {
  const { w, d } = await boot([[/\/internal-credit\/sources$/, () => reply(404, { error: 'Not found' })]]);
  w.allClients = true;
  w.fetchInternalCreditSources();
  await wait(20);
  assert.strictEqual(d.getElementById('btn-internal-new').style.display, 'none');
  assert.strictEqual(d.getElementById('source-select').style.display, 'none');
  assert.strictEqual(w.internalCreditSourceOf({ ID: '101' }), '');
});

test('a 403 (not staff) leaves the page as it was', async () => {
  const { w, d } = await boot([[/\/internal-credit\/sources$/, () => reply(403, { error: 'Forbidden' })]]);
  w.allClients = true;
  w.fetchInternalCreditSources();
  await wait(20);
  assert.strictEqual(d.getElementById('btn-internal-new').style.display, 'none');
});

// ── badge and filter ────────────────────────────────────────────────────────

test('the badge names the source and the real client, escaped', async () => {
  const { w } = await boot();
  w.allClients = true;
  w.fetchInternalCreditSources();
  await wait(20);
  const h = w.internalSourceBadgeHtml({ ID: '101' });
  assert.ok(h.includes('Internal'));
  assert.ok(h.includes('Swift &lt;Haul&gt;'));
  assert.ok(!h.includes('<Haul>'));
  assert.ok(w.internalSourceBadgeHtml({ ID: '102' }).includes('UW prospect'));
  assert.strictEqual(w.internalSourceBadgeHtml({ ID: '103' }), '');
});

test('the source filter narrows the list to internal or UW prospect checks', async () => {
  const { w, d } = await boot();
  w.allClients = true;
  w.onRecordsLoaded(RECORDS.slice());
  w.allClients = true;   // onRecordsLoaded does not touch it; set for the gated fetch
  w.fetchInternalCreditSources();
  await wait(30);
  const sel = d.getElementById('source-select');
  assert.strictEqual(sel.style.display, '');
  const rows = () => Array.from(d.querySelectorAll('#results .row .cell-val.lg')).map((e) => e.textContent);
  sel.value = 'internal_send'; sel.dispatchEvent(new w.Event('change'));
  assert.deepStrictEqual(rows(), ['ALPHA FOODS']);
  sel.value = 'uw_prospect'; sel.dispatchEvent(new w.Event('change'));
  assert.deepStrictEqual(rows(), ['BETA STEEL']);
  sel.value = 'any_internal'; sel.dispatchEvent(new w.Event('change'));
  assert.deepStrictEqual(rows().sort(), ['ALPHA FOODS', 'BETA STEEL']);
  sel.value = 'all'; sel.dispatchEvent(new w.Event('change'));
  assert.strictEqual(rows().length, 3);
});

// ── New internal credit app ─────────────────────────────────────────────────

function fill(d, over) {
  const v = Object.assign({ 'ci-client-name': 'Swift Haul', 'ci-client-kind': 'carrier',
    'ci-client-cc': 'ap@swifthaul.com', 'ci-company': 'ALPHA FOODS', 'ci-contact': 'Dana Reed',
    'ci-email': 'dana@alpha.com', 'ci-phone': '602-555-0100', 'ci-line1': '1 Main St',
    'ci-city': 'Phoenix', 'ci-state': 'AZ', 'ci-zip': '85001', 'ci-website': 'alpha.com' }, over || {});
  Object.keys(v).forEach((id) => { d.getElementById(id).value = v[id]; });
}

test('the client type offers Carrier and General only, never Broker', () => {
  const dom = new JSDOM(html);
  const opts = Array.from(dom.window.document.querySelectorAll('#ci-client-kind option'))
    .map((o) => o.value).filter(Boolean);
  assert.deepStrictEqual(opts, ['carrier', 'general']);
});

test('send posts the exact body /internal-credit/send accepts, with the session', async () => {
  const { w, d, calls } = await boot([[/\/internal-credit\/send$/, () =>
    reply(200, { ok: true, request_id: 'm9', submission_id: '555', application_id: 'a9' })]]);
  w.allClients = true;
  w.openInternalCreditForm();
  fill(d);
  d.getElementById('ci-submit').click();
  await wait(30);
  const c = calls.find((x) => /\/internal-credit\/send$/.test(x.url));
  assert.ok(c);
  assert.strictEqual(c.opts.method, 'POST');
  assert.strictEqual(c.opts.credentials, 'include');
  assert.deepStrictEqual(JSON.parse(c.opts.body), {
    client: { name: 'Swift Haul', kind: 'carrier', cc_email: 'ap@swifthaul.com' },
    customer: { company: 'ALPHA FOODS', contact_name: 'Dana Reed', email: 'dana@alpha.com',
                phone: '602-555-0100', website: 'alpha.com',
                address: { line1: '1 Main St', city: 'Phoenix', state: 'AZ', zip: '85001' } }
  });
  const msg = d.getElementById('ci-msg').textContent;
  assert.ok(msg.includes('dana@alpha.com'), msg);
});

test('a missing required field is refused before any call', async () => {
  const { w, d, calls } = await boot();
  w.allClients = true;
  w.openInternalCreditForm();
  fill(d, { 'ci-email': '' });
  d.getElementById('ci-submit').click();
  await wait(20);
  assert.ok(!calls.some((x) => /\/internal-credit\/send$/.test(x.url)));
  assert.ok(/email/i.test(d.getElementById('ci-msg').textContent));
});

test('a failure names the step that failed and the server reason', async () => {
  const { w, d } = await boot([[/\/internal-credit\/send$/, () =>
    reply(502, { error: 'Mail relay refused', step: 'send_app', submission_id: '555' })]]);
  w.allClients = true;
  w.openInternalCreditForm();
  fill(d);
  d.getElementById('ci-submit').click();
  await wait(30);
  const msg = d.getElementById('ci-msg').textContent;
  assert.ok(/Sending the application/.test(msg), msg);
  assert.ok(msg.includes('Mail relay refused'));
  assert.ok(/Do not resubmit/.test(msg), 'a check that exists must not be created twice');
});

test('a precheck refusal says no check was created', async () => {
  const { w, d } = await boot([[/\/internal-credit\/send$/, () =>
    reply(409, { error: 'Credit applications are off. No credit check was created.', step: 'precheck' })]]);
  w.allClients = true;
  w.openInternalCreditForm();
  fill(d);
  d.getElementById('ci-submit').click();
  await wait(30);
  const msg = d.getElementById('ci-msg').textContent;
  assert.ok(msg.includes('No credit check was created'));
  assert.ok(!/Do not resubmit/.test(msg));
});

test('server text in the result is set as text, not markup', async () => {
  const { w, d } = await boot([[/\/internal-credit\/send$/, () =>
    reply(502, { error: '<img src=x onerror="window.__z=1">', step: 'create_check' })]]);
  w.allClients = true;
  w.openInternalCreditForm();
  fill(d);
  d.getElementById('ci-submit').click();
  await wait(30);
  assert.strictEqual(d.querySelector('#ci-msg img'), null);
  assert.strictEqual(w.__z, undefined);
});

test('no em or en dashes in the new copy', () => {
  const start = html.indexOf('id="ci-modal"');
  const block = html.slice(start, html.indexOf('</aside>', start) > 0 ? html.indexOf('</aside>', start) : start + 4000);
  assert.ok(!/[–—]/.test(block));
});
