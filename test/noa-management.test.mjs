import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../noa-management.html', import.meta.url), 'utf8');

const STATUS = { allow_add_carrier: false, carriers: [
  { vendor_id: '1001', carrier_name: 'ROADWAY EXPRESS', mc: '89765', dot: '897123',
    factoring_company: 'Triumph', pay_term: 'Factoring Company',
    doc_on_file: { record_id: 'n1', type: 'NOA Update', has_doc: true }, status: 'verified' },
  { vendor_id: '1002', carrier_name: 'MIDWEST HAUL', mc: '774120', dot: '2891044',
    factoring_company: '', pay_term: 'Factoring Company',
    doc_on_file: null, status: 'noa_needed' },
]};

export function makeWidget() {
  const addCalls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/noa-management.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: {
        UTIL: { getInitParams: () => new Promise(() => {}) },
        DATA: { addRecords: (a) => { addCalls.push(a); return Promise.resolve({ code: 3000, result: [{ ID: 'rec_1' }] }); } },
      }};
      window.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
    }
  });
  return { window: dom.window, addCalls };
}

test('renderStatusList renders a row per carrier with status chip and doc link', () => {
  const { window } = makeWidget();
  window.renderStatusList(STATUS);
  const rows = window.document.querySelectorAll('#view-list .tbl tbody tr');
  assert.equal(rows.length, 2);
  assert.match(rows[1].textContent, /MIDWEST HAUL/);
  assert.ok(rows[1].querySelector('.chip.alert'));        // noa_needed -> alert chip
  assert.ok(rows[0].querySelector('.doc-link'));          // verified row has a doc link
});

test('_acquireNoaTarget recovers vendorId from sessionStorage on reload', () => {
  const { window } = makeWidget();
  window.localStorage.clear();
  window.sessionStorage.setItem('noaManagementVendorId', 'v_77');
  const t = window._acquireNoaTarget();
  assert.equal(t.vendorId, 'v_77');
});

test('gated Add New Carrier card is hidden unless allow_add_carrier', () => {
  const { window } = makeWidget();
  window.applyGating(STATUS);                       // allow_add_carrier:false
  const gated = window.document.querySelector('.type-card.gated-card');
  assert.equal(gated.classList.contains('hidden'), true);
  window.applyGating(Object.assign({}, STATUS, { allow_add_carrier: true }));
  assert.equal(gated.classList.contains('hidden'), false);
});

test('showOnFile renders the currently-on-file guard from the carrier', () => {
  const { window } = makeWidget();
  window.statusPayload = STATUS;
  window.showOnFile(STATUS.carriers[0]);
  const onfile = window.document.querySelector('.onfile');
  assert.match(onfile.textContent, /Triumph/);
  assert.match(onfile.textContent, /Factoring Company/);
});

test('selectType LOR shows bank fields; NOA hides them', () => {
  const { window } = makeWidget();
  window.selectType('LOR Update');
  assert.equal(window.document.getElementById('noa-bank-fields').classList.contains('hidden'), false);
  window.selectType('NOA Update');
  assert.equal(window.document.getElementById('noa-bank-fields').classList.contains('hidden'), true);
});

test('openSubmitFor switches to the form view, sets the vendor, and shows on-file', () => {
  const { window } = makeWidget();
  window.statusPayload = STATUS;
  window.openSubmitFor('1001');
  assert.equal(window.selectedVendorId, '1001');
  assert.equal(window.document.getElementById('view-form').classList.contains('hidden'), false);
  assert.match(window.document.querySelector('.onfile').textContent, /Triumph/);
});

test('submitNoa builds the ADD payload without private fields', async () => {
  const { window, addCalls } = makeWidget();
  window.statusPayload = STATUS;
  window.selectedType = 'NOA Update';
  window.selectedVendorId = '1001';
  window.selectedFactoringId = 'fc_9';
  await window.submitNoa();
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0].form_name, 'NOA_LOR_Updates');
  const d = addCalls[0].payload.data;
  assert.equal(d.Submission_Type, 'NOA Update');
  assert.equal(d.Carrier_Name_MC_or_DOT, '1001');
  assert.equal(d.Factoring_Company, 'fc_9');
  assert.ok(!('FV_Client_ID' in d));   // private, derived server-side
  assert.ok(!('DOT' in d));            // private, derived server-side
});

test('runEngine posts the new record id to /noa-submit', async () => {
  const { window } = makeWidget();
  const calls = [];
  window.fetch = (u, opts) => { calls.push([u, opts]); return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); };
  window.brokerEmail = 'broker@op.com';
  await window.runEngine('rec_42');
  assert.match(calls[0][0], /\/noa-submit/);
  const sent = JSON.parse(calls[0][1].body);
  assert.equal(sent.record_id, 'rec_42');
  assert.equal(sent.email, 'broker@op.com');
});

test('runEngine no-ops without a recordId', async () => {
  const { window } = makeWidget();
  let called = false;
  window.fetch = () => { called = true; return Promise.resolve({ json: () => Promise.resolve({}) }); };
  await window.runEngine('');
  assert.equal(called, false);
});
