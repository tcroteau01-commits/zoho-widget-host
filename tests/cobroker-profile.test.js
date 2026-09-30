// tests/cobroker-profile.test.js
// COBROKERGATE1: the staff side of the co-broker agreement. The profile shows
// where the agreement stands and offers credit's actions; the host posts them.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const P = require('../customer-profile.js');

const BASE = {
  submission_id: '4455', customer_name: 'LANE FREIGHT', broker: 'Meridian Freight',
  status: 'Approved', contacts: {}, engine: null, identity: null, summary: null,
  fv_debtor: null, fv_candidates: [], priors: [], priors_unavailable: false, can_act: true,
  submitted: { customer_type: 'Shipper', documents: [
    { field: 'co_broker', idx: 0, label: 'Co-broker agreement', ext: 'pdf' },
    { field: 'supporting', idx: 1, label: 'Supporting document 2', ext: 'pdf' }] }
};
const withCb = (cb, extra) => Object.assign({}, BASE, { co_broker: cb }, extra || {});

test('a shipper with nothing tracked gets no section, only the switch', () => {
  const html = P.render(Object.assign({}, BASE, { customer_type: 'Shipper', co_broker: null }));
  assert.ok(!html.includes('Co-broker Agreement'));
  assert.ok(html.includes('data-cb-switch'));
});

test('a Freight Broker with nothing tracked shows the section and no switch', () => {
  const html = P.render(Object.assign({}, BASE, { customer_type: 'Freight Broker', co_broker: null }));
  assert.ok(html.includes('Co-broker Agreement'));
  assert.ok(html.includes('No agreement on record'));
  assert.ok(!html.includes('data-cb-switch'));
});

test('a submitted agreement offers approve per file, upload, and send back', () => {
  const html = P.render(withCb({ status: 'submitted', blocked: true,
                                 required_reason: 'submitted as Freight Broker' }));
  assert.ok(html.includes('Received, awaiting review'));
  assert.ok(html.includes('cannot be funded'));
  assert.ok(html.includes('data-cb-approve="co_broker:0"'));
  assert.ok(html.includes('data-cb-approve="supporting:1"'));
  assert.ok(html.includes('data-cb-upload'));
  assert.ok(html.includes('data-cb-reject'));
  // an agreement is tracked, so the switch is gone even though it says Shipper
  assert.ok(!html.includes('data-cb-switch'));
});

test('a rejected agreement shows the reason and cannot be rejected again', () => {
  const html = P.render(withCb({ status: 'rejected', blocked: true,
                                 reject_reason: 'unsigned copy' }));
  assert.ok(html.includes('unsigned copy'));
  assert.ok(html.includes('data-cb-upload'));
  assert.ok(!html.includes('data-cb-reject'));
});

test('an approved agreement is read-only and says who approved it', () => {
  const html = P.render(withCb({ status: 'approved', blocked: false, decided_by: 'pat@operfi.com',
                                 decided_at: '2026-09-29T15:00:00',
                                 approved_document: { label: 'Co-broker agreement' } }));
  assert.ok(html.includes('Approved'));
  assert.ok(html.includes('pat@operfi.com'));
  assert.ok(!html.includes('cannot be funded'));
  assert.ok(!/data-cb-(approve|upload|reject|switch)/.test(html));
});

test('the broker-supplied reason and labels are escaped', () => {
  const html = P.render(withCb({ status: 'rejected', blocked: true,
                                 reject_reason: '<img src=x onerror=alert(1)>' }));
  assert.ok(!html.includes('<img src=x'));
});

// --- the host posts each action to its route --------------------------------

const page = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8').replace(/\r\n/g, '\n');

function host(payload) {
  const dom = new JSDOM('<div id="ca-profile"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const calls = { fetch: [], toast: [], dropped: [], refetched: 0, bulk: 0 };
  w.OperFiCustomerProfile = { render: P.render, injectStyles: function () {} };
  w.BROKER_API_BASE = 'https://api.test';
  w.closeProfile = function () {};
  w.showToast = function (m) { calls.toast.push(m); };
  w.fetchProfile = function () { calls.refetched++; };
  w.fetchCoBrokerStatusBulk = function () { calls.bulk++; };
  w.dropCustomerEventKinds = function (id, kinds) { calls.dropped.push([id, kinds]); };
  w.esc = P.esc;
  w.confirm = function () { return true; };
  w.fetch = function (url, init) {
    calls.fetch.push({ url: url, init: init });
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true }); } });
  };
  w.eval(page.match(/var PROFILE_ACTIONS =[\s\S]*?\n}\n/)[0]);
  w.eval(page.match(/function renderProfile\(rec, payload\) \{[\s\S]*?\n}\n/)[0]);
  w.renderProfile({ ID: '4455' }, payload);
  return { w: w, calls: calls };
}
const flush = () => new Promise(function (r) { setTimeout(r, 0); });

test('approve posts the slot and refreshes the gray-out and the profile', async () => {
  const h = host(withCb({ status: 'submitted', blocked: true }));
  h.w.document.querySelector('[data-cb-approve="supporting:1"]').click();
  await flush();
  assert.strictEqual(h.calls.fetch.length, 1);
  assert.strictEqual(h.calls.fetch[0].url, 'https://api.test/customer-profile/4455/co-broker/approve');
  assert.deepStrictEqual(JSON.parse(h.calls.fetch[0].init.body), { field: 'supporting', idx: 1 });
  assert.strictEqual(h.calls.fetch[0].init.credentials, 'include');
  assert.strictEqual(JSON.stringify(h.calls.dropped), JSON.stringify([['4455', ['co_broker_agreement_submitted']]]));
  assert.strictEqual(h.calls.bulk, 1);
  assert.strictEqual(h.calls.refetched, 1);
});

test('send back without a reason does not post', async () => {
  const h = host(withCb({ status: 'submitted', blocked: true }));
  h.w.document.querySelector('[data-cb-reject]').click();
  await flush();
  assert.strictEqual(h.calls.fetch.length, 0);
  h.w.document.getElementById('cp-cb-reason').value = 'unsigned copy';
  h.w.document.querySelector('[data-cb-reject]').click();
  await flush();
  assert.strictEqual(h.calls.fetch[0].url, 'https://api.test/customer-profile/4455/co-broker/reject');
  assert.deepStrictEqual(JSON.parse(h.calls.fetch[0].init.body), { reason: 'unsigned copy' });
});

test('upload without a file does not post', async () => {
  const h = host(withCb({ status: 'required', blocked: true }));
  h.w.document.querySelector('[data-cb-upload]').click();
  await flush();
  assert.strictEqual(h.calls.fetch.length, 0);
  assert.ok(h.calls.toast[0].includes('Choose the signed agreement'));
});

test('switch to Freight Broker posts the switch route', async () => {
  const h = host(Object.assign({}, BASE, { customer_type: 'Shipper', co_broker: null }));
  h.w.document.querySelector('[data-cb-switch]').click();
  await flush();
  assert.strictEqual(h.calls.fetch[0].url,
                     'https://api.test/customer-profile/4455/co-broker/switch-to-broker');
});

test('a refused action keeps the profile and shows the server reason', async () => {
  const h = host(withCb({ status: 'submitted', blocked: true }));
  h.w.fetch = function () {
    return Promise.resolve({ ok: false, json: function () {
      return Promise.resolve({ error: 'This agreement is already approved' }); } });
  };
  h.w.document.querySelector('[data-cb-approve="co_broker:0"]').click();
  await flush();
  assert.strictEqual(h.calls.refetched, 0);
  assert.ok(h.calls.toast.includes('This agreement is already approved'));
});
