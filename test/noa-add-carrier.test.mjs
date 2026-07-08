import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../noa-management.html', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/noa-management.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: {
        UTIL: { getInitParams: () => new Promise(() => {}) },
        DATA: { addRecords: () => Promise.resolve({ code: 3000, result: [{ ID: 'rec_1' }] }) },
      }};
      window.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
    }
  });
  return dom.window;
}

function mockFetchOnce(window, payload) {
  window.fetch = () => Promise.resolve({ json: () => Promise.resolve(payload) });
}

test('lookupNewCarrier renders success card and stores a new carrier', async () => {
  const w = boot();
  w.brokerEmail = 'broker@op.com';
  w.document.getElementById('new-carrier-usdot').value = '2727315';
  mockFetchOnce(w, { carrier: {
    dot_number: '2727315', carrier_name: 'ROADRUNNER LOGISTICS', mc_number: '277621',
    authority_active: true, out_of_service: false, insurance_on_file: true,
    physical_city: 'Phoenix', physical_state: 'AZ',
  }, existing_vendor: null });

  await w.lookupNewCarrier();

  const card = w.document.getElementById('new-carrier-result');
  assert.match(card.textContent, /ROADRUNNER LOGISTICS/);
  assert.match(card.textContent, /FMCSA Active/);
  assert.ok(w.newCarrierLookup && w.newCarrierLookup.carrier);
  assert.equal(w.newCarrierLookup.carrier.dot_number, '2727315');
});

test('lookupNewCarrier blocks an already-a-vendor result (no stored lookup)', async () => {
  const w = boot();
  w.brokerEmail = 'broker@op.com';
  w.document.getElementById('new-carrier-usdot').value = '897123';
  mockFetchOnce(w, { carrier: { dot_number: '897123', carrier_name: 'ROADWAY EXPRESS' },
    existing_vendor: { ID: 'v1', Vendor_Name: 'ROADWAY EXPRESS', Vendor_Status: 'Approved' } });

  await w.lookupNewCarrier();

  const card = w.document.getElementById('new-carrier-result');
  assert.match(card.textContent, /Already a Vendor/i);
  assert.match(card.textContent, /NOA Update/);
  assert.equal(w.newCarrierLookup, null);
});

test('lookupNewCarrier blocks a not-found result (no stored lookup)', async () => {
  const w = boot();
  w.brokerEmail = 'broker@op.com';
  w.document.getElementById('new-carrier-usdot').value = '999999';
  mockFetchOnce(w, { carrier: null, existing_vendor: null });

  await w.lookupNewCarrier();

  const card = w.document.getElementById('new-carrier-result');
  assert.match(card.textContent, /not found in CarrierOK/i);
  assert.equal(w.newCarrierLookup, null);
});

test('buildNoaPayload maps the looked-up carrier fields for Add New Carrier', () => {
  const w = boot();
  w.selectedType = 'Add New Carrier';
  w.selectedFactoringId = 'fac_99';
  w.selectedVendorId = null;
  w.newCarrierLookup = { carrier: {
    dot_number: '2727315', carrier_name: 'ROADRUNNER LOGISTICS', mc_number: '277621',
    email_address: 'ap@roadrunner.com', telephone: '6025551212',
    physical_address_street: '123 Main St', physical_city: 'Phoenix',
    physical_state: 'AZ', physical_address_zip: '85001',
  }, existing_vendor: null };

  const d = w.buildNoaPayload();
  assert.equal(d.Submission_Type, 'Add New Carrier');
  assert.equal(d.USDOT_Search, '2727315');
  assert.equal(d.DOT, '2727315');
  assert.equal(d.Carrier_Name, 'ROADRUNNER LOGISTICS');
  assert.equal(d.MC_Number, '277621');
  assert.equal(d.FMCSA_Email, 'ap@roadrunner.com');
  assert.equal(d.FMCSA_Phone, '6025551212');
  assert.equal(d.Factoring_Company, 'fac_99');
  assert.equal(d.Address.address_line_1, '123 Main St');
  assert.equal(d.Address.district_city, 'Phoenix');
  assert.equal(d.Address.state_province, 'AZ');
  assert.equal(d.Address.postal_Code, '85001');
  assert.equal(d.Address.country, 'US');
});

