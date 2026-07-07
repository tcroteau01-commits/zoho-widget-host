import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWidget } from './noa-management.test.mjs';

// Bug A: Creator returns single-record adds as {code:3000, data:{ID}}, not
// {result:[{ID}]}. The widget read res.result[0].ID, got undefined, and showed
// "Submission failed: Data Added Successfully" while skipping the doc upload and
// the /noa-submit engine — orphaning the record.
test('submitNoa treats {code:3000,data:{ID}} as success and runs the engine', async () => {
  const { window } = makeWidget();
  const calls = [];
  window.ZOHO.CREATOR.DATA.addRecords = function () {
    return Promise.resolve({ code: 3000, data: { ID: 'rec_77' }, message: 'Data Added Successfully' });
  };
  window.fetch = (u, opts) => { calls.push([String(u), opts]); return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); };
  window.brokerEmail = 'b@op.com';
  window.statusPayload = { carriers: [] };
  window.selectedType = 'NOA Update';
  window.selectedVendorId = '1001';
  window.selectedDocFile = new window.File(['x'], 'noa.pdf', { type: 'application/pdf' });
  await window.submitNoa();
  const fb = window.document.getElementById('noa-submit-feedback').textContent;
  assert.ok(!/failed/i.test(fb), 'must not report failure on a 3000 success: ' + fb);
  const eng = calls.find((c) => /\/noa-submit/.test(c[0]));
  assert.ok(eng, 'the /noa-submit engine must run on success');
  assert.equal(JSON.parse(eng[1].body).record_id, 'rec_77', 'engine must get the real record id from res.data.ID');
});

// Bug B: the NOA_LOR_Updates form's on-validate requires Carrier_Payment_Terms.
// In the UI an on-user-input populates it when the carrier is picked, but widget
// addRecords doesn't fire on-user-input, so the LOR submit was rejected with
// code 3001 "Carrier Payment Terms are required." The widget already shows the
// carrier's current pay term, so it must send it.
test('LOR Update payload includes Carrier_Payment_Terms (the form-required pay term)', () => {
  const { window } = makeWidget();
  window.selectedType = 'LOR Update';
  window.selectedVendorId = '1001';
  window.selectedPayTerm = 'Factoring Company';
  window.lorBankChoice = 'no';
  const d = window.buildNoaPayload();
  assert.equal(d.Carrier_Payment_Terms, 'Factoring Company');
});

// Bug C: the form's on-validate also requires Factoring_Company for LOR Update
// (recording which factor the carrier is being released from), but LOR Update
// has no dropdown for it — so it must be sent from the captured on-file value.
test('LOR Update payload includes Factoring_Company (the form-required current factor)', () => {
  const { window } = makeWidget();
  window.selectedType = 'LOR Update';
  window.selectedVendorId = '1001';
  window.selectedPayTerm = 'Factoring Company';
  window.selectedFactoringCompanyId = 'f1';
  window.lorBankChoice = 'no';
  const d = window.buildNoaPayload();
  assert.equal(d.Factoring_Company, 'f1');
});
