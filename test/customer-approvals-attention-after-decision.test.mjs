// Tom, 2026-09-29: after a decision the list dropped the row, but the open
// panel still showed "Mark reviewed" for an alert the server had already cleared.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function ev(id, kind, summary) {
  return { id: id, subject_id: '4455', account_id: 'a1', kind: kind, summary: summary,
           detail: {}, at: '2026-09-28T20:09:00+00:00' };
}

async function boot(rec, events) {
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  await wait(50);
  let eventsNow = events;
  w.fetch = function(url, opts) {
    const ok = function(body) { return Promise.resolve({ ok: true, status: 200,
      json: function() { return Promise.resolve(body); } }); };
    if (/\/customer-events\?/.test(url)) {
      return ok({ events: eventsNow, total: eventsNow.length ? 1 : 0,
                  counts: eventsNow.length ? { '4455': eventsNow.length } : {} });
    }
    if (/\/credit-app\/status-bulk/.test(url)) return ok({ applications: {} });
    if (/\/credit-boost\/decision/.test(url)) {
      eventsNow = eventsNow.filter(function(e) { return e.kind !== 'credit_boost_requested'; });
      return ok({ ok: true, outcome: 'decline', credit_limit: 5000, emailed: true });
    }
    if (/\/credit-decision/.test(url)) {
      eventsNow = eventsNow.filter(function(e) { return e.kind !== 'credit_check_submitted'; });
      return ok({ ok: true, decision: 'Approved' });
    }
    return Promise.resolve({ ok: false, status: 404, json: function() { return Promise.resolve({}); } });
  };
  w.brokerEmail = 'pat@operfi.com';
  w.allClients = true;
  w.onRecordsLoaded([rec, { ID: '9', Customer_Company_Name: 'OTHER CO', Credit_Decision: 'Approved' }]);
  await wait(30);
  const d = w.document;
  [...d.querySelectorAll('.row')].find(function(r) { return /GW COUNTRY/.test(r.textContent); }).click();
  await wait(10);
  return { w: w, d: d };
}

function attnVisible(d) {
  const s = d.getElementById('ca-attn-section');
  return !!s && s.style.display !== 'none';
}

test('declining a boost removes Mark reviewed from the open panel, which stays open', async () => {
  const { d } = await boot(
    { ID: '4455', Customer_Company_Name: 'GW COUNTRY INC.', Credit_Decision: 'Credit Boost Requested', Credit_Limit: '5000' },
    [ev('e1', 'credit_boost_requested', 'Credit boost requested: GW COUNTRY INC.')]);
  assert.ok(attnVisible(d), 'Needs Attention shows before the decision');
  d.getElementById('boost-reason').value = 'Limit stays.';
  d.getElementById('boost-decline').click();
  await wait(40);
  assert.ok(d.getElementById('panel').classList.contains('show'), 'the panel stays open on the decided customer');
  assert.match(d.getElementById('panel').textContent, /GW COUNTRY/);
  assert.ok(!attnVisible(d), 'no Mark reviewed for an alert the server cleared');
  assert.strictEqual(d.getElementById('attn-bell'), null, 'the bell goes quiet with nothing left');
});

test('a normal decision removes the new-check alert from the open panel', async () => {
  const { d } = await boot(
    { ID: '4455', Customer_Company_Name: 'GW COUNTRY INC.', Credit_Decision: 'Awaiting Credit Decision' },
    [ev('e1', 'credit_check_submitted', 'Credit check submitted: GW COUNTRY INC.')]);
  assert.ok(attnVisible(d));
  d.getElementById('dec-decision').value = 'Approved';
  d.getElementById('dec-limit').value = '5000';
  d.getElementById('dec-save').click();
  await wait(40);
  assert.ok(d.getElementById('panel').classList.contains('show'));
  assert.ok(!attnVisible(d));
});

test('a returned reference is NOT cleared by a decision and keeps Mark reviewed', async () => {
  const { d } = await boot(
    { ID: '4455', Customer_Company_Name: 'GW COUNTRY INC.', Credit_Decision: 'Awaiting Credit Decision' },
    [ev('e1', 'credit_check_submitted', 'Credit check submitted: GW COUNTRY INC.'),
     ev('e2', 'reference_completed', 'Trade reference 1 completed: GW COUNTRY INC.')]);
  d.getElementById('dec-decision').value = 'Approved';
  d.getElementById('dec-limit').value = '5000';
  d.getElementById('dec-save').click();
  await wait(40);
  assert.ok(attnVisible(d), 'the reference still needs its own review');
  const text = d.getElementById('ca-attn-section').textContent;
  assert.match(text, /Trade reference 1 completed/);
  assert.doesNotMatch(text, /Credit check submitted/);
  assert.ok(d.getElementById('ca-attn-clear'), 'Mark reviewed stays for what remains');
});
