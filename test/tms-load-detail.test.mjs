import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

const CARRIERS = { carriers: [
  { vendor_id: 'v1', carrier_name: 'ROADWAY', mc: '123', dot: '897', dnu: false, hiring_decision: 'Approve', status: 'Active', payment_terms: 'Net 30' },
  { vendor_id: 'v2', carrier_name: 'BADCO', mc: '999', dot: '111', dnu: true, hiring_decision: 'Decline', status: 'Active' },
]};
const CUSTOMERS = { customers: [
  { customer_id: 'cu1', customer_name: 'Big Shipper', credit_decision: 'Approved' },
  { customer_id: 'cu2', customer_name: 'Pending Co', credit_decision: 'Awaiting Credit Decision' },
  { customer_id: 'cu3', customer_name: 'Boost Co', credit_decision: 'Credit Boost Requested' },
]};
const NOA_STATUS = { carriers: [{
  vendor_id: 'v1', pay_term: 'Factoring Company - Quick Pay', factoring_company: 'OUTGO INC.',
  doc_on_file: { type: 'NOA', has_doc: true },
}] };

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
        if (String(url).indexOf('/noa-status') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve(NOA_STATUS) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
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
  assert.match(window.document.getElementById('vetting-badge').textContent, /will be blocked/i);
  assert.doesNotMatch(window.document.getElementById('vetting-badge').textContent, /soft-blocked/i);
});

test('populateCarriers marks unapproved (non-DNU) carriers and shows the real hiring-decision status on select', () => {
  const { window } = makeWidget();
  window.populateCarriers([
    { vendor_id: 'v1', carrier_name: 'Good Co', mc: '1', hiring_decision: 'Approve', dnu: false },
    { vendor_id: 'v2', carrier_name: 'Unreviewed Co', mc: '2', hiring_decision: 'Not Reviewed', dnu: false },
  ]);
  const sel = window.document.getElementById('f-carrier_id');
  assert.match(sel.options[2].textContent, /Not Reviewed/);   // index 0 = placeholder, 1 = Good Co, 2 = Unreviewed Co
  assert.equal(sel.options[2].disabled, true);
  assert.equal(sel.options[1].disabled, false);
  sel.value = 'v2';
  window.onCarrierChange();
  assert.match(window.document.getElementById('vetting-badge').textContent, /Not Reviewed/);
  assert.match(window.document.getElementById('vetting-badge').textContent, /will be blocked/i);
});

test('Customer Payment Terms input offers a datalist of common terms (still free-text)', () => {
  const { window } = makeWidget();
  const input = window.document.getElementById('f-customer_payment_terms');
  assert.equal(input.getAttribute('list'), 'tms-cust-terms');
  const dl = window.document.getElementById('tms-cust-terms');
  assert.ok(dl, 'datalist present');
  const opts = Array.from(dl.querySelectorAll('option')).map(o => o.value);
  assert.ok(opts.includes('Net 30') && opts.includes('Quick Pay'));
});

test('onCarrierChange fetches /noa-status and shows pay terms, factor, and NOA on file', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.populateCarriers(CARRIERS.carriers);
  window.document.getElementById('f-carrier_id').value = 'v1';   // ROADWAY
  window.onCarrierChange();
  await new Promise(r => setTimeout(r, 10));                     // let /noa-status resolve
  const badge = window.document.getElementById('vetting-badge').textContent;
  assert.match(badge, /Pay terms: Factoring Company - Quick Pay/);
  assert.match(badge, /Factor: OUTGO INC\./);
  assert.match(badge, /NOA on file/);
});