test('submitNoa blocks Add New Carrier without a stored lookup', async () => {
  const w = boot();
  w.selectedType = 'Add New Carrier';
  w.newCarrierLookup = null;
  w.selectedFactoringId = 'fac_99';
  w.selectedDocFile = { name: 'noa.pdf' };

  await w.submitNoa();
  const fb = w.document.getElementById('noa-submit-feedback');
  assert.match(fb.textContent, /look up the carrier/i);
});

test('submitNoa blocks Add New Carrier without a factoring company', async () => {
  const w = boot();
  w.selectedType = 'Add New Carrier';
  w.newCarrierLookup = { carrier: { dot_number: '111', carrier_name: 'X' }, existing_vendor: null };
  w.selectedFactoringId = null;
  w.selectedDocFile = { name: 'noa.pdf' };

  await w.submitNoa();
  const fb = w.document.getElementById('noa-submit-feedback');
  assert.match(fb.textContent, /factoring company/i);
});

test('lookupNewCarrier warns on a globally DNU carrier (soft, still stored)', async () => {
  const w = boot();
  w.brokerEmail = 'broker@op.com';
  w.document.getElementById('new-carrier-usdot').value = '2727315';
  mockFetchOnce(w, { carrier: {
    dot_number: '2727315', carrier_name: 'BAD ACTOR LLC',
    authority_active: true, out_of_service: false, insurance_on_file: true,
    physical_city: 'Phoenix', physical_state: 'AZ',
  }, existing_vendor: null, global_dnu: true });

  await w.lookupNewCarrier();

  const card = w.document.getElementById('new-carrier-result');
  assert.match(card.textContent, /Do Not Use/i);
  assert.match(card.textContent, /flagged this carrier as Do Not Use/i);
  // soft warn: the new-carrier lookup is still stored (submit not hard-blocked here)
  assert.ok(w.newCarrierLookup && w.newCarrierLookup.carrier);
});

test('lookupNewCarrier shows no DNU warning for a clean carrier', async () => {
  const w = boot();
  w.brokerEmail = 'broker@op.com';
  w.document.getElementById('new-carrier-usdot').value = '2727315';
  mockFetchOnce(w, { carrier: {
    dot_number: '2727315', carrier_name: 'CLEAN CARRIER LLC',
    authority_active: true, out_of_service: false, insurance_on_file: true,
  }, existing_vendor: null, global_dnu: false });

  await w.lookupNewCarrier();

  const card = w.document.getElementById('new-carrier-result');
  assert.doesNotMatch(card.textContent, /flagged this carrier as Do Not Use/i);
});

function mockFetchCapture(window, response) {
  const calls = [];
  window.fetch = (url, init) => {
    // The Add New Carrier flow fires an /upload-doc call (FormData body, not JSON) before
    // /noa-submit (JSON body) -- only attempt JSON.parse on string bodies, so the FormData
    // call doesn't throw and short-circuit the chain before /noa-submit is reached.
    let body = null;
    if (init && init.body && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch (e) { body = init.body; }
    }
    calls.push({ url: String(url), body });
    return Promise.resolve({ json: () => Promise.resolve(response) });
  };
  return calls;
}

test('renderNewCarrierResult: global DNU + non-admin shows a blocked message', () => {
  const w = boot();
  w.renderNewCarrierResult({
    carrier: { dot_number: '4380302', carrier_name: 'BLUESKY LOGISTICS INC', authority_active: true },
    existing_vendor: null,
    global_dnu: true,
  }, 'DOT 4380302');
  const el = w.document.getElementById('new-carrier-result');
  assert.match(el.innerHTML, /Do Not Use/i);
  assert.match(el.innerHTML, /flagged this carrier as Do Not Use/i);
  assert.doesNotMatch(el.innerHTML, /Send Anyway/i);
});

