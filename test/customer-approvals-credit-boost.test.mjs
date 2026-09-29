// Credit boost decisions. Tom, 2026-09-29: "We want to keep them at $5K but deny
// the credit boost." Both actions leave the customer Approved; the panel must
// never offer "decline" as a way to Deny the customer.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function bootWith(records, boostReply) {
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  await wait(50);
  const posts = [];
  w.fetch = function(url, opts) {
    if (/\/credit-boost\/decision/.test(url)) {
      posts.push({ url: url, opts: opts, body: JSON.parse(opts.body) });
      return Promise.resolve(boostReply || { ok: true, status: 200, json: function() {
        return Promise.resolve({ ok: true, outcome: posts[posts.length - 1].body.outcome,
          credit_limit: posts[posts.length - 1].body.outcome === 'approve' ? 15000 : 5000,
          emailed: true }); } });
    }
    if (/\/credit-app\/status-bulk/.test(url)) {
      return Promise.resolve({ ok: true, json: function() { return Promise.resolve({ applications: {} }); } });
    }
    return Promise.resolve({ ok: false, status: 404, json: function() { return Promise.resolve({}); } });
  };
  w.brokerEmail = 'pat@operfi.com';
  w.allClients = true;
  w.onRecordsLoaded(records);
  await wait(20);
  return { w: w, d: w.document, posts: posts };
}

function rec(over) {
  return Object.assign({ ID: '4455', Customer_Company_Name: 'SHAKY FREIGHT CO',
    Credit_Decision: 'Credit Boost Requested', Credit_Limit: '5000.00' }, over || {});
}

function open(d) { d.querySelector('.row').click(); }

test('a customer in Credit Boost Requested gets the two boost actions', async () => {
  const { d } = await bootWith([rec()]);
  open(d);
  assert.ok(d.getElementById('boost-section'), 'boost section renders');
  assert.ok(d.getElementById('boost-approve'));
  assert.ok(d.getElementById('boost-decline'));
  assert.match(d.getElementById('boost-section').textContent, /\$5,000/);
  assert.ok(d.getElementById('dec-decision'), 'the normal decision form is still there');
});

test('any other status gets no boost section', async () => {
  const { d } = await bootWith([rec({ Credit_Decision: 'Approved' })]);
  open(d);
  assert.strictEqual(d.getElementById('boost-section'), null);
});

test('decline without a note is stopped before any request', async () => {
  const { d, posts } = await bootWith([rec()]);
  open(d);
  d.getElementById('boost-decline').click();
  await wait(10);
  assert.strictEqual(posts.length, 0);
  assert.match(d.getElementById('boost-msg').textContent, /note/i);
});

test('decline posts the reason and leaves the customer Approved at $5,000', async () => {
  const { d, posts } = await bootWith([rec()]);
  open(d);
  d.getElementById('boost-reason').value = 'Recent slow pays.';
  d.getElementById('boost-decline').click();
  await wait(30);
  assert.strictEqual(posts.length, 1);
  assert.deepStrictEqual(
    { submission_id: posts[0].body.submission_id, outcome: posts[0].body.outcome,
      reason: posts[0].body.reason },
    { submission_id: '4455', outcome: 'decline', reason: 'Recent slow pays.' });
  assert.strictEqual(posts[0].opts.credentials, 'include', 'identity rides the session cookie');
  const row = d.querySelector('.row').textContent;
  assert.match(row, /Approved/i);
  assert.doesNotMatch(row, /Denied/i);
});

test('approve must be higher than the current limit', async () => {
  const { d, posts } = await bootWith([rec()]);
  open(d);
  d.getElementById('boost-limit').value = '5000';
  d.getElementById('boost-approve').click();
  await wait(10);
  assert.strictEqual(posts.length, 0);
  assert.match(d.getElementById('boost-msg').textContent, /higher than/);
});

test('approve posts the new limit', async () => {
  const { d, posts } = await bootWith([rec()]);
  open(d);
  d.getElementById('boost-limit').value = '15000';
  d.getElementById('boost-approve').click();
  await wait(30);
  assert.strictEqual(posts[0].body.outcome, 'approve');
  assert.strictEqual(posts[0].body.credit_limit, '15000');
});

test('a refusal shows the reason and changes nothing', async () => {
  const { d } = await bootWith([rec()], { ok: false, status: 422, json: function() {
    return Promise.resolve({ error: 'The boost decision was not saved',
                             detail: 'Enter a value for Billing POC' }); } });
  open(d);
  d.getElementById('boost-reason').value = 'x';
  d.getElementById('boost-decline').click();
  await wait(30);
  assert.match(d.getElementById('boost-msg').textContent, /Billing POC/);
  assert.ok(d.getElementById('boost-section'), 'still in boost status');
});