test('vettingExtraHtml shows the on-file badge but never warns on doc-absence', () => {
  const { window } = makeWidget();
  // A factoring carrier with no NOA/LOR row logged must NOT warn — the vendor
  // record (its hold reason) is the source of truth for a missing-NOA flag, not
  // doc presence. This is the only place that used the old doc-absence heuristic.
  const noDoc = window.vettingExtraHtml({ pay_term: 'Factoring Company', factoring_company: 'RTS', doc_on_file: null });
  assert.doesNotMatch(noDoc, /No NOA\/LOR on file/);
  // A doc on file still surfaces the positive badge.
  const withDoc = window.vettingExtraHtml({ pay_term: 'Factoring Company', doc_on_file: { type: 'NOA Update' } });
  assert.match(withDoc, /NOA Update on file/);
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

test('template control lives in the customer section header', () => {
  const { window } = makeWidget();
  const sel = window.document.getElementById('f-template');
  assert.ok(sel, 'template select exists');
  // it is inside the customer section, not a standalone top card
  const customer = window.document.getElementById('section-customer') ||
                   window.document.querySelector('[data-section="customer"]');
  assert.ok(customer && customer.contains(sel), 'template select is within the customer section');
});

test('f-status is a hidden input defaulting to Draft', () => {
  const { window } = makeWidget();
  const el = window.document.getElementById('f-status');
  assert.equal(el.tagName.toLowerCase(), 'input');
  assert.equal(el.type, 'hidden');
  assert.equal(el.value, 'Draft');
});

test('saveLoad with explicit Draft status posts status Draft', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.populateCustomers(CUSTOMERS.customers);
  window.populateCarriers(CARRIERS.carriers);
  window.document.getElementById('f-customer_id').value = 'cu1';
  window.document.getElementById('f-carrier_id').value = 'v1';
  await window.saveLoad('Draft');
  assert.equal(posts.at(-1).body.status, 'Draft');
});

test('applyTemplate pre-fills full load including stops', () => {
  const { window } = makeWidget();
  window.populateCustomers(CUSTOMERS.customers);
  window.applyTemplate({
    customer_id: 'cu1', origin: 'Dallas', destination: 'Atlanta', equipment: 'Reefer',
    commodity: 'Produce', weight: '42000', temperature: '34F', piece_count: '24',
    accessorials: 'Detention', special_instructions: 'Tarp', default_invoice_amount: '2000',
    default_customer_payment_terms: 'Net 30',
    stops: [{ stop_type: 'Pickup', sequence: 1, company_name: 'Ship Co', address: '9 B St' },
            { stop_type: 'Delivery', sequence: 2, company_name: 'Acme', address: '1 A St' }],
  });
  assert.equal(window.document.getElementById('f-weight').value, '42000');
  assert.equal(window.document.getElementById('f-special_instructions').value, 'Tarp');
  const stopRows = window.document.querySelectorAll('.stop-row');
  assert.equal(stopRows.length, 2);
});

test('saveTemplate posts the full load shape including stops', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.prompt = () => 'Lane A';
  // f-customer_id is a SELECT -- populate customers so the option exists, then select it
  window.populateCustomers(CUSTOMERS.customers);
  window.document.getElementById('f-customer_id').value = 'cu1';
  // text fields: set by id suffix; number fields (weight, piece_count, invoice_amount) need numeric values
  ['f-origin','f-destination','f-equipment','f-commodity','f-temperature','f-accessorials','f-special_instructions','f-customer_payment_terms']
    .forEach(function(id){ var el = window.document.getElementById(id); if (el) el.value = id.replace('f-',''); });
  var wEl = window.document.getElementById('f-weight'); if (wEl) wEl.value = '4500';
  window.addStop && window.addStop();   // create a stop row if the helper exists
  await window.saveTemplate();
  const post = posts.find(p => /\/tms-template$/.test(p.url));
  assert.ok(post, 'posted to /tms-template');
  assert.equal(post.body.template_name, 'Lane A');
  assert.equal(post.body.weight, '4500');
  assert.equal(post.body.special_instructions, 'special_instructions');
  assert.ok(Array.isArray(post.body.stops), 'stops array sent');
});

test('updateTemplate PATCHes the applied template with the full shape', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.applyTemplate({ id: 't1', customer_id: 'cu1', origin: 'Dallas', stops: [] });
  window.document.getElementById('f-equipment') && (window.document.getElementById('f-equipment').value = 'Flatbed');
  await window.updateTemplate();
  const post = posts.find(p => /\/tms-template\/t1$/.test(p.url));
  assert.ok(post, 'PATCHed /tms-template/t1');
  assert.equal(post.body.equipment, 'Flatbed');
});

test('vettingExtraHtml warns on dual authority', () => {
  const { window } = makeWidget();
  const html = window.vettingExtraHtml({ authority_class: 'dual' });
  assert.match(html, /double-broker/i);
});

test('vettingExtraHtml warns on broker_only authority', () => {
  const { window } = makeWidget();
  const html = window.vettingExtraHtml({ authority_class: 'broker_only' });
  assert.match(html, /broker authority/i);
});

test('vettingExtraHtml does not warn for a carrier', () => {
  const { window } = makeWidget();
  const html = window.vettingExtraHtml({ authority_class: 'carrier' });
  assert.doesNotMatch(html, /double-broker|broker authority/i);
});

test('_vettingWarnings calls out dual authority', () => {
  const { window: w } = makeWidget();
  const warns = w._vettingWarnings({ vetting: { authority_class: 'dual', risk_flag: 'ok' } });
  assert.ok(warns.some(s => /double-broker/i.test(s)));
});

test('_vettingWarnings calls out broker_only authority', () => {
  const { window: w } = makeWidget();
  const warns = w._vettingWarnings({ vetting: { authority_class: 'broker_only' } });
  assert.ok(warns.some(s => /broker, not a carrier|not a carrier/i.test(s)));
});

test('_vettingWarnings adds no authority warning for a carrier', () => {
  const { window: w } = makeWidget();
  const warns = w._vettingWarnings({ vetting: { authority_class: 'carrier' } });
  assert.ok(!warns.some(s => /double-broker|not a carrier/i.test(s)));
});
