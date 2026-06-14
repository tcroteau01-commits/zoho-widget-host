import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

const CARRIERS = { carriers: [
  { vendor_id: 'v1', carrier_name: 'ROADWAY', mc: '123', dot: '897', dnu: false, status: 'Active', payment_terms: 'Net 30' },
  { vendor_id: 'v2', carrier_name: 'BADCO', mc: '999', dot: '111', dnu: true, status: 'Active' },
]};
const CUSTOMERS = { customers: [
  { customer_id: 'cu1', customer_name: 'Big Shipper', credit_decision: 'Approved' },
  { customer_id: 'cu2', customer_name: 'Pending Co', credit_decision: 'Awaiting Credit Decision' },
  { customer_id: 'cu3', customer_name: 'Boost Co', credit_decision: 'Credit Boost Requested' },
]};

function makeWidget(opts) {
  opts = opts || {};
  const posts = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-detail.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = function(url, init){
        if (init && init.method === 'POST') { posts.push({ url: url, body: JSON.parse(init.body) }); return Promise.resolve({ json: () => Promise.resolve({ ok: true, id: 'load_new' }) }); }
        if (String(url).indexOf('/tms-carriers') !== -1) return Promise.resolve({ json: () => Promise.resolve(CARRIERS) });
        if (String(url).indexOf('/tms-customers') !== -1) return Promise.resolve({ json: () => Promise.resolve(CUSTOMERS) });
        if (String(url).indexOf('/tms-templates') !== -1) return Promise.resolve({ json: () => Promise.resolve({ templates: [] }) });
        return Promise.resolve({ json: () => Promise.resolve({}) });
      };
    }
  });
  return { window: dom.window, posts };
}

test('addStop appends a stop row; removeStop drops it', () => {
  const { window } = makeWidget();
  window.addStop('Pickup');
  window.addStop('Delivery');
  assert.equal(window.document.querySelectorAll('.stop-row').length, 2);
  window.removeStop(0);
  assert.equal(window.document.querySelectorAll('.stop-row').length, 1);
});

test('margin recomputes from invoice and carrier pay', () => {
  const { window } = makeWidget();
  window.document.getElementById('f-invoice_amount').value = '2000';
  window.document.getElementById('f-carrier_pay').value = '1500';
  window.recomputeMargin();
  assert.match(window.document.getElementById('margin-display').textContent, /\$500/);
});

test('populateCarriers marks DNU carriers and shows a warning on select', () => {
  const { window } = makeWidget();
  window.populateCarriers(CARRIERS.carriers);
  const sel = window.document.getElementById('f-carrier_id');
  assert.equal(sel.options.length, 3);           // placeholder + 2
  sel.value = 'v2';                                // BADCO (dnu)
  window.onCarrierChange();
  assert.match(window.document.getElementById('vetting-badge').textContent, /Do Not Use|DNU/i);
});

test('onCarrierChange shows the carrier broker pay terms on select', () => {
  const { window } = makeWidget();
  window.populateCarriers(CARRIERS.carriers);
  window.document.getElementById('f-carrier_id').value = 'v1';   // ROADWAY, Net 30
  window.onCarrierChange();
  const badge = window.document.getElementById('vetting-badge').textContent;
  assert.match(badge, /Pay terms: Net 30/);
});

test('populateCustomers lists bookable customers (Approved + Boost Requested), hides others', () => {
  const { window } = makeWidget();
  window.populateCustomers(CUSTOMERS.customers);
  const sel = window.document.getElementById('f-customer_id');
  const labels = Array.from(sel.options).map(o => o.textContent);
  assert.ok(labels.includes('Big Shipper'), 'approved customer should be listed');
  assert.ok(labels.includes('Boost Co'), 'boost-pending customer should be listed');
  assert.ok(!labels.includes('Pending Co'), 'non-approved customer should be hidden');
  assert.equal(sel.options.length, 3);            // placeholder + approved + boost
});

test('ensureCustomerOption re-adds a non-approved customer when editing a load booked against it', () => {
  const { window } = makeWidget();
  window.populateCustomers(CUSTOMERS.customers);
  window.ensureCustomerOption('cu2');             // the now-non-approved booked customer
  const sel = window.document.getElementById('f-customer_id');
  const opt = Array.from(sel.options).find(o => o.value === 'cu2');
  assert.ok(opt, 'booked customer should be re-added on edit');
  assert.match(opt.textContent, /not currently approved/i);
});

test('Carrier MC field is read-only (auto-filled from carrier, not editable)', () => {
  const { window } = makeWidget();
  const mc = window.document.getElementById('f-carrier_mc');
  assert.ok(mc.hasAttribute('readonly'), 'Carrier MC input should have the readonly attribute');
});

test('collectForm builds the save body including stops', () => {
  const { window } = makeWidget();
  window.populateCustomers(CUSTOMERS.customers);
  window.populateCarriers(CARRIERS.carriers);
  window.document.getElementById('f-customer_id').value = 'cu1';
  window.document.getElementById('f-invoice_amount').value = '2000';
  window.document.getElementById('f-carrier_id').value = 'v1';
  window.document.getElementById('f-carrier_pay').value = '1500';
  window.addStop('Pickup');
  window.document.querySelector('.stop-row [data-k="company_name"]').value = 'Ship Co';
  const body = window.collectForm();
  assert.equal(body.customer_id, 'cu1');
  assert.equal(body.carrier_id, 'v1');
  assert.equal(body.stops.length, 1);
  assert.equal(body.stops[0].company_name, 'Ship Co');
});

test('saveLoad rejects when no customer selected', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 'b@op.com';
  await window.saveLoad();
  assert.equal(posts.length, 0);
  assert.match(window.document.getElementById('form-error').textContent, /customer/i);
});

test('saveLoad posts the load body when valid', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.populateCustomers(CUSTOMERS.customers);
  window.document.getElementById('f-customer_id').value = 'cu1';
  window.document.getElementById('f-invoice_amount').value = '2000';
  await window.saveLoad();
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/tms-load$/);
  assert.equal(posts[0].body.customer_id, 'cu1');
  assert.equal(posts[0].body.email, 'b@op.com');
});

test('applyTemplate pre-fills shipper leg', () => {
  const { window } = makeWidget();
  window.populateCustomers(CUSTOMERS.customers);
  window.applyTemplate({ customer_id: 'cu1', origin: 'Dallas', destination: 'Atlanta',
                         equipment: 'Reefer', default_invoice_amount: '2000' });
  assert.equal(window.document.getElementById('f-customer_id').value, 'cu1');
  assert.equal(window.document.getElementById('f-origin').value, 'Dallas');
  assert.equal(window.document.getElementById('f-invoice_amount').value, '2000');
});
