// CUSTEDIT1: credit edits what the client submitted, from the customer profile.
// Only changed fields are sent, with the session cookie, to the profile's own
// edit route. A refusal keeps the form open with what was typed.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');
const profileJs = fs.readFileSync(path.resolve('customer-profile.js'), 'utf8');
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

const PAYLOAD = {
  submission_id: '4455', customer_name: 'HOGAN EQUIPMENT', broker: 'Marek LLC',
  status: 'Approved', engine: null, identity: null, summary: null, fv_debtor: null,
  fv_candidates: [], priors: [], priors_unavailable: false, notes: [], activity: [],
  contacts: { poc: 'JERRAD HOGAN', email: 'jho380@icloud.com', billing_poc: 'ANDREA GARRETT',
              billing_email: '', poc_phone: '918-344-7685', company_phone: '918-687-0968',
              billing_phone: '' },
  submitted: { company_name: 'HOGAN EQUIPMENT', address: '6386 U.S. 69, PORTER, OK, 74454',
               address_parts: { line1: '6386 U.S. 69', line2: '', city: 'PORTER', state: 'OK',
                                postal: '74454' },
               website: 'http://www.hoganeq.com/', linkedin: '', social: '', comments: 'NET 14' },
  can_act: true
};

async function boot(payload, reply) {
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  await wait(50);
  w.eval(profileJs);
  const calls = [];
  w.fetch = function(url, opts) {
    calls.push({ url: url, opts: opts || {} });
    if (/\/edit$/.test(url)) return Promise.resolve(reply || { ok: true, status: 200,
      json: function() { return Promise.resolve({ ok: true, updated: ['Email'] }); } });
    return Promise.resolve({ ok: true, status: 200, json: function() { return Promise.resolve(payload); } });
  };
  w.renderProfile({ ID: '4455' }, payload);
  return { w: w, d: w.document, calls: calls };
}

function edits(calls) { return calls.filter(function(c) { return /\/edit$/.test(c.url); }); }
function input(d, key) { return d.querySelector('[data-edit-key="' + key + '"]'); }

test('a viewer without can_act gets no edit button', async () => {
  const { d } = await boot(Object.assign({}, PAYLOAD, { can_act: false }));
  assert.equal(d.querySelector('[data-edit-open]'), null);
  assert.equal(d.querySelector('#cp-edit'), null);
});

test('the editor opens prefilled with what Creator holds', async () => {
  const { d } = await boot(PAYLOAD);
  const form = d.getElementById('cp-edit');
  assert.ok(form.hidden, 'closed until asked for');
  d.querySelector('[data-edit-open]').click();
  assert.ok(!form.hidden);
  assert.equal(input(d, 'Email').value, 'jho380@icloud.com');
  assert.equal(input(d, 'Phone_Number1').value, '918-344-7685');
  assert.equal(input(d, 'Billing_Point_of_Contact').value, 'ANDREA GARRETT');
  assert.equal(input(d, 'Company_Website').value, 'http://www.hoganeq.com/');
  assert.equal(d.querySelector('[data-edit-addr="district_city"]').value, 'PORTER');
});

test('only the fields that changed are sent, with the session cookie', async () => {
  const { d, calls } = await boot(PAYLOAD);
  d.querySelector('[data-edit-open]').click();
  input(d, 'Billing_Email').value = 'jho380@icloud.com';
  input(d, 'Billing_AP_Contact_Number').value = '918-344-7685';
  d.querySelector('[data-edit-save]').click();
  await wait(20);
  const sent = edits(calls);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/customer-profile\/4455\/edit$/);
  assert.equal(sent[0].opts.credentials, 'include');
  assert.deepEqual(JSON.parse(sent[0].opts.body).fields,
    { Billing_Email: 'jho380@icloud.com', Billing_AP_Contact_Number: '918-344-7685' });
});

test('an address change sends the whole address in Creator\'s shape', async () => {
  const { d, calls } = await boot(PAYLOAD);
  d.querySelector('[data-edit-open]').click();
  d.querySelector('[data-edit-addr="district_city"]').value = 'TULSA';
  d.querySelector('[data-edit-save]').click();
  await wait(20);
  assert.deepEqual(JSON.parse(edits(calls)[0].opts.body).fields, { Address: {
    address_line_1: '6386 U.S. 69', address_line_2: '', district_city: 'TULSA',
    state_province: 'OK', postal_Code: '74454' } });
});

test('saving with nothing changed sends nothing', async () => {
  const { d, calls } = await boot(PAYLOAD);
  d.querySelector('[data-edit-open]').click();
  d.querySelector('[data-edit-save]').click();
  await wait(20);
  assert.equal(edits(calls).length, 0);
});

test('a refusal keeps the form open, shows why, and keeps what was typed', async () => {
  const { d } = await boot(PAYLOAD, { ok: false, status: 502,
    json: function() { return Promise.resolve({ ok: false, error: 'Enter a value for Billing Number' }); } });
  d.querySelector('[data-edit-open]').click();
  input(d, 'Billing_Email').value = 'ap@hoganeq.com';
  d.querySelector('[data-edit-save]').click();
  await wait(20);
  assert.ok(!d.getElementById('cp-edit').hidden);
  assert.match(d.getElementById('cp-edit-msg').textContent, /Enter a value for Billing Number/);
  assert.equal(input(d, 'Billing_Email').value, 'ap@hoganeq.com');
});

test('a successful save re-reads the profile', async () => {
  const { d, calls } = await boot(PAYLOAD);
  d.querySelector('[data-edit-open]').click();
  input(d, 'Email').value = 'jerrad@hoganeq.com';
  d.querySelector('[data-edit-save]').click();
  await wait(30);
  const reads = calls.filter(function(c) { return /\/customer-profile\/4455$/.test(c.url); });
  assert.ok(reads.length >= 1);
});
