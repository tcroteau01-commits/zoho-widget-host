import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWidget } from './noa-management.test.mjs';

// NOA Management had NO demo awareness while seven other widgets did, so on the
// demo account it talked to the LIVE stack: it created a real NOA_LOR_Updates
// record and uploaded a real file into live Creator, then /noa-submit rejected
// it with "Missing Submission_Type, DOT, or FV_Client_ID" -- the OperFi Demo
// account is the only ACTIVE account with a blank FVClientID (286 checked,
// 2026-09-08). That check is also the ONLY thing keeping demo fixtures out of
// the real CRM, so the fix is to never make the calls, not to give demo an id.

function demoWidget(t) {
  const { window } = makeWidget();
  window.OPERFI_DEMO = { isDemo: () => true, ready: () => Promise.resolve() };
  window.brokerEmail = 'demo@operfidemo.com';
  window.statusPayload = { carriers: [] };
  window.selectedType = 'NOA Update';
  window.selectedVendorId = '9001';
  window.selectedCarrierName = 'REDWOOD LOGISTICS';
  window.selectedFactoringId = 'f1';
  window.selectedDocFile = new window.File(['x'], 'noa.pdf', { type: 'application/pdf' });
  return window;
}

test('a demo submit makes NO Creator write and NO API calls', async () => {
  const window = demoWidget();
  let added = 0;
  const fetched = [];
  window.ZOHO.CREATOR.DATA.addRecords = function () { added++; return Promise.resolve({ code: 3000, data: { ID: 'x' } }); };
  window.fetch = (u) => { fetched.push(String(u)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }); };
  await window.submitNoa();
  assert.equal(added, 0, 'demo must not create a Creator record');
  assert.equal(fetched.filter((u) => /\/upload-doc|\/noa-submit/.test(u)).length, 0,
    'demo must not call upload-doc or noa-submit: ' + fetched.join(', '));
});

test('a demo submit shows the confirmation (track) view, not an error', async () => {
  const window = demoWidget();
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  await window.submitNoa();
  assert.equal(window.document.getElementById('view-track').classList.contains('hidden'), false,
    'the confirmation view must be showing');
  const fb = window.document.getElementById('noa-submit-feedback').textContent;
  assert.equal(fb, '', 'no error text on a demo submit, got: ' + fb);
});

test('a demo submit appears in the tracking list, and survives a status re-fetch', async () => {
  const window = demoWidget();
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ carriers: [], total_carriers: 0 }) });
  await window.submitNoa();
  // showList() re-fetches /noa-status; the demo row must not be wiped by that.
  await window.loadStatus();
  const rows = window.document.querySelectorAll('#view-list .tbl tbody tr');
  assert.equal(rows.length, 1, 'the demo submission must render as a row');
  assert.match(rows[0].textContent, /REDWOOD LOGISTICS/);
  assert.match(rows[0].textContent, /NOA Update/);
});

test('demo still enforces the required document before it pretends to submit', async () => {
  const window = demoWidget();
  window.selectedDocFile = null;
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  await window.submitNoa();
  const fb = window.document.getElementById('noa-submit-feedback').textContent;
  assert.match(fb, /attach the NOA/i, 'validation must run in demo too, got: ' + fb);
  assert.equal(window.document.getElementById('view-track').classList.contains('hidden'), true,
    'must not confirm a submission that failed validation');
});

test('a real (non-demo) account is untouched by the demo branch', async () => {
  const window = demoWidget();
  window.OPERFI_DEMO = { isDemo: () => false, ready: () => Promise.resolve() };
  let added = 0;
  const fetched = [];
  window.ZOHO.CREATOR.DATA.addRecords = function () { added++; return Promise.resolve({ code: 3000, data: { ID: 'rec_1' } }); };
  window.fetch = (u) => { fetched.push(String(u)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }); };
  await window.submitNoa();
  assert.equal(added, 1, 'a live account must still write to Creator');
  assert.ok(fetched.some((u) => /\/noa-submit/.test(u)), 'a live account must still run the engine');
});

test('no OPERFI_DEMO on the page at all behaves as a live account', async () => {
  const window = demoWidget();
  delete window.OPERFI_DEMO;
  let added = 0;
  window.ZOHO.CREATOR.DATA.addRecords = function () { added++; return Promise.resolve({ code: 3000, data: { ID: 'rec_1' } }); };
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  await window.submitNoa();
  assert.equal(added, 1, 'a missing demo shim must never suppress a real submission');
});