test('renderNewCarrierResult: global DNU + admin session shows the override affordance', () => {
  const w = boot();
  w.OPERFI_IMP = { target: () => 'client@acme.com' };
  w.renderNewCarrierResult({
    carrier: { dot_number: '4380302', carrier_name: 'BLUESKY LOGISTICS INC', authority_active: true },
    existing_vendor: null,
    global_dnu: true,
  }, 'DOT 4380302');
  const el = w.document.getElementById('new-carrier-result');
  assert.match(el.innerHTML, /Send Anyway/i);
});

test('submitNoa blocks Add New Carrier for a flagged carrier without an override', async () => {
  const w = boot();
  let addRecordsCalled = false;
  w.ZOHO.CREATOR.DATA.addRecords = () => { addRecordsCalled = true; return Promise.resolve({ code: 3000, result: [{ ID: 'rec_1' }] }); };
  w.selectedType = 'Add New Carrier';
  w.selectedFactoringId = 'fac_99';
  w.selectedDocFile = { name: 'noa.pdf' };
  w.newCarrierLookup = {
    carrier: { dot_number: '4380302', carrier_name: 'BLUESKY LOGISTICS INC' },
    existing_vendor: null,
    global_dnu: true,
  };

  await w.submitNoa();

  assert.equal(addRecordsCalled, false, 'addRecords must not be called for a blocked, non-overridden submit');
  const fb = w.document.getElementById('noa-submit-feedback');
  assert.match(fb.textContent, /Do Not Use/i);
});

test('submitNoa proceeds and posts the override to /noa-submit once armed', async () => {
  const w = boot();
  w.OPERFI_IMP = { target: () => 'client@acme.com' };
  w.selectedType = 'Add New Carrier';
  w.selectedFactoringId = 'fac_99';
  w.selectedDocFile = new w.File(['x'], 'noa.pdf', { type: 'application/pdf' });   // required: submitNoa's doc-attachment check runs before the DNU gate; a real File/Blob is needed so uploadNoaDoc's FormData.append doesn't throw
  w.newCarrierLookup = {
    carrier: { dot_number: '4380302', carrier_name: 'BLUESKY LOGISTICS INC' },
    existing_vendor: null,
    global_dnu: true,
  };
  w.renderNewCarrierResult(w.newCarrierLookup, 'DOT 4380302');

  const reasonInput = w.document.querySelector('[data-dnu-override-reason]');
  reasonInput.value = 'cleared by ops manager';
  w.document.querySelector('[data-dnu-override-confirm]').click();
  assert.equal(w.dnuOverrideArmed, true);

  const calls = mockFetchCapture(w, {});
  await w.submitNoa();

  const engineCall = calls.find(c => c.url.includes('/noa-submit'));
  assert.ok(engineCall, '/noa-submit was called');
  assert.equal(engineCall.body.dnu_override, true);
  assert.equal(engineCall.body.override_reason, 'cleared by ops manager');
});

test('confirming the override with an empty reason does not arm it', () => {
  const w = boot();
  w.OPERFI_IMP = { target: () => 'client@acme.com' };
  w.renderNewCarrierResult({
    carrier: { dot_number: '4380302', carrier_name: 'BLUESKY LOGISTICS INC' },
    existing_vendor: null,
    global_dnu: true,
  }, 'DOT 4380302');

  w.document.querySelector('[data-dnu-override-confirm]').click();
  assert.equal(w.dnuOverrideArmed, false);
});

test('a fresh lookupNewCarrier call resets dnuOverrideArmed/dnuOverrideReason', async () => {
  const w = boot();
  w.dnuOverrideArmed = true;
  w.dnuOverrideReason = 'stale reason';
  w.document.getElementById('new-carrier-usdot').value = '2727315';
  mockFetchOnce(w, { carrier: { dot_number: '2727315', carrier_name: 'ROADRUNNER LOGISTICS' }, existing_vendor: null });

  await w.lookupNewCarrier();

  assert.equal(w.dnuOverrideArmed, false);
  assert.equal(w.dnuOverrideReason, '');
});
