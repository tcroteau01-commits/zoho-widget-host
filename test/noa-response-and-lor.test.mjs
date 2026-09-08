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

// Bug D: the native form also requires Banking_Document_Upload (proof of
// account ownership, separate from the NOA/LOR doc) whenever
// Bank_Document_Upload == "Yes", but uploadNoaDoc never sent it anywhere.
test('uploadNoaDoc uploads the banking document for LOR Update when bank details are entered', async () => {
  const { window } = makeWidget();
  const calls = [];
  window.fetch = (u, opts) => { calls.push([String(u), opts]); return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); };
  window.selectedType = 'LOR Update';
  window.lorBankChoice = 'yes';
  window.selectedDocFile = new window.File(['x'], 'lor.pdf', { type: 'application/pdf' });
  window.selectedBankDocFile = new window.File(['y'], 'voided-check.pdf', { type: 'application/pdf' });
  await window.uploadNoaDoc('rec_1');
  const bankUpload = calls.find((c) => {
    const fd = c[1] && c[1].body;
    return fd && fd.get && fd.get('field_name') === 'Banking_Document_Upload';
  });
  assert.ok(bankUpload, 'must upload the banking document to Banking_Document_Upload');
});

// Bug E: the second Creator shape. A wrapped add returns
// {code:3000, result:[{code:3000, data:{ID}, message:"Data Added Successfully"}]}
// -- the id is at result[0].data.ID, NOT result[0].ID. Bug A's fix guessed the
// wrong path for this shape (and the harness fixture invented {result:[{ID}]},
// which Creator never sends), so a real success still showed
// "Submission failed: Data Added Successfully" while the record WAS created,
// orphaning it with no document and no engine run.
test('submitNoa treats {code:3000,result:[{data:{ID}}]} as success and runs the engine', async () => {
  const { window } = makeWidget();
  const calls = [];
  window.ZOHO.CREATOR.DATA.addRecords = function () {
    return Promise.resolve({
      code: 3000,
      result: [{ code: 3000, data: { ID: '3773785000015541008' }, message: 'Data Added Successfully' }]
    });
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
  const up = calls.find((c) => /\/upload-doc/.test(c[0]));
  assert.ok(up, 'the NOA document must upload on success');
  const eng = calls.find((c) => /\/noa-submit/.test(c[0]));
  assert.ok(eng, 'the /noa-submit engine must run on success');
  assert.equal(JSON.parse(eng[1].body).record_id, '3773785000015541008',
    'engine must get the real record id from res.result[0].data.ID');
});

// Bug F: runEngine read r.json() and never looked at the HTTP status, so ANY
// non-2xx from /noa-submit was handed to the caller as if it were the engine's
// success body. The caller only fails on `engRes.ok === false`, and a refusal
// body carries {error, code} with no `ok` -- so a 403 rendered the SUCCESS
// screen. Live on 2026-09-08 19:58: creator-write 200, upload-doc 200,
// noa-submit 403 (impersonation is read-only), user saw a confirmation, and
// nothing reached CRM, WorkDrive or the broker-carrier-pmt-change channel.
test('submitNoa surfaces a 403 from /noa-submit instead of showing the success screen', async () => {
  const { window } = makeWidget();
  const REFUSAL = {
    error: 'Impersonation is read-only. Sign in to the client\u2019s account, or use an OperFi admin tool that records you as the actor.',
    code: 'impersonation_read_only'
  };
  window.ZOHO.CREATOR.DATA.addRecords = function () {
    return Promise.resolve({ code: 3000, result: [{ code: 3000, data: { ID: 'rec_88' } }] });
  };
  window.fetch = (u) => Promise.resolve(/\/noa-submit/.test(String(u))
    ? { ok: false, status: 403, json: () => Promise.resolve(REFUSAL) }
    : { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  let tracked = false;
  window.showTrack = function () { tracked = true; };
  window.brokerEmail = 'b@op.com';
  window.statusPayload = { carriers: [] };
  window.selectedType = 'NOA Update';
  window.selectedVendorId = '1001';
  window.selectedDocFile = new window.File(['x'], 'noa.pdf', { type: 'application/pdf' });
  await window.submitNoa();
  const fb = window.document.getElementById('noa-submit-feedback').textContent;
  assert.match(fb, /processing failed/i, 'a refused engine must report a failure, got: ' + fb);
  assert.match(fb, /read-only/i, 'the server refusal must reach the user, got: ' + fb);
  assert.equal(tracked, false, 'must NOT show the success/track screen when the engine was refused');
});

// The button must come back so the user can act, not sit disabled on "Submitting...".
test('a refused engine re-enables the submit button', async () => {
  const { window } = makeWidget();
  window.ZOHO.CREATOR.DATA.addRecords = function () {
    return Promise.resolve({ code: 3000, result: [{ code: 3000, data: { ID: 'rec_89' } }] });
  };
  window.fetch = (u) => Promise.resolve(/\/noa-submit/.test(String(u))
    ? { ok: false, status: 500, json: () => Promise.resolve({}) }
    : { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  window.showTrack = function () {};
  window.brokerEmail = 'b@op.com';
  window.statusPayload = { carriers: [] };
  window.selectedType = 'NOA Update';
  window.selectedVendorId = '1001';
  window.selectedDocFile = new window.File(['x'], 'noa.pdf', { type: 'application/pdf' });
  await window.submitNoa();
  assert.equal(window.document.getElementById('noa-submit-btn').disabled, false,
    'the submit button must be usable again after a refusal');
});
