import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWidget } from './noa-management.test.mjs';

// LORFACTOR1 (Tom, 2026-11-10): JEN LOGISTICS INC had no factor on its Vendor
// record (Quick Pay, Chase on file). The broker sent an LOR from Turas Global
// and Creator refused it: 3001 "Factoring Company is required." LOR Update had
// no factor dropdown, so the broker could never get past it.

const FACTORS = { companies: [
  { id: 'f1', name: 'OTR Solutions', factor_status: 'Approved' },
  { id: 'f2', name: 'We Win Capital LLC', factor_status: 'Denied' },
  { id: 'f3', name: 'Turas Global Transfer Group', factor_status: 'Pending' },
] };

const FACTORED = { vendor_id: '1001', carrier_name: 'ROADWAY EXPRESS',
  factoring_company: 'OTR Solutions', pay_term: 'Factoring Company' };
const UNFACTORED = { vendor_id: '1003', carrier_name: 'JEN LOGISTICS INC',
  factoring_company: '', pay_term: 'Quick Pay', bank_name: 'JPMORGAN CHASE BANK, NA' };

async function ready() {
  const w = makeWidget();
  w.window.brokerEmail = 'b@op.com';
  w.window.fetch = () => Promise.resolve({ json: () => Promise.resolve(FACTORS) });
  await w.window.loadFactoringCompanies();
  return w;
}

const shown = (window, id) => !window.document.getElementById(id).classList.contains('hidden');

test('LOR Update on a carrier with no factor on file asks which factor is releasing it', async () => {
  const { window } = await ready();
  window.selectType('LOR Update');
  window.selectedVendorId = '1003';
  window.showOnFile(UNFACTORED);
  assert.ok(shown(window, 'lor-factor'), 'the release-factor picker must show');
});

test('LOR Update on a carrier whose factor is on file does not ask', async () => {
  const { window } = await ready();
  window.selectType('LOR Update');
  window.selectedVendorId = '1001';
  window.showOnFile(FACTORED);
  assert.ok(!shown(window, 'lor-factor'));
});

test('the release-factor picker never shows outside LOR Update', async () => {
  const { window } = await ready();
  window.selectedVendorId = '1003';
  window.showOnFile(UNFACTORED);
  ['NOA Update', 'Factoring Company Change'].forEach((t) => {
    window.selectType(t);
    assert.ok(!shown(window, 'lor-factor'), t);
  });
});

test('the release-factor picker lists Pending factors but never Denied ones', async () => {
  const { window } = await ready();
  const vals = Array.from(window.document.querySelectorAll('#lor-factor-select option')).map((o) => o.value);
  assert.ok(vals.includes('f1'));
  assert.ok(vals.includes('f3'), 'a Pending factor can still release a carrier');
  assert.ok(!vals.includes('f2'), 'Denied is refused server-side, so it is not offered');
});

test('the picked release factor is sent as Factoring_Company', async () => {
  const { window } = await ready();
  window.selectType('LOR Update');
  window.selectedVendorId = '1003';
  window.showOnFile(UNFACTORED);
  const sel = window.document.getElementById('lor-factor-select');
  sel.value = 'f3';
  sel.onchange();
  window.lorBankChoice = 'no';
  assert.equal(window.buildNoaPayload().Factoring_Company, 'f3');
});

test("a carrier with no factor never inherits the previous carrier's factor", async () => {
  const { window } = await ready();
  window.selectType('LOR Update');
  window.selectedVendorId = '1001';
  window.showOnFile(FACTORED);
  window.selectedVendorId = '1003';
  window.showOnFile(UNFACTORED);
  window.lorBankChoice = 'no';
  const d = window.buildNoaPayload();
  assert.equal(d.Factoring_Company, undefined, 'must not send OTR Solutions for JEN');
  assert.equal(d.Carrier_Payment_Terms, 'Quick Pay');
});

test('LOR Update with no factor stops before Creator and says what is missing', async () => {
  const { window, addCalls } = await ready();
  window.selectType('LOR Update');
  window.selectedVendorId = '1003';
  window.showOnFile(UNFACTORED);
  window.lorBankChoice = 'no';
  window.selectedDocFile = new window.File(['x'], 'lor.pdf', { type: 'application/pdf' });
  await window.submitNoa();
  assert.equal(addCalls.length, 0);
  assert.match(window.document.getElementById('noa-submit-feedback').textContent, /factoring company/i);
});

test('a Creator validation refusal reads as a sentence, not raw JSON', async () => {
  const { window } = await ready();
  window.ZOHO.CREATOR.DATA.addRecords = () => Promise.resolve({ code: 3000, result: [{ code: 3001,
    error: [{ alert_message: ['Factoring Company is required.'], task: 'alert' },
            { message: 'Failed to add data.', task: 'cancel_submit' }] }] });
  window.selectType('NOA Update');
  window.selectedVendorId = '1001';
  window.selectedDocFile = new window.File(['x'], 'noa.pdf', { type: 'application/pdf' });
  await window.submitNoa();
  const fb = window.document.getElementById('noa-submit-feedback').textContent;
  assert.match(fb, /Factoring Company is required\./);
  assert.doesNotMatch(fb, /raw|alert_message|cancel_submit|\{/);
});

test('the submit button and upload text name the LOR on an LOR Update', async () => {
  const { window } = await ready();
  window.selectType('LOR Update');
  assert.match(window.document.getElementById('noa-submit-btn').textContent, /Submit LOR Update/);
  assert.doesNotMatch(window.document.getElementById('sec-upload-sub').textContent, /Notice of Assignment/);
  window.selectType('NOA Update');
  assert.match(window.document.getElementById('noa-submit-btn').textContent, /Submit NOA Update/);
});
