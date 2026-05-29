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
      window.fetch = () => new Promise(() => {});
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
