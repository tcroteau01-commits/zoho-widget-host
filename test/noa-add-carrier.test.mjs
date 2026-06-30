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
