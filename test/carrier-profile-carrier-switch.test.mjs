import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('carrier-profile.html'), 'utf8');

const CARRIERS = [
  { vendor_id: '1', carrier_name: 'Acme Trucking', mc: '111111', dot: '2222222', dnu: false, hiring_decision: 'Approve' },
  { vendor_id: '2', carrier_name: 'Blocked Freight', mc: '333333', dot: '4444444', dnu: true, hiring_decision: 'Decline' },
  { vendor_id: '3', carrier_name: 'Caution Carriers', mc: '555555', dot: '6666666', dnu: false, hiring_decision: 'Approve with Caution' },
];

function boot(fetchImpl) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.fetch = fetchImpl;
  return dom;
}

function makeFetch(calls) {
  return async (url) => {
    calls.push(String(url));
    if (String(url).indexOf('/tms-carriers') !== -1) {
      return { ok: true, json: async () => ({ carriers: CARRIERS, gate_enabled: true }) };
    }
    return { ok: true, json: async () => ({
      vendor: {}, carrierok: {}, ipqs: {}, bank: {},
      account_vendor: { av_id: 'av_1' }, risk_decisions: [], comments: [], system_recommendation: 'Approve',
    }) };
  };
}

test('loadCarrierSwitchList fetches /tms-carriers exactly once and populates _cpCarriers', async () => {
  const calls = [];
  const dom = boot(makeFetch(calls));
  const w = dom.window;
  w.brokerEmail = 'broker@op.com';
  await w.loadCarrierSwitchList();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/tms-carriers\?email=broker%40op\.com/);
  assert.equal(w._cpCarriers.length, 3);
});

test('cpCarrierStatusSuffix flags DNU and non-approved carriers, leaves approved carriers unlabeled', () => {
  const dom = boot(makeFetch([]));
  const w = dom.window;
  assert.equal(w.cpCarrierStatusSuffix({ dnu: true, hiring_decision: 'Decline' }), ' · DNU');
  assert.equal(w.cpCarrierStatusSuffix({ dnu: false, hiring_decision: 'Approve with Caution' }), '');
  assert.equal(w.cpCarrierStatusSuffix({ dnu: false, hiring_decision: 'Hold' }), ' · Hold');
  assert.equal(w.cpCarrierStatusSuffix({ dnu: false, hiring_decision: 'Approve' }), '');
  assert.equal(w.cpCarrierStatusSuffix({ dnu: false, hiring_decision: '' }), ' · Not Reviewed');
});

test('cpFilterCarriers matches by name, MC, or DOT case-insensitively and returns everything for an empty query', () => {
  const dom = boot(makeFetch([]));
  const w = dom.window;
  w._cpCarriers = CARRIERS;
  assert.equal(w.cpFilterCarriers('blocked').length, 1);
  assert.equal(w.cpFilterCarriers('blocked')[0].vendor_id, '2');
  assert.equal(w.cpFilterCarriers('333333').length, 1);
  assert.equal(w.cpFilterCarriers('6666666').length, 1);
  assert.equal(w.cpFilterCarriers('').length, 3);
  assert.equal(w.cpFilterCarriers('nonexistent-carrier').length, 0);
});

test('typing in the switcher input filters client-side without any additional /tms-carriers fetch', async () => {
  const calls = [];
  const dom = boot(makeFetch(calls));
  const w = dom.window;
  w.brokerEmail = 'broker@op.com';
  await w.loadCarrierSwitchList();
  w.wireCarrierSwitch();
  const input = w.document.getElementById('cp-switch-input');
  input.value = 'Acme';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  const box = w.document.getElementById('cp-switch-results');
  assert.equal(box.querySelectorAll('.cp-switch-item').length, 1);
  assert.match(box.textContent, /Acme Trucking/);
  assert.equal(calls.length, 1, 'filtering must not trigger another network fetch');
});

test('focusing the empty switcher input shows every linked carrier, DNU included', async () => {
  const calls = [];
  const dom = boot(makeFetch(calls));
  const w = dom.window;
  w.brokerEmail = 'broker@op.com';
  await w.loadCarrierSwitchList();
  w.wireCarrierSwitch();
  const input = w.document.getElementById('cp-switch-input');
  input.dispatchEvent(new w.Event('focus', { bubbles: true }));
  const box = w.document.getElementById('cp-switch-results');
  assert.equal(box.querySelectorAll('.cp-switch-item').length, 3);
});

test('a DNU carrier renders labeled and fully clickable in the switcher results (no blocking)', async () => {
  const calls = [];
  const dom = boot(makeFetch(calls));
  const w = dom.window;
  w.brokerEmail = 'broker@op.com';
  await w.loadCarrierSwitchList();
  w.cpRenderSwitch(w.cpFilterCarriers('Blocked'));
  const row = w.document.querySelector('.cp-switch-item');
  assert.ok(row, 'expected a result row for the DNU carrier');
  assert.match(row.querySelector('.nm').textContent, /Blocked Freight/);
  assert.match(row.querySelector('.nm').textContent, /DNU/);
  assert.equal(row.className, 'cp-switch-item', 'DNU rows must not carry any disabled/blocked class');
  row.dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.equal(w.vendorId, '2');
});
